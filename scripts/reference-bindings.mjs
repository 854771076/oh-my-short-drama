import { readFile, realpath } from 'node:fs/promises'
import { resolve } from 'node:path'
import { validateTemporaryReferenceUrl } from './media-hosting/publish.mjs'
import { selectedAssetVersion } from './asset-ledger.mjs'

const compact = (values) => (values || []).filter((value) => typeof value === 'string' && value.trim())

function inputs(provider, args) {
  if (provider === 'runninghub') {
    if (args.model === 'minimax-h3-reference-to-video') return {
      image: compact(args.reference_image_paths ?? args.reference_paths),
      video: compact(args.reference_video_paths),
      audio: compact(args.reference_audio_paths),
      local: true,
    }
    return { sequential: compact(args.reference_paths), local: true }
  }
  const content = Array.isArray(args.metadata?.content) ? args.metadata.content : []
  if (provider === 'starrouter' && content.length) return {
    image: content.filter((item) => item?.type === 'image_url').map((item) => item.image_url?.url).filter(Boolean),
    video: content.filter((item) => item?.type === 'video_url').map((item) => item.video_url?.url).filter(Boolean),
    audio: content.filter((item) => item?.type === 'audio_url').map((item) => item.audio_url?.url).filter(Boolean),
  }
  if (provider === 'comfly') return {
    image: compact([args.frame_url, args.input_reference, ...(args.images || []), ...(args.reference_image_urls || [])]),
    video: compact(args.reference_video_urls), audio: compact(args.reference_audio_urls),
  }
  const h3Images = compact(args.images).length ? compact(args.images) : compact([args.input_reference || args.frame_url])
  return {
    image: args.prompt_profile === 'h3'
      ? [...h3Images, ...compact(args.reference_image_urls || args.reference_urls)]
      : compact([args.frame_url, ...(args.reference_image_urls || args.reference_urls || [])]),
    video: compact(args.reference_video_urls), audio: compact(args.reference_audio_urls),
  }
}

export async function validatePreviousTailBinding(rootArg, shot, manifest) {
  if (shot?.continuity?.mode !== 'previous-tail') return
  if (!['first-last-frame', 'I2VA', 'FL2VA'].includes(shot.input_mode)) throw new Error('previous-tail 要求模型与输入模式支持 video.first-frame')
  if (shot.continuity.required_provider_capability !== 'video.first-frame' || !Number.isInteger(shot.continuity.source_shot_number) || shot.continuity.source_shot_number < 1) throw new Error('previous-tail 连续性合同缺少 video.first-frame 或有效来源镜号')
  const firstImage = (manifest || []).filter((item) => item?.type === 'image').sort((left, right) => left.order - right.order)[0]
  if (!firstImage || firstImage.order !== 1 || firstImage.role !== 'first_frame') throw new Error('previous-tail 必须是第一个 image 引用并使用 role=first_frame')
  const match = /^other-transition-(ep\d{3})-(\d{3})$/.exec(firstImage.asset_key)
  if (!match || Number(match[2]) !== shot.shot_number) throw new Error('previous-tail first_frame 资产与目标镜号不一致')

  const root = await realpath(resolve(rootArg))
  const tail = await selectedAssetVersion(root, firstImage.asset_key)
  if (tail.version.id !== firstImage.version_id || tail.version.provenance?.origin !== 'transformed' || tail.version.provenance.created_by !== 'codex' || tail.version.provenance.model_or_workflow !== 'ffmpeg-extract-frame') throw new Error('previous-tail first_frame 必须是当前 selected 的确定性尾帧派生资产')
  const sourceKey = `shot-${match[1]}-${String(shot.continuity.source_shot_number).padStart(3, '0')}`
  const sourceReference = tail.version.provenance.source_assets?.find((item) => item.key === sourceKey)
  const source = await selectedAssetVersion(root, sourceKey)
  if (!sourceReference || sourceReference.version_id !== source.version.id || tail.version.provenance.parameters?.source_sha256 !== source.version.sha256) throw new Error('previous-tail 来源版本或 SHA-256 与上一镜当前 selected 版本不一致')
  const promptReference = tail.version.provenance.prompt_document
  if (promptReference?.kind !== 'continuity-plan' || promptReference.episode_key !== match[1].replace('ep', 'ep-') || promptReference.shot_number !== shot.shot_number) throw new Error('previous-tail 缺少匹配目标镜头的连续性计划来源')
}

export async function validateVideoReferenceBindings(rootArg, provider, args, manifest, { requireSelected = true, at = Date.now() } = {}) {
  const root = await realpath(resolve(rootArg))
  const actual = inputs(provider, args)
  if (actual.sequential) {
    if (actual.sequential.length !== manifest.length) throw new Error('视频 reference_manifest 与本地 reference_paths 数量不一致')
  } else for (const type of ['image', 'video', 'audio']) {
    if ((actual[type] || []).length !== manifest.filter((item) => item?.type === type).length) throw new Error(`视频 ${type} 实际参考素材与 reference_manifest 数量不一致`)
  }
  const ledger = JSON.parse(await readFile(resolve(root, '.short-drama/assets.json'), 'utf8'))
  for (const [index, reference] of manifest.entries()) {
    const asset = ledger.assets?.[reference.asset_key]
    const version = asset?.versions?.find((item) => item.id === reference.version_id)
    if (!version || requireSelected && (asset.staleVersionIds?.includes(reference.version_id) || asset.selectedVersionId !== reference.version_id)) throw new Error(`参考素材不是${requireSelected ? '当前 selected 且未失效的' : '已登记的'}版本：${reference.asset_key}@${reference.version_id}`)
    const value = actual.sequential?.[index] ?? actual[reference.type]?.[reference.order - 1]
    if (!value) throw new Error(`参考素材缺少实际输入：${reference.asset_key}@${reference.version_id}`)
    if (actual.local) {
      if (await realpath(resolve(value)) !== await realpath(resolve(root, version.localPath))) throw new Error(`本地参考路径与资产版本不一致：${reference.asset_key}@${reference.version_id}`)
    } else await validateTemporaryReferenceUrl(root, value, reference, at)
  }
}
