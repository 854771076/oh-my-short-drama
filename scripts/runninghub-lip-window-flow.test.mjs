import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { addAssetVersion, putAsset, selectAssetVersion } from './asset-ledger.mjs'
import { probeMedia } from './media-tools.mjs'
import { createRequestSnapshot, reserveTask, settleReservedTask } from './task-ledger.mjs'
import { syncTaskResult } from './task-sync.mjs'
import { putMediaOperationReview } from './review-ledger.mjs'

function video(path, frames, { audio = false, color = 'blue' } = {}) {
  const args = ['-nostdin', '-loglevel', 'error', '-f', 'lavfi', '-i', `color=c=${color}:s=320x180:r=24`]
  if (audio) args.push('-f', 'lavfi', '-i', `sine=frequency=440:sample_rate=48000:duration=${frames / 24}`)
  args.push('-frames:v', String(frames), '-c:v', 'mpeg4', '-pix_fmt', 'yuv420p', ...(audio ? ['-c:a', 'aac', '-shortest'] : []), '-y', path)
  const result = spawnSync('ffmpeg', args, { encoding: 'utf8' })
  if (result.error || result.status !== 0) throw new Error(result.stderr || '测试视频生成失败')
}

function frameCount(path) {
  const result = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-count_frames', '-show_entries', 'stream=nb_read_frames', '-of', 'default=nw=1:nk=1', path], { encoding: 'utf8' })
  if (result.error || result.status !== 0) throw new Error(result.stderr || '测试视频帧数探测失败')
  return Number(result.stdout)
}

async function fixture() {
  const root = await mkdtemp(resolve(tmpdir(), 'runninghub-lip-window-'))
  await mkdir(resolve(root, '.short-drama'), { recursive: true })
  await writeFile(resolve(root, '.short-drama/project.json'), '{}\n')
  await writeFile(resolve(root, '.short-drama/state.json'), `${JSON.stringify({ stage: 'editing', completed: [] })}\n`)
  const source = resolve(root, 'assets/videos/shot-ep001-001/v001.mp4')
  await mkdir(dirname(source), { recursive: true })
  video(source, 48, { audio: true })
  await putAsset(root, { key: 'shot-ep001-001', type: 'video', name: '镜头 1' })
  await addAssetVersion(root, 'shot-ep001-001', { id: 'v001', localPath: 'assets/videos/shot-ep001-001/v001.mp4', provenance: { origin: 'imported', created_by: 'user', provider: null, model_or_workflow: null, task_id: null, prompt_document: null, source_assets: [], parameters: {} } })
  await selectAssetVersion(root, 'shot-ep001-001', 'v001')
  const ledger = JSON.parse(await readFile(resolve(root, '.short-drama/assets.json'), 'utf8'))
  return { root, source, sha256: ledger.assets['shot-ep001-001'].versions[0].sha256 }
}

async function task(root, sha256, taskId) {
  const preparation = { mode: 'painterav2v-window-and-tail-frame-pad', source_frame_count: 48, window_start_frame: 4, window_end_frame: 44, window_start_ms: 167, window_end_ms: 1833, expected_output_frame_count: 40, provider_frame_count: 41, pad_frames: 1, fps: 24, duration_ms: 1708 }
  const snapshot = await createRequestSnapshot(root, {
    tool: 'submit_media_operation', target: 'shot-ep001-001', type: 'video', provider: 'runninghub', modelOrWorkflow: 'workflow-lip', promptDocument: null,
    arguments: { operation: 'lip-sync', source: { asset_key: 'shot-ep001-001', version_id: 'v001' }, audio: { asset_key: 'audio-ep001-line-001', version_id: 'v001' }, range: { start_ms: 500, end_ms: 1100 }, parameters: { audio_plan: { episode_key: 'ep-001', version_id: 'v001', line_index: 1 }, audio_binding: { asset_key: 'audio-ep001-line-001', version_id: 'v001', sha256: 'a'.repeat(64), line_index: 1, speech_timing_version: 'v001', dubbing_contract_version: 'v001' }, face_selector: { mode: 'single-visible-face', character_key: 'char-test' }, provider_video_preparation: preparation }, source_sha256: sha256 },
  })
  await reserveTask(root, { taskId: snapshot.requestId, target: 'shot-ep001-001', type: 'video', provider: 'runninghub', requestPath: snapshot.requestPath })
  await settleReservedTask(root, snapshot.requestId, { taskId, status: 'queued' })
}

test('RunningHub 只生成局部口型窗口并按帧拼回完整源镜头', async () => {
  const { root, sha256 } = await fixture()
  try {
    await task(root, sha256, 'task-lip-window')
    const output = resolve(root, '.short-drama/provider-output/lip-window.mp4')
    await mkdir(dirname(output), { recursive: true })
    video(output, 40, { color: 'red' })
    const synced = await syncTaskResult(root, 'task-lip-window', { provider: 'runninghub', status: 'completed', outputs: [{ path: output, media_type: 'video' }] })
    assert.equal(synced.output_version_ids.length, 1)
    const ledger = JSON.parse(await readFile(resolve(root, '.short-drama/assets.json'), 'utf8'))
    const final = ledger.assets['shot-ep001-001'].versions.find((item) => item.id === synced.output_version_ids[0])
    const provider = ledger.assets['shot-ep001-001'].versions.find((item) => item.id === final.provenance.parameters.output_processing.provider_output.version_id)
    const finalPath = resolve(root, final.localPath)
    assert.equal(frameCount(finalPath), 48)
    assert.equal(probeMedia(finalPath).has_audio, true)
    assert.equal(final.provenance.parameters.output_processing.method, 'ffmpeg-frame-window-splice-source-audio')
    assert.equal(provider.provenance.task_id, 'task-lip-window:provider-output')
    assert.equal(ledger.assets['shot-ep001-001'].selectedVersionId, 'v001')
    const review = await putMediaOperationReview(root, {
      asset_key: 'shot-ep001-001', version_id: final.id, operation: 'lip-sync', approved: true, watched_full: true,
      observations: Object.fromEntries(['sync_timing', 'identity', 'mouth_artifacts', 'non_target_faces', 'duration'].map((key) => [key, '已完整检查并通过'])), issues: [],
      qc: { version: 1, passed: true, blockers: [], video_sha256: final.sha256, duration_ms: 2000, video: { width: 320, height: 180 }, audio: true },
    })
    assert.equal(review.selected, true)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('RunningHub 局部口型输出帧数不足时拒绝拼回和完成任务', async () => {
  const { root, sha256 } = await fixture()
  try {
    await task(root, sha256, 'task-lip-window-short')
    const output = resolve(root, '.short-drama/provider-output/lip-window-short.mp4')
    await mkdir(dirname(output), { recursive: true })
    video(output, 39, { color: 'red' })
    await assert.rejects(syncTaskResult(root, 'task-lip-window-short', { provider: 'runninghub', status: 'completed', outputs: [{ path: output, media_type: 'video' }] }), /窗口输出帧数不足/)
  } finally { await rm(root, { recursive: true, force: true }) }
})
