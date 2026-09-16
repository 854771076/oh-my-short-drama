import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { acceptanceChecks, verifyRecordedSourceTimedDubbingEvidence } from './next-version-acceptance.mjs'
import { fingerprint } from './task-ledger.mjs'

async function writeJson(path, value) {
  await mkdir(resolve(path, '..'), { recursive: true })
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`)
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex')
}

function makeAcceptanceMedia(originalPath, dubPath) {
  const original = spawnSync('ffmpeg', ['-nostdin', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=64x64:d=0.5', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.5', '-shortest', '-c:v', 'libx264', '-c:a', 'aac', '-y', originalPath], { encoding: 'utf8' })
  const dub = spawnSync('ffmpeg', ['-nostdin', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=660:duration=0.5', '-c:a', 'pcm_s16le', '-y', dubPath], { encoding: 'utf8' })
  assert.equal(original.status, 0, original.stderr)
  assert.equal(dub.status, 0, dub.stderr)
}

test('十项验收均有文件与可执行命令证据', () => {
  const checks = acceptanceChecks()
  assert.deepEqual(checks.map((item) => item.id), ['character-appeal', 'tail-frame', 'spatial-continuity', 'native-audio', 'voice-lip-sync', 'source-timed-emotional-dubbing', 'licensed-music', 'media-editing-mcp', 'seedvr25', 'plugin-release'])
  for (const check of checks) {
    assert.ok(check.required_files.length > 0, `${check.id} 缺少文件证据`)
    assert.ok(check.commands.length > 0, `${check.id} 缺少运行证据`)
  }
  assert.equal(checks.find((item) => item.id === 'seedvr25').requires_external_evidence, true)
  assert.equal(checks.find((item) => item.id === 'source-timed-emotional-dubbing').requires_external_evidence, true)
})

test('真实配音验收证据必须交叉核对媒体、八维复听和完成任务', async (t) => {
  const root = await mkdtemp(resolve(tmpdir(), 'dubbing-acceptance-evidence-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const originalPath = resolve(root, 'assets/videos/shot-ep001-010/v001.mp4')
  const dubPath = resolve(root, 'assets/audio/audio-ep001-line-010/v003.wav')
  await mkdir(resolve(originalPath, '..'), { recursive: true })
  await mkdir(resolve(dubPath, '..'), { recursive: true })
  makeAcceptanceMedia(originalPath, dubPath)
  const originalSha = digest(await readFile(originalPath))
  const dubSha = digest(await readFile(dubPath))
  const assets = { assets: {
    'shot-ep001-010': { key: 'shot-ep001-010', type: 'video', selectedVersionId: 'v001', staleVersionIds: [], versions: [{ id: 'v001', localPath: 'assets/videos/shot-ep001-010/v001.mp4', sha256: originalSha }] },
    'audio-ep001-line-010': { key: 'audio-ep001-line-010', type: 'audio', selectedVersionId: 'v003', staleVersionIds: [], versions: [{ id: 'v003', localPath: 'assets/audio/audio-ep001-line-010/v003.wav', sha256: dubSha, provenance: { origin: 'generated', created_by: 'provider', provider: 'bailian', model_or_workflow: 'cosyvoice-v3.5-plus', task_id: 'task-dub-10', prompt_document: null, source_assets: [], parameters: {} } }] },
  } }
  await writeJson(resolve(root, '.short-drama/assets.json'), assets)
  const dimensions = Object.fromEntries(['semantic_integrity', 'speaker_identity', 'emotion_arc', 'intensity_and_subtext', 'emphasis_pause_breath', 'timing_fit', 'picture_interaction', 'technical_audio'].map((key) => [key, { status: 'passed', evidence: `${key} 已完整复听` }]))
  dimensions.technical_audio.checks = { clipping: false, swallowed_words: false, tail_cutoff: false, unnatural_tempo: false, loudness_blocker: false }
  await writeJson(resolve(root, '.short-drama/dubbing-reviews.json'), { reviews: { 'audio-ep001-line-010@v003': { review_type: 'dubbing-performance', approved: true, selection_state: 'committed', asset_sha256: dubSha, episode_key: 'ep-001', line_index: 10, watched_full: true, dimensions, issues: [] } } })
  await writeJson(resolve(root, '.short-drama/tasks.json'), { tasks: { 'task-dub-10': { taskId: 'task-dub-10', status: 'completed' } } })
  const reportPath = resolve(root, '.short-drama/acceptance/source-timed-dubbing-ep-001-line-010.json')
  const report = {
    version: 1, episode_key: 'ep-001', line_index: 10, accepted: true,
    original: { asset_key: 'shot-ep001-010', version_id: 'v001', sha256: originalSha },
    dub: { asset_key: 'audio-ep001-line-010', version_id: 'v003', sha256: dubSha },
    source_timing: { version_id: 'v002', word_errors: { status: 'passed', max_error_ms: 30 } },
    final_alignment: { version_id: 'v004' },
    subtitle: { bound: true, within_tolerance: true },
    lip_sync: { bound: true, segment: 'lip-ep001-010@v001' },
    performance_review: { watched_full: true, dimensions, issues: [] },
  }
  await writeJson(reportPath, report)
  await assert.rejects(() => verifyRecordedSourceTimedDubbingEvidence(root, reportPath), /制作耗时/)
  report.production_duration_ms = 128000
  await writeJson(reportPath, report)
  await assert.rejects(() => verifyRecordedSourceTimedDubbingEvidence(root, reportPath), /请求快照|任务/)

  const compilerSnapshot = { episode_key: 'ep-001', line_index: 10, contract_version: 'v001', timing_version: 'v002', attempt: 1, target_range: { start_ms: 100, end_ms: 900 }, text_version: 'original', capability_gaps: [] }
  const dubbingCompiler = { snapshot: compilerSnapshot, sha256: fingerprint(compilerSnapshot) }
  const request = { version: 1, requestId: 'req-dub-10', tool: 'generate_audio', target: 'audio-ep001-line-010', type: 'audio', provider: 'bailian', modelOrWorkflow: 'cosyvoice-v3.5-plus', promptDocument: null, arguments: { provider: 'bailian', model: 'cosyvoice-v3.5-plus', confirmed: true }, dubbing_compiler: dubbingCompiler, inputFingerprint: 'test' }
  const requestPath = resolve(root, '.short-drama/requests/req-dub-10.json')
  await writeJson(requestPath, request)
  assets.assets['audio-ep001-line-010'].versions[0].provenance.parameters = { dubbing_compiler: dubbingCompiler }
  await writeJson(resolve(root, '.short-drama/assets.json'), assets)
  await writeJson(resolve(root, '.short-drama/tasks.json'), { tasks: { 'task-dub-10': { taskId: 'task-dub-10', target: 'audio-ep001-line-010', type: 'audio', provider: 'bailian', status: 'completed', requestPath: '.short-drama/requests/req-dub-10.json', requestSha256: digest(await readFile(requestPath)), outputVersionId: 'v003' } } })

  const evidence = await verifyRecordedSourceTimedDubbingEvidence(root, reportPath)
  assert.deepEqual({ asset_key: evidence.asset_key, version_id: evidence.version_id, sha256: evidence.sha256, task_id: evidence.task_id }, { asset_key: 'audio-ep001-line-010', version_id: 'v003', sha256: dubSha, task_id: 'task-dub-10' })

  const reviewPath = resolve(root, '.short-drama/dubbing-reviews.json')
  const incompleteDimensions = structuredClone(dimensions)
  delete incompleteDimensions.technical_audio.checks
  await writeJson(reviewPath, { reviews: { 'audio-ep001-line-010@v003': { review_type: 'dubbing-performance', approved: true, selection_state: 'committed', asset_sha256: dubSha, episode_key: 'ep-001', line_index: 10, watched_full: true, dimensions: incompleteDimensions, issues: [] } } })
  await assert.rejects(() => verifyRecordedSourceTimedDubbingEvidence(root, reportPath), /技术音频/)

  await writeJson(reviewPath, { reviews: { 'audio-ep001-line-010@v003': { review_type: 'dubbing-performance', approved: true, selection_state: 'committed', asset_sha256: dubSha, episode_key: 'ep-001', line_index: 10, watched_full: false, dimensions, issues: [] } } })
  await assert.rejects(() => verifyRecordedSourceTimedDubbingEvidence(root, reportPath), /完整复听/)

  const fakeBytes = Buffer.from('not-a-real-audio-stream')
  const fakeSha = digest(fakeBytes)
  await writeFile(dubPath, fakeBytes)
  assets.assets['audio-ep001-line-010'].versions[0].sha256 = fakeSha
  report.dub.sha256 = fakeSha
  await writeJson(resolve(root, '.short-drama/assets.json'), assets)
  await writeJson(reportPath, report)
  await writeJson(reviewPath, { reviews: { 'audio-ep001-line-010@v003': { review_type: 'dubbing-performance', approved: true, selection_state: 'committed', asset_sha256: fakeSha, episode_key: 'ep-001', line_index: 10, watched_full: true, dimensions, issues: [] } } })
  await assert.rejects(() => verifyRecordedSourceTimedDubbingEvidence(root, reportPath), /ffprobe|可解码/)
})
