#!/usr/bin/env node
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PREVIZ_REQUIRED_HARD_GATES, fileSha256, probePrevizMedia, supportsPrevizMotionReference, validateMotionReferenceBinding, validatePrevizContract, validatePrevizMedia } from './previz-contract.mjs'
import { missingPrevizAssets, missingPrevizReviews } from './workflow-gates.mjs'
import { PREVIZ_REVIEW_CRITERIA } from './review-ledger.mjs'
import { referenceInputs } from './generation/mcp.mjs'
import { validateVideoReferenceBindings } from './reference-bindings.mjs'

const scripts = dirname(fileURLToPath(import.meta.url))
function run(script, ...args) {
  const result = spawnSync(process.execPath, [resolve(scripts, script), ...args], { encoding: 'utf8' })
  if (result.status !== 0) throw new Error(`${script} 失败：${result.stderr || result.stdout}`)
  return result.stdout
}

function contract() {
  return {
    schema_version: 1,
    source: { episode_key: 'ep-001', storyboard_version: 'v001', production_plan_version: 'v001', shot_number: 1, storyboard_medium: 'blender', board_asset: null },
    direction: {
      dramatic_intent: '人物 A 进攻，人物 B 防守后稳定局面。', primary_read: '攻防接管清楚。',
      axis: { line: 'A 与 B 的对抗线', camera_side: '南侧', screen_direction: 'A 左向右，B 右向左' },
      beats: [
        { name: '建立', start_frame: 1, end_frame: 8, actor: '双方', action: '建立距离', result: '空间清楚' },
        { name: '攻防', start_frame: 8, end_frame: 18, actor: '双方', action: '攻击与格挡', result: '接触成立' },
        { name: '结果', start_frame: 18, end_frame: 24, actor: '双方', action: '卸力停稳', result: '镜尾稳定' },
      ],
      camera: { shot_size: '全景—正打—反打—双人', principal_move: 'axis_safe_coverage', motivation: '拆开意图与反应', stop_frame: 16 },
      continuity: { entry_exit: '双方不出画', eyelines: '互看', end_state: '双方恢复警戒' },
    },
    review_contract: { hard_gates: PREVIZ_REQUIRED_HARD_GATES, score_target: 85 },
    fps: 12, duration_seconds: 2, resolution: [160, 90],
    cameras: [
      { name: '建立', location: [0, -8, 3], target: [0, 0, 1.4], lens: 50, keyframes: [] },
      { name: '正打', location: [2, -6, 2], target: [-1, 0, 1.4], lens: 60, keyframes: [] },
      { name: '反打', location: [-2, -6, 2], target: [1, 0, 1.4], lens: 60, keyframes: [] },
    ],
    camera_cuts: [{ frame: 1, camera: '建立' }, { frame: 9, camera: '正打' }, { frame: 17, camera: '反打' }],
    objects: [{ name: '人物A', shape: 'human', location: [-1, 0, 0], scale: [1, 1, 1] }],
    contact_checks: [{ frame: 16 }],
  }
}

function video(path, seconds) {
  const result = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `color=c=gray:s=160x90:r=12:d=${seconds}`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path], { encoding: 'utf8' })
  if (result.error?.code === 'ENOENT') throw new Error('缺少 ffmpeg，无法执行白模媒体集成自检')
  if (result.status !== 0) throw new Error(result.stderr || '白模测试视频生成失败')
}

const root = await mkdtemp(resolve(tmpdir(), 'short-drama-previz-check-'))
try {
  const spec = contract()
  validatePrevizContract(spec, { episode: 'ep-001', storyboardVersion: 'v001', productionPlanVersion: 'v001', shotNumber: 1 })
  const gap = structuredClone(spec); gap.direction.beats[1].start_frame = 10
  try { validatePrevizContract(gap); throw new Error('节拍空档未被拒绝') } catch (error) { if (!String(error.message).includes('空档')) throw error }
  const overlap = structuredClone(spec); overlap.direction.beats[1].start_frame = 5
  try { validatePrevizContract(overlap); throw new Error('节拍倒序或过度重叠未被拒绝') } catch (error) { if (!String(error.message).includes('倒序或过度重叠')) throw error }
  const contactCut = structuredClone(spec); contactCut.camera_cuts[1].frame = 16
  try { validatePrevizContract(contactCut); throw new Error('接触帧切镜未被拒绝') } catch (error) { if (!String(error.message).includes('接触帧')) throw error }
  if (!supportsPrevizMotionReference('runninghub', 'minimax-h3-reference-to-video') || supportsPrevizMotionReference('starrouter', 'MiniMax-H3') || supportsPrevizMotionReference('starrouter', 'MiniMax-H3-Max') || supportsPrevizMotionReference('comfly', 'minimax-h3')) throw new Error('白模参考视频能力矩阵错误')

  const contractPath = resolve(root, 'episodes/ep-001/previz/shot-001-v001.json')
  const mediaPath = resolve(root, 'assets/other/other-previz-ep001-001/v001.mp4')
  await mkdir(resolve(contractPath, '..'), { recursive: true })
  await mkdir(resolve(mediaPath, '..'), { recursive: true })
  await mkdir(resolve(root, '.short-drama'), { recursive: true })
  await mkdir(resolve(root, 'episodes/ep-001/storyboard'), { recursive: true })
  await mkdir(resolve(root, 'episodes/ep-001/production-plan'), { recursive: true })
  await writeFile(resolve(root, 'episodes/ep-001/storyboard/v001.json'), `${JSON.stringify({ episode_key: 'ep-001', source_versions: { director_book: 'v001' }, panels: [{ panel_number: 1, shot_number: 1, description: '攻防测试', characters: [{ name: '人物A' }], location: '测试场', source_text: '人物A进攻。', duration: 2 }] })}\n`)
  await writeFile(resolve(root, 'episodes/ep-001/storyboard/selected.json'), `${JSON.stringify({ versionId: 'v001', path: 'episodes/ep-001/storyboard/v001.json' })}\n`)
  await writeFile(resolve(root, 'episodes/ep-001/production-plan/v001.json'), `${JSON.stringify({ shots: [{ shot_number: 1, duration_seconds: 2, provider: 'runninghub', model_or_workflow: 'minimax-h3-reference-to-video', previz_strategy: { mode: 'blender', purpose: 'review', fps: 12 } }] })}\n`)
  await writeFile(resolve(root, 'episodes/ep-001/production-plan/selected.json'), `${JSON.stringify({ versionId: 'v001', path: 'episodes/ep-001/production-plan/v001.json' })}\n`)
  await writeFile(contractPath, `${JSON.stringify(spec, null, 2)}\n`)
  video(mediaPath, 2)
  const originalMedia = await readFile(mediaPath)
  const media = probePrevizMedia(mediaPath)
  validatePrevizMedia(media, spec, { duration_seconds: 2, previz_strategy: { fps: 12 } })
  const [mediaHash, contractHash] = await Promise.all([fileSha256(mediaPath), fileSha256(contractPath)])
  const provenance = { origin: 'generated', created_by: 'codex', provider: null, model_or_workflow: 'blender-eevee-previz', task_id: null, prompt_document: { kind: 'storyboard', episode_key: 'ep-001', version_id: 'v001', shot_number: 1 }, source_assets: [], parameters: { duration: 2, direction_contract: 'episodes/ep-001/previz/shot-001-v001.json', direction_contract_sha256: contractHash } }
  await writeFile(resolve(root, 'asset.json'), `${JSON.stringify({ key: 'other-previz-ep001-001', type: 'other', name: '白模测试' })}\n`)
  await writeFile(resolve(root, 'version.json'), `${JSON.stringify({ id: 'v001', localPath: 'assets/other/other-previz-ep001-001/v001.mp4', provenance })}\n`)
  run('asset-ledger.mjs', 'put', root, resolve(root, 'asset.json'))
  run('asset-ledger.mjs', 'add-version', root, 'other-previz-ep001-001', resolve(root, 'version.json'))
  let assets = JSON.parse(run('asset-ledger.mjs', 'list', root))
  let version = assets.assets['other-previz-ep001-001'].versions[0]
  const shot = { shot_number: 1, duration_seconds: 2, previz_strategy: { mode: 'blender', purpose: 'review', fps: 12 } }
  const breakdown = { '剧情因果与节拍': 18, '人物调度与表演': 13, '相机动机与运动曲线': 18, '构图与视觉层级': 13, '空间、轴线与连续性': 13, '物理与接触': 8, '技术交付': 5 }
  const review = { assetKey: 'other-previz-ep001-001', versionId: 'v001', visual: 'passed', audio: 'not-applicable', transition: 'not-applicable', captions: 'not-applicable', issues: [], asset_sha256: version.sha256, watchedFull: true, watch_evidence: { duration_seconds: 2, start: '建立空间', middle: '接触清楚', end: '结果停稳' }, hard_gates: PREVIZ_REQUIRED_HARD_GATES.map((gate, index) => ({ gate, status: 'passed', frame: index + 1, observation: `${gate}在实际画面中成立` })), score: { total: 88, breakdown }, criteria: PREVIZ_REVIEW_CRITERIA.map((criterion) => ({ criterion, status: 'passed', observation: '实际画面可见' })) }
  await writeFile(resolve(root, 'review-invalid.json'), `${JSON.stringify({ ...review, hard_gates: [] })}\n`)
  try { run('review-ledger.mjs', 'put', root, resolve(root, 'review-invalid.json')); throw new Error('白模硬门禁证据缺失未被拒绝') } catch (error) { if (!String(error.message).includes('hard_gates')) throw error }
  const failedGateReview = { ...review, hard_gates: review.hard_gates.map((item, index) => index === 0 ? { ...item, status: 'failed', observation: '剧情因果在该帧不可读' } : item) }
  await writeFile(resolve(root, 'review-failed-gate.json'), `${JSON.stringify(failedGateReview)}\n`)
  const failedGateResult = JSON.parse(run('review-ledger.mjs', 'put', root, resolve(root, 'review-failed-gate.json')))
  if (failedGateResult.approved || failedGateResult.selected) throw new Error('白模硬门禁失败仍被批准或选版')
  await writeFile(resolve(root, 'review.json'), `${JSON.stringify(review)}\n`)
  run('review-ledger.mjs', 'put', root, resolve(root, 'review.json'))
  assets = JSON.parse(run('asset-ledger.mjs', 'list', root))
  version = assets.assets['other-previz-ep001-001'].versions[0]
  if (assets.assets['other-previz-ep001-001'].selectedVersionId !== 'v001') throw new Error('白模审核通过后未原子选版')
  const motionPlan = { ...shot, provider: 'runninghub', model_or_workflow: 'minimax-h3-reference-to-video', previz_strategy: { ...shot.previz_strategy, purpose: 'motion-reference' } }
  const motionPrompt = { references: [{ type: 'video', order: 1, asset_key: 'other-previz-ep001-001', version_id: 'v001', role: 'reference_video' }] }
  validateMotionReferenceBinding('ep-001', motionPlan, motionPrompt, assets)
  const mapped = referenceInputs('runninghub', { ...motionPlan, ...motionPrompt }, () => mediaPath)
  if (mapped.missing.length || mapped.args.reference_video_paths?.[0] !== mediaPath) throw new Error('白模运动参考未映射到 RunningHub 本地视频输入')
  await validateVideoReferenceBindings(root, 'runninghub', { model: motionPlan.model_or_workflow, input_mode: 'Ref2VA', reference_manifest: motionPrompt.references, ...mapped.args }, motionPrompt.references)
  try { validateMotionReferenceBinding('ep-001', motionPlan, { references: [] }, assets); throw new Error('缺少白模运动参考未被拒绝') } catch (error) { if (!String(error.message).includes('必须精确引用')) throw error }
  if ((await missingPrevizAssets(root, 'ep-001', 'v001', [shot], assets, 'v001')).length) throw new Error('有效白模资产未通过门禁')
  await writeFile(mediaPath, Buffer.concat([await readFile(mediaPath), Buffer.from('tampered')]))
  if ((await missingPrevizAssets(root, 'ep-001', 'v001', [shot], assets, 'v001')).length !== 1) throw new Error('白模媒体篡改未被拒绝')
  video(mediaPath, 1)
  version.sha256 = await fileSha256(mediaPath)
  if ((await missingPrevizAssets(root, 'ep-001', 'v001', [shot], assets, 'v001')).length !== 1) throw new Error('白模实际短时长未被拒绝')
  await writeFile(mediaPath, originalMedia)
  version.sha256 = mediaHash
  const reviews = JSON.parse(run('review-ledger.mjs', 'list', root))
  if (missingPrevizReviews('ep-001', [shot], assets, reviews).length) throw new Error('有效白模审核未通过门禁')
  reviews.reviews['other-previz-ep001-001@v001'].asset_sha256 = '0'.repeat(64)
  if (missingPrevizReviews('ep-001', [shot], assets, reviews).length !== 1) throw new Error('白模审核哈希错绑未被拒绝')
  console.log('ok')
} finally {
  await rm(root, { recursive: true, force: true })
}
