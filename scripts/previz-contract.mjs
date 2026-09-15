import { createReadStream } from 'node:fs'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'

const VERSION = /^v\d{3}$/
const EPISODE = /^ep-\d{3}$/
const MOTION_REFERENCE_MODELS = new Set([
  'runninghub:minimax-h3-reference-to-video',
])
export const PREVIZ_REQUIRED_HARD_GATES = ['剧情因果', '人数与身份', '轴线与屏幕方向', '物理接触', '关键物可见']

function nonEmpty(value) { return typeof value === 'string' && value.trim().length > 0 }
function vector(value) { return Array.isArray(value) && value.length === 3 && value.every(Number.isFinite) }

export function supportsPrevizMotionReference(provider, model) {
  return MOTION_REFERENCE_MODELS.has(`${provider}:${model}`)
}

export function previzAssetKey(episode, shotNumber) {
  return `other-previz-${episode.replace('-', '')}-${String(shotNumber).padStart(3, '0')}`
}

export function validateMotionReferenceBinding(episode, planShot, promptShot, assets) {
  const expectedKey = previzAssetKey(episode, planShot?.shot_number)
  const listed = (promptShot?.references || []).filter((item) => item?.type === 'video' && item.asset_key === expectedKey)
  if (planShot?.previz_strategy?.purpose !== 'motion-reference') {
    if (listed.length) throw new Error('仅 motion-reference 镜头可以把白模视频加入正式视频引用')
    return null
  }
  if (!supportsPrevizMotionReference(planShot.provider, planShot.model_or_workflow)) throw new Error('当前 Provider/工作流不支持白模参考视频')
  const asset = assets?.assets?.[expectedKey]
  const version = asset?.versions?.find((item) => item.id === asset.selectedVersionId)
  if (asset?.type !== 'other' || !version || asset.staleVersionIds?.includes(version.id)) throw new Error('motion-reference 必须绑定当前 selected 且未失效的白模视频')
  if (listed.length !== 1 || listed[0].version_id !== version.id || listed[0].role !== 'reference_video') throw new Error('motion-reference 视频提示词必须精确引用当前白模版本并使用 reference_video 角色')
  return listed[0]
}

export function validatePrevizContract(contract, expected = {}) {
  if (!contract || typeof contract !== 'object' || Array.isArray(contract)) throw new Error('白模导演合同必须是对象')
  if (contract.schema_version !== 1) throw new Error('白模导演合同 schema_version 必须为 1')
  const source = contract.source
  if (!source || !EPISODE.test(source.episode_key) || !VERSION.test(source.storyboard_version) || !VERSION.test(source.production_plan_version) || !Number.isInteger(source.shot_number) || source.shot_number < 1 || source.storyboard_medium !== 'blender' || source.board_asset !== null) throw new Error('白模导演合同 source 无效')
  if (expected.episode && source.episode_key !== expected.episode) throw new Error('白模导演合同分集不匹配')
  if (expected.storyboardVersion && source.storyboard_version !== expected.storyboardVersion) throw new Error('白模导演合同分镜版本不匹配')
  if (expected.productionPlanVersion && source.production_plan_version !== expected.productionPlanVersion) throw new Error('白模导演合同制作计划版本不匹配')
  if (expected.shotNumber && source.shot_number !== expected.shotNumber) throw new Error('白模导演合同镜号不匹配')

  const direction = contract.direction
  if (!direction || !nonEmpty(direction.dramatic_intent) || !nonEmpty(direction.primary_read)) throw new Error('白模导演合同缺少剧情意图或首要信息')
  if (!direction.axis || ['line', 'camera_side', 'screen_direction'].some((field) => !nonEmpty(direction.axis[field]))) throw new Error('白模导演合同轴线定义不完整')
  if (!direction.camera || ['shot_size', 'principal_move', 'motivation'].some((field) => !nonEmpty(direction.camera[field]))) throw new Error('白模导演合同相机动机不完整')
  if (!direction.continuity || ['entry_exit', 'eyelines', 'end_state'].some((field) => !nonEmpty(direction.continuity[field]))) throw new Error('白模导演合同连续性定义不完整')
  if (!Number.isInteger(contract.fps) || contract.fps < 6 || contract.fps > 30 || !Number.isFinite(contract.duration_seconds) || contract.duration_seconds <= 0 || contract.duration_seconds > 30) throw new Error('白模导演合同帧率或时长无效')
  if (!Array.isArray(contract.resolution) || contract.resolution.length !== 2 || contract.resolution.some((value) => !Number.isInteger(value) || value < 64 || value > 4096)) throw new Error('白模导演合同分辨率无效')
  const finalFrame = Math.round(contract.fps * contract.duration_seconds)
  if (!Array.isArray(direction.beats) || !direction.beats.length) throw new Error('白模导演合同 beats[] 不得为空')
  let coveredUntil = 0
  let previousEnd = 0
  for (const [index, beat] of direction.beats.entries()) {
    if (!Number.isInteger(beat?.start_frame) || !Number.isInteger(beat?.end_frame) || beat.start_frame < 1 || beat.end_frame < beat.start_frame || beat.end_frame > finalFrame || ['name', 'actor', 'action', 'result'].some((field) => !nonEmpty(beat[field]))) throw new Error(`白模导演合同 beats[${index}] 无效`)
    if (index > 0 && beat.start_frame < previousEnd) throw new Error(`白模导演合同 beats[${index}] 与前一节拍倒序或过度重叠`)
    if (beat.start_frame > coveredUntil + 1) throw new Error(`白模导演合同节拍在第 ${coveredUntil + 1} 帧出现空档`)
    coveredUntil = Math.max(coveredUntil, beat.end_frame)
    previousEnd = beat.end_frame
  }
  if (direction.beats[0].start_frame !== 1 || coveredUntil !== finalFrame) throw new Error('白模导演合同节拍必须覆盖首帧到镜尾')
  if (!contract.review_contract || !Array.isArray(contract.review_contract.hard_gates) || contract.review_contract.hard_gates.some((item) => !nonEmpty(item)) || PREVIZ_REQUIRED_HARD_GATES.some((gate) => !contract.review_contract.hard_gates.includes(gate)) || contract.review_contract.score_target !== 85) throw new Error('白模导演合同 review_contract 无效')
  if (!Array.isArray(contract.objects) || !contract.objects.length) throw new Error('白模导演合同 objects[] 不得为空')

  const cameraSpecs = contract.cameras ?? (contract.camera ? [contract.camera] : null)
  if (!Array.isArray(cameraSpecs) || !cameraSpecs.length) throw new Error('白模导演合同必须声明摄影机')
  const names = new Set()
  for (const [index, camera] of cameraSpecs.entries()) {
    if (!camera || !vector(camera.location) || !vector(camera.target) || !Number.isFinite(camera.lens) || camera.lens < 10 || camera.lens > 200) throw new Error(`白模导演合同摄影机 ${index + 1} 无效`)
    if (contract.cameras) {
      if (!nonEmpty(camera.name) || names.has(camera.name)) throw new Error('白模导演合同多机位名称必须非空且唯一')
      names.add(camera.name)
    }
  }
  if (contract.cameras) {
    if (!Array.isArray(contract.camera_cuts) || !contract.camera_cuts.length || contract.camera_cuts[0]?.frame !== 1) throw new Error('白模导演合同多机位切换必须从第 1 帧开始')
    let previous = 0
    const protectedFrames = new Set((contract.contact_checks || []).map((item) => item.frame))
    for (const cut of contract.camera_cuts) {
      if (!Number.isInteger(cut?.frame) || cut.frame <= previous || cut.frame > finalFrame || !names.has(cut.camera)) throw new Error('白模导演合同 camera_cuts 无效')
      if (cut.frame !== 1 && protectedFrames.has(cut.frame)) throw new Error(`白模导演合同不得在接触帧 ${cut.frame} 切换机位`)
      previous = cut.frame
    }
  }
  return true
}

export async function fileSha256(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

export function probePrevizMedia(path) {
  const result = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,avg_frame_rate,nb_frames:format=duration', '-of', 'json', path], { encoding: 'utf8' })
  if (result.error?.code === 'ENOENT') throw new Error('缺少 ffprobe，无法验证白模实际媒体参数')
  if (result.status !== 0) throw new Error(`白模媒体探测失败：${(result.stderr || result.stdout).trim()}`)
  const data = JSON.parse(result.stdout)
  const stream = data.streams?.[0]
  const [numerator, denominator] = String(stream?.avg_frame_rate || '').split('/').map(Number)
  const fps = denominator ? numerator / denominator : NaN
  const media = { width: Number(stream?.width), height: Number(stream?.height), fps, frames: Number(stream?.nb_frames), duration_seconds: Number(data.format?.duration) }
  if (Object.values(media).some((value) => !Number.isFinite(value) || value <= 0)) throw new Error('白模媒体缺少有效的时长、帧率、帧数或分辨率')
  return media
}

export function validatePrevizMedia(media, contract, shot) {
  const expectedFrames = Math.round(contract.fps * contract.duration_seconds)
  const frameTolerance = 1
  const durationTolerance = Math.max(0.05, 1 / contract.fps)
  if (Math.abs(media.duration_seconds - contract.duration_seconds) > durationTolerance || Math.abs(media.duration_seconds - shot.duration_seconds) > durationTolerance) throw new Error(`白模实际时长不匹配：${media.duration_seconds}s != ${shot.duration_seconds}s`)
  if (Math.abs(media.fps - contract.fps) > 0.01 || media.frames < expectedFrames - frameTolerance || media.frames > expectedFrames + frameTolerance) throw new Error(`白模实际帧率或帧数不匹配：${media.fps}fps/${media.frames}帧`)
  if (media.width !== contract.resolution[0] || media.height !== contract.resolution[1]) throw new Error(`白模实际分辨率不匹配：${media.width}x${media.height}`)
  if (shot.previz_strategy?.fps !== contract.fps) throw new Error('白模合同帧率与制作计划 previz_strategy.fps 不一致')
  return true
}
