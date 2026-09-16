import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { addAssetVersion, putAsset, selectAssetVersion } from './asset-ledger.mjs'
import { DUBBING_REVIEW_DIMENSIONS, putDubbingPerformanceReview } from './dubbing-performance-review.mjs'
import { validateTimeline } from './editing-store.mjs'
import { runDubbingLiveAcceptance } from './dubbing-live-acceptance.mjs'
import { call } from './generation/mcp.mjs'
import { putFinalSpeechAlignment } from './speech-timing.mjs'

async function json(path, value) { await mkdir(dirname(path), { recursive: true }); await writeFile(path, `${JSON.stringify(value, null, 2)}\n`) }
function imported() { return { origin: 'imported', created_by: 'user', provider: null, model_or_workflow: null, task_id: null, prompt_document: null, source_assets: [], parameters: {} } }
function transformed(sourceAssets, parameters) { return { origin: 'transformed', created_by: 'provider', provider: 'musetalk', model_or_workflow: 'musetalk-1.5', task_id: 'lip-task', prompt_document: null, source_assets: sourceAssets, parameters } }
function media(path, type, frequency = 440) {
  const input = type === 'video'
    ? ['-f', 'lavfi', '-i', 'color=c=gray:s=320x180:r=24:d=1', '-f', 'lavfi', '-i', `sine=frequency=${frequency}:duration=1`, '-shortest', '-c:v', 'mpeg4', '-c:a', 'aac', '-pix_fmt', 'yuv420p']
    : ['-f', 'lavfi', '-i', `sine=frequency=${frequency}:duration=1`, '-c:a', 'pcm_s16le']
  const result = spawnSync('ffmpeg', ['-nostdin', '-loglevel', 'error', ...input, '-y', path], { encoding: 'utf8' })
  if (result.error || result.status !== 0) throw new Error(result.stderr || '媒体夹具生成失败')
}

function review(assetSha, versionId) {
  const dimensions = Object.fromEntries(DUBBING_REVIEW_DIMENSIONS.map((key) => [key, { status: 'passed', evidence: `${key} 完整听看通过` }]))
  dimensions.technical_audio.checks = { clipping: false, swallowed_words: false, tail_cutoff: false, unnatural_tempo: false, loudness_blocker: false }
  return { asset_key: 'audio-ep001-line-001', version_id: versionId, asset_sha256: assetSha, episode_key: 'ep-001', line_index: 1, audio_plan_version: 'v001', timing_version_id: 'v001', reviewer: 'codex', watched_full: true, dimensions, issues: [], production_duration_ms: 1200, final_alignment: { words: [{ text: '别回头', start_ms: 100, end_ms: 900 }] } }
}

test('原声时间到配音选版、字幕和失效传播完整闭环', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'source-timed-dubbing-flow-'))
  try {
    await json(resolve(root, '.short-drama/project.json'), { format: { episode_duration_seconds: 1 } })
    await json(resolve(root, '.short-drama/state.json'), { stage: 'editing', completed: [] })
    await json(resolve(root, 'episodes/ep-001/episode.json'), { target_duration_seconds: 1 })

    const audioDir = resolve(root, 'assets/audio/audio-ep001-line-001')
    await mkdir(audioDir, { recursive: true })
    await putAsset(root, { key: 'audio-ep001-line-001', type: 'audio', name: '对白' })
    const versions = []
    for (const [id, frequency] of [['v001', 330], ['v002', 440], ['v003', 550]]) {
      media(resolve(audioDir, `${id}.wav`), 'audio', frequency)
      const asset = await addAssetVersion(root, 'audio-ep001-line-001', { id, localPath: `assets/audio/audio-ep001-line-001/${id}.wav`, provenance: imported() })
      versions.push(asset.versions.find((item) => item.id === id))
    }
    const videoDir = resolve(root, 'assets/videos/shot-ep001-001')
    await mkdir(videoDir, { recursive: true })
    media(resolve(videoDir, 'v001.mp4'), 'video')
    await putAsset(root, { key: 'shot-ep001-001', type: 'video', name: '镜头一' })
    await addAssetVersion(root, 'shot-ep001-001', { id: 'v001', localPath: 'assets/videos/shot-ep001-001/v001.mp4', provenance: { origin: 'generated', created_by: 'provider', provider: 'test', model_or_workflow: 'video', task_id: 'video-1', prompt_document: { episode_key: 'ep-001', version_id: 'v001', shot_number: 1 }, source_assets: [], parameters: {} } })
    await selectAssetVersion(root, 'shot-ep001-001', 'v001')
    const initialLedger = JSON.parse(await readFile(resolve(root, '.short-drama/assets.json'), 'utf8'))
    const sourceSha = initialLedger.assets['shot-ep001-001'].versions[0].sha256

    const timingDocument = { episode_key: 'ep-001', source_asset: { asset_key: 'shot-ep001-001', version_id: 'v001', sha256: sourceSha }, method: 'manual-direction', reviewed: true, language: 'zh-CN', lines: [{ line_index: 1, start_ms: 100, end_ms: 900, words: [{ text: '别回头', start_ms: 100, end_ms: 900 }], evidence: '人工逐帧核对' }] }
    await json(resolve(root, 'episodes/ep-001/speech-timing/v001.json'), timingDocument)
    await json(resolve(root, 'episodes/ep-001/speech-timing/selected.json'), { versionId: 'v001', path: 'episodes/ep-001/speech-timing/v001.json', source_asset_sha256: sourceSha, reviewed_by: 'codex' })
    await json(resolve(root, 'episodes/ep-001/speech-timing/selected-sources/shot-ep001-001/v001/selected.json'), { versionId: 'v001', source_asset_sha256: sourceSha, reviewed_by: 'codex' })
    const contract = { mode: 'generated', timing_source: { episode_key: 'ep-001', version_id: 'v001', line_index: 1, source_asset: timingDocument.source_asset }, target_range: { start_ms: 100, end_ms: 900 }, target_speech_ms: 800, original_text: '别回头', adapted_text: '别回头', adaptation: null, performance: { intent: '阻止对方', subtext: '压住恐惧', emotion_arc: [{ at: 0, emotion: '警觉', intensity: 0.4 }, { at: 1, emotion: '急迫', intensity: 0.8 }], pace: '短促', emphasis: ['别'], pause_plan: [{ after: '别', duration_ms: 80 }], breath: '轻吸气', distance_and_space: '近距离' }, fit_policy: { max_paid_generations: 3, provider_speed_min: 0.85, provider_speed_max: 1.15, max_post_tempo_percent: 3, text_adaptation_allowed: true } }
    await json(resolve(root, 'episodes/ep-001/audio-plan/v001.json'), { episode_key: 'ep-001', approved: true, unresolved: [], voice_bindings: [{ voice_id: 'linwan' }], lines: [{ line_index: 1, content: '别回头', speaker: '林晚', delivery_mode: 'post_dub', presentation: 'visible-dialogue', voice_binding: { voice_id: 'linwan' }, dubbing_contract: contract }] })
    await json(resolve(root, 'episodes/ep-001/audio-plan/selected.json'), { versionId: 'v001', path: 'episodes/ep-001/audio-plan/v001.json' })

    const putAlignment = (version) => putFinalSpeechAlignment(root, { episode_key: 'ep-001', line_index: 1, audio_asset: { asset_key: 'audio-ep001-line-001', version_id: version.id, sha256: version.sha256 }, audio_plan_version: 'v001', source_timing: { version_id: 'v001', line_index: 1, source_asset: timingDocument.source_asset }, text: '别回头', words: [{ text: '别回头', start_ms: 100, end_ms: 900 }], timeline_mapping: { audio_in_ms: 0, timeline_at_ms: 0 }, timeline_fps: 24, reviewed: true })
    await putAlignment(versions[1])
    await putDubbingPerformanceReview(root, review(versions[1].sha256, 'v002'))
    const [subtitle] = await call('build_subtitles_from_audio', { project_root: root, episode_key: 'ep-001', line_index: 1, fps: 24, timeline_end_ms: 1000 })

    media(resolve(videoDir, 'v002.mp4'), 'video', 440)
    const audioBinding = subtitle.audio_binding
    await addAssetVersion(root, 'shot-ep001-001', { id: 'v002', localPath: 'assets/videos/shot-ep001-001/v002.mp4', provenance: transformed([{ key: 'shot-ep001-001', version_id: 'v001' }, { key: 'audio-ep001-line-001', version_id: 'v002' }], { operation: 'lip-sync', range: { start_ms: 100, end_ms: 900 }, parameters: { audio_binding: audioBinding }, source_sha256: sourceSha }) })
    await selectAssetVersion(root, 'shot-ep001-001', 'v002')
    await json(resolve(root, '.short-drama/shot-reviews.json'), { version: 1, reviews: { 'shot-ep001-001@v002': { approved: true, review_type: 'media-operation', operation: 'lip-sync' } } })
    const timeline = { episode_key: 'ep-001', fps: 24, width: 1920, height: 1080, segments: [{ shot_key: 'shot-ep001-001', asset_key: 'shot-ep001-001', version_id: 'v002', source_in_ms: 0, source_out_ms: 1000, timeline_start_ms: 0, timeline_end_ms: 1000, transition: { type: 'hard-cut', duration_frames: 0 }, dialogue_sync: 'lip-synced' }], subtitles: [subtitle], subtitle_source: { method: 'manual-transcription', reviewed: true, source_assets: [{ asset_key: 'audio-ep001-line-001', version_id: 'v002' }], audio_bindings: [audioBinding] }, audio_tracks: [{ asset_key: 'audio-ep001-line-001', version_id: 'v002', role: 'dialogue', source_in_ms: 0, source_out_ms: 1000, timeline_start_ms: 0, timeline_end_ms: 1000, volume_envelope: [], audio_binding: audioBinding }], labels: [], graphics: [], mix: { target_lufs: -16, true_peak_dbtp: -1 }, sound_design_exception: { confirmed: true, reason: '合成测试仅验证对白闭环' } }
    await json(resolve(root, 'episodes/ep-001/speech-timing/selected.json'), { versionId: 'v999', path: 'episodes/ep-001/speech-timing/v999.json', source_asset_sha256: 'f'.repeat(64), reviewed_by: 'other-source' })
    await assert.doesNotReject(validateTimeline(root, timeline))
    await json(resolve(root, 'editing/ep-001/timeline.json'), timeline)
    await assert.rejects(
      runDubbingLiveAcceptance(root, 'ep-001', 1, { original: 'shot-ep001-001@v002', dub: 'audio-ep001-line-001@v002', review: resolve(root, '.short-drama/dubbing-reviews.json') }),
      /original.*timing_source|原声来源资产/,
    )
    const acceptance = await runDubbingLiveAcceptance(root, 'ep-001', 1, { original: 'shot-ep001-001@v001', dub: 'audio-ep001-line-001@v002', review: resolve(root, '.short-drama/dubbing-reviews.json') })
    assert.equal(acceptance.report.accepted, true)
    assert.equal(acceptance.report.original.version_id, 'v001')
    assert.equal(acceptance.report.source_timing.version_id, 'v001')
    assert.equal(acceptance.report.final_alignment.version_id, 'v001')

    await putAlignment(versions[2])
    const replacement = await putDubbingPerformanceReview(root, review(versions[2].sha256, 'v003'))
    assert.deepEqual(replacement.invalidated, ['shot-ep001-001@v002'])
    const [replacementSubtitle] = await call('build_subtitles_from_audio', { project_root: root, episode_key: 'ep-001', line_index: 1, fps: 24, timeline_end_ms: 1000 })
    assert.equal(replacementSubtitle.audio_binding.version_id, 'v003')
    await assert.rejects(validateTimeline(root, timeline), /selected|失效/)
    const ledger = JSON.parse(await readFile(resolve(root, '.short-drama/assets.json'), 'utf8'))
    assert.equal(ledger.assets['shot-ep001-001'].selectedVersionId, null)
  } finally { await rm(root, { recursive: true, force: true }) }
})
