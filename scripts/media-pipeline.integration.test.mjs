import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { validateAudienceAppeal, assertCharacterReadyForVisuals } from './character-appeal.mjs'
import { validateAudioPlan, validateAudioLine } from './audio-plan-contract.mjs'
import { validateContinuityPlan } from './continuity-plan.mjs'
import { addAssetVersion, invalidateDerivedAssets, putAsset, selectAssetVersion, selectedAssetVersion } from './asset-ledger.mjs'
import { preparePreviousTail } from './previous-tail.mjs'
import { executeLocalMediaOperation } from './media-operations.mjs'
import { getMusicLicense, putMusicLicense, validateMusicUse } from './music-license-ledger.mjs'

async function json(path, value) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`)
}

function video(path) {
  const result = spawnSync('ffmpeg', ['-nostdin', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=gray:s=640x360:r=24:d=2', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-shortest', '-c:v', 'mpeg4', '-c:a', 'aac', '-pix_fmt', 'yuv420p', '-y', path], { encoding: 'utf8' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(result.stderr || '测试视频生成失败')
}

const emptyState = () => ({ actors: [], props: [], axis_id: 'axis-a', camera_side: 'north', lighting_anchor: 'window-left' })
const link = (number) => number === 1
  ? { mode: 'independent', source_shot_number: null, source_camera_setup_id: null, enabled: false, reason: '首镜建立空间', required_provider_capability: null }
  : { mode: 'previous-tail', source_shot_number: 1, source_camera_setup_id: 'cam-a', enabled: true, reason: '同机位承接', required_provider_capability: 'video.first-frame' }

function continuityPlan() {
  return {
    episode_key: 'ep-001', source_versions: { storyboard: 'v001', 'director-book': 'v001', 'production-plan': 'v001' },
    scenes: [{ scene_key: 'scene-001', coordinate_mode: 'semantic', axis_id: 'axis-a', axis_description: '门至窗为主轴', camera_side: 'north', anchors: ['door', 'window'], lighting_anchor: 'window-left' }],
    shots: [1, 2].map((shot_number) => ({ shot_number, scene_key: 'scene-001', camera_setup_id: 'cam-a', start_state: emptyState(), end_state: emptyState(), transition_link: link(shot_number), inherited_fields: ['axis_id', 'camera_side'], allowed_changes: [], evidence: ['director-book:scene-001'] })),
    unresolved: [], approved: true,
  }
}

const fallbackReasons = ['provider-no-native-audio', 'voice-identity-drift', 'speech-intelligibility-failed', 'narration-performance-failed', 'audio-sync-failed', 'native-ambience-failed']
const audioPlan = { episode_key: 'ep-001', audio_strategy: { mode: 'native-first', provider_selection: 'prefer-native', fallback_allowed: true, fallback_reasons: fallbackReasons }, lines: [{ line_index: 1, speaker: '林晚', line_type: 'dialogue', content: '别回头。', emotion: '克制紧张', emotion_strength: 0.3, pronunciation_notes: [], matched_shot: { shot_number: 1 }, delivery_mode: 'native', presentation: 'visible-dialogue', fallback_mode: 'post-dub', source_audio: null, voice_binding: null, native_audio_exception: null, performance: null }], unresolved: [], approved: true }

test('人物、连续性、声音、授权音乐与媒体操作在同一临时项目闭环', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'media-pipeline-integration-'))
  try {
    await json(resolve(root, '.short-drama/assets.json'), { version: 1, assets: {} })
    await json(resolve(root, '.short-drama/shot-reviews.json'), { version: 1, reviews: {} })
    await json(resolve(root, '.short-drama/state.json'), { stage: 'editing', completed: [] })
    const adultAppeal = { age_class: 'adult', appeal_mode: 'adult-charisma', screen_presence: '清冷利落', grooming_and_makeup: '高马尾与干净眼妆', costume_signature: '墨黑风衣与银色领针', memory_anchors: ['高马尾', '银色领针'], prohibited_treatment: [] }
    const childAppeal = { age_class: 'child', appeal_mode: 'child-cuteness', screen_presence: '灵动童真', grooming_and_makeup: '自然短发与干净面容', costume_signature: '明黄雨衣', memory_anchors: ['翘起的短发'], prohibited_treatment: ['成人妆容'] }
    assert.equal(assertCharacterReadyForVisuals({ age_range: '28岁', role_level: 'S', audience_appeal: adultAppeal }).age_class, 'adult')
    assert.equal(assertCharacterReadyForVisuals({ age_range: '8岁', role_level: 'A', audience_appeal: childAppeal }).age_class, 'child')
    assert.throws(() => assertCharacterReadyForVisuals({ age_range: '未知', role_level: 'A', audience_appeal: { age_class: 'unknown', appeal_mode: 'not-applicable', screen_presence: '', grooming_and_makeup: '', costume_signature: '', memory_anchors: [], prohibited_treatment: [] } }), /年龄证据/)
    assert.throws(() => validateAudienceAppeal({ ...childAppeal, costume_signature: '成人化性感礼服' }, { age_range: '8岁', role_level: 'A' }), /儿童保护/)

    const plan = continuityPlan()
    validateContinuityPlan(plan, 'ep-001')
    await json(resolve(root, 'episodes/ep-001/continuity-plan/v001.json'), plan)
    await json(resolve(root, 'episodes/ep-001/continuity-plan/selected.json'), { versionId: 'v001', path: 'episodes/ep-001/continuity-plan/v001.json' })
    const sourcePath = resolve(root, 'assets/videos/shot-ep001-001/v001.mp4')
    await mkdir(dirname(sourcePath), { recursive: true })
    video(sourcePath)
    await putAsset(root, { key: 'shot-ep001-001', type: 'video', name: '镜头 1' })
    await addAssetVersion(root, 'shot-ep001-001', { id: 'v001', localPath: 'assets/videos/shot-ep001-001/v001.mp4', provenance: { origin: 'imported', created_by: 'user', provider: null, model_or_workflow: null, task_id: null, prompt_document: null, source_assets: [], parameters: {} } })
    await selectAssetVersion(root, 'shot-ep001-001', 'v001')
    await json(resolve(root, '.short-drama/shot-reviews.json'), { version: 1, reviews: { 'shot-ep001-001@v001': { approved: true } } })
    const tail = await preparePreviousTail({ projectRoot: root, episodeKey: 'ep-001', shotNumber: 2, continuityVersion: 'v001' })
    assert.equal(tail.asset_key, 'other-transition-ep001-002')

    assert.equal(validateAudioPlan(audioPlan, 'ep-001').audio_strategy.mode, 'native-first')
    assert.throws(() => validateAudioLine({ ...audioPlan.lines[0], speaker: 'narrator', line_type: 'voiceover', presentation: 'narration' }, 0), /旁白.*表演合同/)

    await mkdir(resolve(root, 'licenses'), { recursive: true })
    await writeFile(resolve(root, 'licenses/track.txt'), 'license proof')
    const receipt = { receipt_key: 'music-license-local-track', catalog: 'local-licensed', track_id: 'track', title: 'Tension', creator: 'Composer', source_url: 'https://example.com/track', license_name: 'Commercial Sync License', license_url: 'https://example.com/license', downloaded_at: '2026-09-16T08:00:00.000Z', attribution_required: false, attribution_text: '', content_id_risk: false, allowed_uses: ['online-video', 'commercial'], proof_path: 'licenses/track.txt' }
    await putMusicLicense(root, receipt)
    assert.equal(validateMusicUse(await getMusicLicense(root, receipt.receipt_key), { commercial: true, paid_ad: false, client_project: false, broadcast: false }).track_id, 'track')
    assert.throws(() => validateMusicUse(receipt, { commercial: true, paid_ad: true, client_project: false, broadcast: false }), /许可证用途/)

    const repaired = await executeLocalMediaOperation(root, { target: 'shot-ep001-001', operation: 'trim', source: { asset_key: 'shot-ep001-001', version_id: 'v001' }, range: { start_ms: 200, end_ms: 1400 }, parameters: {} })
    assert.notEqual(repaired.output_path, sourcePath)
    await assert.rejects(() => executeLocalMediaOperation(root, { target: 'shot-ep001-001', operation: 'trim', source: { asset_key: 'shot-ep001-001', version_id: 'v999' }, range: { start_ms: 200, end_ms: 1400 }, parameters: {} }), /selected|版本/)

    await invalidateDerivedAssets(root, { key: 'shot-ep001-001', version_id: 'v001' })
    await assert.rejects(() => selectedAssetVersion(root, tail.asset_key), /失效|selected/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

