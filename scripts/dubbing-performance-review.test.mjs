import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { addAssetVersion, putAsset, selectAssetVersion } from './asset-ledger.mjs'
import { DUBBING_REVIEW_DIMENSIONS, putDubbingPerformanceReview } from './dubbing-performance-review.mjs'

const sourceSha = 'a'.repeat(64)

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`)
}

function provenance(origin = 'imported', sourceAssets = []) {
  return { origin, created_by: origin === 'imported' ? 'user' : 'provider', provider: origin === 'imported' ? null : 'test', model_or_workflow: origin === 'imported' ? null : 'lip-sync', task_id: origin === 'imported' ? null : 'task-1', prompt_document: null, source_assets: sourceAssets, parameters: {} }
}

function dimension(status = 'passed') { return { status, evidence: status === 'passed' ? '完整观看并通过' : '情绪表现不合格' } }

function dimensions(overrides = {}) {
  const result = Object.fromEntries(DUBBING_REVIEW_DIMENSIONS.map((key) => [key, dimension()]))
  result.technical_audio = { ...dimension(), checks: { clipping: false, swallowed_words: false, tail_cutoff: false, unnatural_tempo: false, loudness_blocker: false } }
  return { ...result, ...overrides }
}

function review(assetSha, overrides = {}) {
  return {
    asset_key: 'audio-ep001-line-001', version_id: 'v002', asset_sha256: assetSha,
    episode_key: 'ep-001', line_index: 1, audio_plan_version: 'v001', timing_version_id: 'v001',
    reviewer: 'codex', watched_full: true, dimensions: dimensions(), issues: [], ...overrides,
  }
}

async function fixture(root) {
  const audioDirectory = resolve(root, 'assets/audio/audio-ep001-line-001')
  await mkdir(audioDirectory, { recursive: true })
  await writeFile(resolve(audioDirectory, 'v001.wav'), 'old-audio')
  await writeFile(resolve(audioDirectory, 'v002.wav'), 'new-audio')
  await putAsset(root, { key: 'audio-ep001-line-001', type: 'audio', name: '对白' })
  await addAssetVersion(root, 'audio-ep001-line-001', { id: 'v001', localPath: 'assets/audio/audio-ep001-line-001/v001.wav', provenance: provenance() })
  const audio = await addAssetVersion(root, 'audio-ep001-line-001', { id: 'v002', localPath: 'assets/audio/audio-ep001-line-001/v002.wav', provenance: provenance() })
  await selectAssetVersion(root, 'audio-ep001-line-001', 'v001')

  const shotDirectory = resolve(root, 'assets/videos/shot-ep001-001')
  await mkdir(shotDirectory, { recursive: true })
  await writeFile(resolve(shotDirectory, 'v001.mp4'), 'lip-sync-video')
  await putAsset(root, { key: 'shot-ep001-001', type: 'video', name: '口型镜头' })
  await addAssetVersion(root, 'shot-ep001-001', { id: 'v001', localPath: 'assets/videos/shot-ep001-001/v001.mp4', provenance: provenance('transformed', [{ key: 'audio-ep001-line-001', version_id: 'v001' }]) })
  await selectAssetVersion(root, 'shot-ep001-001', 'v001')

  const timing = { episode_key: 'ep-001', source_asset: { asset_key: 'shot-ep001-001', version_id: 'v001', sha256: sourceSha }, method: 'manual-direction', reviewed: true, language: 'zh-CN', lines: [{ line_index: 1, start_ms: 0, end_ms: 1000, words: [{ text: '别', start_ms: 0, end_ms: 300 }], evidence: '人工逐帧核对' }] }
  await writeJson(resolve(root, 'episodes/ep-001/speech-timing/v001.json'), timing)
  await writeJson(resolve(root, 'episodes/ep-001/speech-timing/selected.json'), { versionId: 'v001', path: 'episodes/ep-001/speech-timing/v001.json', source_asset_sha256: sourceSha, reviewed_by: 'codex' })
  const contract = { mode: 'generated', timing_source: { episode_key: 'ep-001', version_id: 'v001', line_index: 1, source_asset: timing.source_asset }, target_range: { start_ms: 0, end_ms: 1000 }, performance: { intent: '阻止对方', subtext: '压住恐惧', emotion_arc: [{ at: 0, emotion: '警觉', intensity: 0.4 }, { at: 1, emotion: '急迫', intensity: 0.8 }], emphasis: ['别'], pause_plan: [{ after: '别', duration_ms: 80 }], breath: '轻吸气' }, fit_policy: { tolerance: 'one-frame', max_paid_generations: 3, allow_parameter_regeneration: true, allow_semantic_adaptation: true, max_post_tempo_percent: 3 }, adaptation: null }
  await writeJson(resolve(root, 'episodes/ep-001/audio-plan/v001.json'), { episode_key: 'ep-001', lines: [{ line_index: 1, dubbing_contract: contract }] })
  await writeJson(resolve(root, 'episodes/ep-001/audio-plan/selected.json'), { versionId: 'v001' })
  return audio.versions.find((item) => item.id === 'v002').sha256
}

test('八维任一失败或 P1 均不得选版', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'dubbing-review-failed-'))
  try {
    const sha = await fixture(root)
    const result = await putDubbingPerformanceReview(root, review(sha, { dimensions: dimensions({ emotion_arc: dimension('failed') }), issues: [{ severity: 'P1', message: '情绪平直' }] }))
    assert.equal(result.approved, false)
    assert.equal(result.selected, false)
    const ledger = JSON.parse(await readFile(resolve(root, '.short-drama/assets.json'), 'utf8'))
    assert.equal(ledger.assets['audio-ep001-line-001'].selectedVersionId, 'v001')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('通过审核后原子选版并递归失效旧音频派生口型', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'dubbing-review-pass-'))
  try {
    const sha = await fixture(root)
    const result = await putDubbingPerformanceReview(root, review(sha))
    assert.equal(result.approved, true)
    assert.equal(result.selected, true)
    assert.deepEqual(result.invalidated, ['shot-ep001-001@v001'])
    const ledger = JSON.parse(await readFile(resolve(root, '.short-drama/assets.json'), 'utf8'))
    assert.equal(ledger.assets['audio-ep001-line-001'].selectedVersionId, 'v002')
    assert.equal(ledger.assets['shot-ep001-001'].selectedVersionId, null)
    assert.deepEqual(ledger.assets['shot-ep001-001'].staleVersionIds, ['v001'])
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('技术音频阻断项不得伪装为通过', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'dubbing-review-tech-'))
  try {
    const sha = await fixture(root)
    const technical = { ...dimension(), checks: { clipping: true, swallowed_words: false, tail_cutoff: false, unnatural_tempo: false, loudness_blocker: false } }
    await assert.rejects(() => putDubbingPerformanceReview(root, review(sha, { dimensions: dimensions({ technical_audio: technical }) })), /技术阻断项/)
  } finally { await rm(root, { recursive: true, force: true }) }
})
