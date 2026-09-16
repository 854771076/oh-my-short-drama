import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { addAssetVersion, putAsset, selectAssetVersion, selectedAssetVersion } from './asset-ledger.mjs'
import { DUBBING_REVIEW_DIMENSIONS, putDubbingPerformanceReview } from './dubbing-performance-review.mjs'
import { putFinalSpeechAlignment } from './speech-timing.mjs'
import { resolveGeneratedDubbingContract } from './dubbing-contract-resolution.mjs'
import { fingerprint } from './task-ledger.mjs'
import { call } from './generation/mcp.mjs'

const sourceSha = 'a'.repeat(64)

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`)
}

function provenance(origin = 'imported', sourceAssets = [], parameters = {}) {
  return { origin, created_by: origin === 'imported' ? 'user' : 'provider', provider: origin === 'imported' ? null : 'test', model_or_workflow: origin === 'imported' ? null : 'lip-sync', task_id: origin === 'imported' ? null : 'task-1', prompt_document: null, source_assets: sourceAssets, parameters }
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

async function fixture(root, alignmentOverrides = {}) {
  const audioDirectory = resolve(root, 'assets/audio/audio-ep001-line-001')
  await mkdir(audioDirectory, { recursive: true })
  await writeFile(resolve(audioDirectory, 'v001.wav'), 'old-audio')
  await writeFile(resolve(audioDirectory, 'v002.wav'), 'new-audio')
  await putAsset(root, { key: 'audio-ep001-line-001', type: 'audio', name: '对白' })
  await addAssetVersion(root, 'audio-ep001-line-001', { id: 'v001', localPath: 'assets/audio/audio-ep001-line-001/v001.wav', provenance: provenance('imported', [], { media_role: 'non-dialogue' }) })
  const audio = await addAssetVersion(root, 'audio-ep001-line-001', { id: 'v002', localPath: 'assets/audio/audio-ep001-line-001/v002.wav', provenance: provenance() })

  const shotDirectory = resolve(root, 'assets/videos/shot-ep001-001')
  await mkdir(shotDirectory, { recursive: true })
  await writeFile(resolve(shotDirectory, 'v001.mp4'), 'lip-sync-video')
  await putAsset(root, { key: 'shot-ep001-001', type: 'video', name: '口型镜头' })
  await addAssetVersion(root, 'shot-ep001-001', { id: 'v001', localPath: 'assets/videos/shot-ep001-001/v001.mp4', provenance: provenance('transformed', [{ key: 'audio-ep001-line-001', version_id: 'v001' }]) })
  await selectAssetVersion(root, 'shot-ep001-001', 'v001')

  const timing = { episode_key: 'ep-001', source_asset: { asset_key: 'shot-ep001-001', version_id: 'v001', sha256: sourceSha }, method: 'manual-direction', reviewed: true, language: 'zh-CN', lines: [{ line_index: 1, start_ms: 0, end_ms: 1000, words: [{ text: '别', start_ms: 0, end_ms: 300 }], evidence: '人工逐帧核对' }] }
  await writeJson(resolve(root, 'episodes/ep-001/speech-timing/v001.json'), timing)
  await writeJson(resolve(root, 'episodes/ep-001/speech-timing/selected.json'), { versionId: 'v001', path: 'episodes/ep-001/speech-timing/v001.json', source_asset_sha256: sourceSha, reviewed_by: 'codex' })
  const contract = { mode: 'generated', timing_source: { episode_key: 'ep-001', version_id: 'v001', line_index: 1, source_asset: timing.source_asset }, target_range: { start_ms: 0, end_ms: 1000 }, original_text: '别', adapted_text: '别', performance: { intent: '阻止对方', subtext: '压住恐惧', emotion_arc: [{ at: 0, emotion: '警觉', intensity: 0.4 }, { at: 1, emotion: '急迫', intensity: 0.8 }], emphasis: ['别'], pause_plan: [{ after: '别', duration_ms: 80 }], breath: '轻吸气' }, fit_policy: { tolerance: 'one-frame', max_paid_generations: 3, allow_parameter_regeneration: true, allow_semantic_adaptation: true, max_post_tempo_percent: 3 }, adaptation: null }
  await writeJson(resolve(root, 'episodes/ep-001/audio-plan/v001.json'), { episode_key: 'ep-001', lines: [{ line_index: 1, dubbing_contract: contract }] })
  await writeJson(resolve(root, 'episodes/ep-001/audio-plan/selected.json'), { versionId: 'v001' })
  const oldSha = audio.versions.find((item) => item.id === 'v001').sha256
  await putFinalSpeechAlignment(root, {
    episode_key: 'ep-001', line_index: 1, audio_asset: { asset_key: 'audio-ep001-line-001', version_id: 'v001', sha256: oldSha },
    audio_plan_version: 'v001', source_timing: { version_id: 'v001', line_index: 1, source_asset: timing.source_asset },
    text: '别', words: [{ text: '别', start_ms: 0, end_ms: 1000 }], timeline_mapping: { audio_in_ms: 0, timeline_at_ms: 0 }, timeline_fps: 24, reviewed: true,
  })
  await writeJson(resolve(root, '.short-drama/dubbing-reviews.json'), { version: 1, reviews: { 'audio-ep001-line-001@v001': { review_type: 'dubbing-performance', approved: true, asset_sha256: oldSha, selection_state: 'committed' } } })
  await selectAssetVersion(root, 'audio-ep001-line-001', 'v001')
  const sha = audio.versions.find((item) => item.id === 'v002').sha256
  await putFinalSpeechAlignment(root, {
    episode_key: 'ep-001', line_index: 1, audio_asset: { asset_key: 'audio-ep001-line-001', version_id: 'v002', sha256: sha },
    audio_plan_version: 'v001', source_timing: { version_id: 'v001', line_index: 1, source_asset: timing.source_asset },
    text: '别', words: [{ text: '别', start_ms: 0, end_ms: 1000 }], timeline_mapping: { audio_in_ms: 0, timeline_at_ms: 0 }, timeline_fps: 24, reviewed: true,
    ...alignmentOverrides,
  })
  return sha
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

test('最终对齐的音频 SHA、词文本或一帧边界不匹配时不得审核选版', async () => {
  for (const [name, overrides, pattern] of [
    ['空词', { words: [] }, /非空词级对齐/],
    ['SHA 漂移', { audio_asset: { asset_key: 'audio-ep001-line-001', version_id: 'v002', sha256: 'f'.repeat(64) } }, /SHA/],
    ['文本漂移', { text: '快走', words: [{ text: '快走', start_ms: 0, end_ms: 1000 }] }, /文本不一致/],
    ['超帧', { words: [{ text: '别', start_ms: 100, end_ms: 900 }] }, /一帧/],
  ]) {
    const root = await mkdtemp(resolve(tmpdir(), `dubbing-review-${name}-`))
    try {
      if (name === '空词') {
        await assert.rejects(() => fixture(root, overrides), pattern)
      } else {
        const sha = await fixture(root, overrides)
        await assert.rejects(() => putDubbingPerformanceReview(root, review(sha)), pattern)
      }
    } finally { await rm(root, { recursive: true, force: true }) }
  }
})

test('公共选版入口不能用伪造 media_role 绕过对白八维审核，合法音乐和 SFX 按可信身份豁免', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'dubbing-review-selection-gate-'))
  try {
    await fixture(root)
    await assert.rejects(() => selectAssetVersion(root, 'audio-ep001-line-001', 'v002'), /八维审核/)
    assert.equal((await selectAssetVersion(root, 'audio-ep001-line-001', 'v001')).selectedVersionId, 'v001')
    for (const [key, name] of [['audio-ep001-bgm-001', '配乐'], ['audio-ep001-sfx-door', '门声']]) {
      const path = resolve(root, `assets/audio/${key}/v001.wav`)
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, name)
      await putAsset(root, { key, type: 'audio', name })
      await addAssetVersion(root, key, { id: 'v001', localPath: `assets/audio/${key}/v001.wav`, provenance: provenance('imported') })
      assert.equal((await selectAssetVersion(root, key, 'v001')).selectedVersionId, 'v001')
    }
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('审核写入后进程中断，重复请求会恢复并完成选版事务', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'dubbing-review-recovery-'))
  try {
    const sha = await fixture(root)
    await assert.rejects(() => putDubbingPerformanceReview(root, review(sha), { fail_after_review_write: true }), /故障注入/)
    const pending = JSON.parse(await readFile(resolve(root, '.short-drama/dubbing-reviews.json'), 'utf8'))
    assert.equal(pending.reviews['audio-ep001-line-001@v002'].selection_state, 'pending')
    const result = await putDubbingPerformanceReview(root, review(sha))
    assert.equal(result.selected, true)
    const committed = JSON.parse(await readFile(resolve(root, '.short-drama/dubbing-reviews.json'), 'utf8'))
    assert.equal(committed.reviews['audio-ep001-line-001@v002'].selection_state, 'committed')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('资产已选但审核提交前中断时，对白版本不可消费且重试可提交', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'dubbing-review-asset-recovery-'))
  try {
    const sha = await fixture(root)
    await assert.rejects(() => putDubbingPerformanceReview(root, review(sha), { fail_after_asset_selection: true }), /故障注入/)
    await assert.rejects(() => selectedAssetVersion(root, 'audio-ep001-line-001'), /八维审核/)
    await putDubbingPerformanceReview(root, review(sha))
    assert.equal((await selectedAssetVersion(root, 'audio-ep001-line-001')).version.id, 'v002')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('native-preserve 兜底的派生合同可完成对齐、八维审核、选版并由下游可信解析', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'dubbing-review-fallback-'))
  try {
    await fixture(root)
    const assetsPath = resolve(root, '.short-drama/assets.json')
    const assets = JSON.parse(await readFile(assetsPath, 'utf8'))
    assets.assets['shot-ep001-001'].versions[0].provenance = provenance('imported')
    await writeJson(assetsPath, assets)
    const planPath = resolve(root, 'episodes/ep-001/audio-plan/v001.json')
    const plan = JSON.parse(await readFile(planPath, 'utf8'))
    const generated = {
      ...plan.lines[0].dubbing_contract,
      target_speech_ms: 1000,
      performance: { ...plan.lines[0].dubbing_contract.performance, pace: '自然语速', distance_and_space: '近距离' },
      fit_policy: { max_paid_generations: 3, provider_speed_min: 0.85, provider_speed_max: 1.15, max_post_tempo_percent: 3, text_adaptation_allowed: true },
    }
    const binding = { speaker: '林晚', provider: 'test', model: 'speech', voice_id: 'linwan', voice_role: 'character' }
    plan.approved = true
    plan.unresolved = []
    plan.voice_bindings = [binding]
    plan.lines[0] = {
      ...plan.lines[0], speaker: '林晚', content: '别', delivery_mode: 'native', presentation: 'visible-dialogue',
      dubbing_contract: { mode: 'native-preserve', timing_source: generated.timing_source, target_range: generated.target_range, performance_reference: { intent: generated.performance.intent, subtext: generated.performance.subtext, emotion_arc: generated.performance.emotion_arc, emphasis: generated.performance.emphasis, pause_plan: generated.performance.pause_plan, breath: generated.performance.breath } },
    }
    await writeJson(planPath, plan)

    const record = { version: 1, episode_key: 'ep-001', line_index: 1, audio_plan_version: 'v001', source_video: { asset_key: 'shot-ep001-001', version_id: 'v001' }, native_audio_exception: { reason: 'speech-intelligibility-failed', evidence: '原声含混', range: { start_ms: 0, end_ms: 1000 } }, voice_binding: binding, generated_contract: generated }
    const derivedSha = createHash('sha256').update(JSON.stringify(record)).digest('hex')
    const derivedPath = `episodes/ep-001/audio-plan/fallback-contracts/line-001-${derivedSha.slice(0, 16)}.json`
    await writeJson(resolve(root, derivedPath), record)
    const snapshot = { episode_key: 'ep-001', line_index: 1, contract_version: 'v001', timing_version: 'v001', attempt: 1, target_range: generated.target_range, text_version: 'original', capability_gaps: [], derived_contract: { path: derivedPath, sha256: derivedSha } }
    const fallbackPath = resolve(root, 'assets/audio/audio-ep001-line-001/v003.wav')
    await writeFile(fallbackPath, 'fallback-audio')
    const fallbackAsset = await addAssetVersion(root, 'audio-ep001-line-001', { id: 'v003', localPath: 'assets/audio/audio-ep001-line-001/v003.wav', provenance: provenance('generated', [{ key: 'shot-ep001-001', version_id: 'v001' }], { dubbing_compiler: { snapshot, sha256: fingerprint(snapshot) } }) })
    const fallback = fallbackAsset.versions.find((item) => item.id === 'v003')
    await putFinalSpeechAlignment(root, { episode_key: 'ep-001', line_index: 1, audio_asset: { asset_key: 'audio-ep001-line-001', version_id: 'v003', sha256: fallback.sha256 }, audio_plan_version: 'v001', source_timing: { version_id: 'v001', line_index: 1, source_asset: generated.timing_source.source_asset }, text: '别', words: [{ text: '别', start_ms: 0, end_ms: 1000 }], timeline_mapping: { audio_in_ms: 0, timeline_at_ms: 0 }, timeline_fps: 24, reviewed: true })

    const result = await putDubbingPerformanceReview(root, review(fallback.sha256, { version_id: 'v003' }))
    assert.equal(result.selected, true)
    assert.equal((await selectedAssetVersion(root, 'audio-ep001-line-001')).version.id, 'v003')
    const resolved = await resolveGeneratedDubbingContract(root, { plan, planVersion: 'v001', line: plan.lines[0], audioVersion: fallback })
    assert.equal(resolved.source, 'native-fallback')
    assert.deepEqual(resolved.contract, generated)
    const subtitles = await call('build_subtitles_from_audio', { project_root: root, episode_key: 'ep-001', line_index: 1, fps: 24, timeline_end_ms: 1200 })
    assert.equal(subtitles[0].audio_binding.asset_key, 'audio-ep001-line-001')
    assert.equal(subtitles[0].text, '别')
  } finally { await rm(root, { recursive: true, force: true }) }
})
