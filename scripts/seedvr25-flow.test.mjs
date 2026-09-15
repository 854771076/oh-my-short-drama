import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { addAssetVersion, putAsset, selectAssetVersion, selectedAssetVersion } from './asset-ledger.mjs'
import { probeMedia } from './media-tools.mjs'
import { putMediaOperationReview } from './review-ledger.mjs'
import { createRequestSnapshot, reserveTask, settleReservedTask } from './task-ledger.mjs'
import { syncTaskResult } from './task-sync.mjs'
import mapping from './generation/seedvr2.5-video-upscale.mapping.json' with { type: 'json' }

process.env.RUNNINGHUB_API_KEY = 'test-runninghub-key'
const { call } = await import('./generation/mcp.mjs')

function video(path, { width = 320, height = 180, fps = 24, audio = true } = {}) {
  const args = ['-nostdin', '-loglevel', 'error', '-f', 'lavfi', '-i', `color=c=blue:s=${width}x${height}:r=${fps}:d=2`]
  if (audio) args.push('-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=2', '-shortest')
  args.push('-c:v', 'mpeg4', '-pix_fmt', 'yuv420p', ...(audio ? ['-c:a', 'aac'] : []), '-y', path)
  const result = spawnSync('ffmpeg', args, { encoding: 'utf8' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(result.stderr || '测试视频生成失败')
}

async function fixture() {
  const root = await mkdtemp(resolve(tmpdir(), 'seedvr25-flow-'))
  await mkdir(resolve(root, '.short-drama'), { recursive: true })
  await writeFile(resolve(root, '.short-drama/project.json'), '{}')
  await writeFile(resolve(root, '.short-drama/state.json'), `${JSON.stringify({ stage: 'editing', completed: [] })}\n`)
  const source = resolve(root, 'assets/videos/shot-ep001-001/v001.mp4')
  await mkdir(dirname(source), { recursive: true })
  video(source)
  await putAsset(root, { key: 'shot-ep001-001', type: 'video', name: '镜头 1' })
  await addAssetVersion(root, 'shot-ep001-001', { id: 'v001', localPath: 'assets/videos/shot-ep001-001/v001.mp4', provenance: { origin: 'imported', created_by: 'user', provider: null, model_or_workflow: null, task_id: null, prompt_document: null, source_assets: [], parameters: {} } })
  await selectAssetVersion(root, 'shot-ep001-001', 'v001')
  return root
}

function request(root, source = { asset_key: 'shot-ep001-001', version_id: 'v001' }) {
  return { project_root: root, target: 'shot-ep001-001', operation: 'video-upscale', provider: 'runninghub', model: 'seedvr2.5-video-upscale', source, parameters: {}, confirmed: false }
}

test('SeedVR 预览包含上传、固定工作流和真实节点覆盖且不提交', async () => {
  const root = await fixture()
  const originalFetch = globalThis.fetch
  let remoteCalls = 0
  globalThis.fetch = async () => { remoteCalls += 1; throw new Error('预览不得访问远端') }
  try {
    const preview = await call('submit_media_operation', request(root))
    assert.equal(preview.workflow_id, '2099866760106491906')
    assert.equal(preview.uploads.length, 1)
    assert.deepEqual(preview.node_overrides, [mapping.video_input])
    assert.equal(remoteCalls, 0)
  } finally {
    globalThis.fetch = originalFetch
    await rm(root, { recursive: true, force: true })
  }
})

test('非 selected 输入在上传前拒绝', async () => {
  const root = await fixture()
  const originalFetch = globalThis.fetch
  let remoteCalls = 0
  globalThis.fetch = async () => { remoteCalls += 1; throw new Error('失效输入不得访问远端') }
  try {
    await assert.rejects(call('submit_media_operation', { ...request(root, { asset_key: 'shot-ep001-001', version_id: 'v002' }), confirmed: true }), /selected|失效/)
    assert.equal(remoteCalls, 0)
  } finally {
    globalThis.fetch = originalFetch
    await rm(root, { recursive: true, force: true })
  }
})

test('SeedVR 回写拒绝时长帧率漂移并在缺音轨时复用源音频', async () => {
  const root = await fixture()
  try {
    const source = await selectedAssetVersion(root, 'shot-ep001-001')
    const snapshot = await createRequestSnapshot(root, {
      tool: 'submit_media_operation', target: 'shot-ep001-001', type: 'video', provider: 'runninghub', modelOrWorkflow: 'seedvr2.5-video-upscale', promptDocument: null,
      arguments: { operation: 'video-upscale', source: { asset_key: 'shot-ep001-001', version_id: 'v001' }, parameters: {}, source_sha256: source.version.sha256 },
    })
    await reserveTask(root, { taskId: snapshot.requestId, target: 'shot-ep001-001', type: 'video', provider: 'runninghub', requestPath: snapshot.requestPath })
    await settleReservedTask(root, snapshot.requestId, { taskId: 'task-seedvr25', status: 'queued' })
    const providerOutput = resolve(root, '.short-drama/provider-output/seedvr25.mp4')
    await mkdir(dirname(providerOutput), { recursive: true })
    video(providerOutput, { width: 640, height: 360, audio: false })
    const synced = await syncTaskResult(root, 'task-seedvr25', { provider: 'runninghub', status: 'completed', outputs: [{ path: providerOutput, media_type: 'video' }] })
    assert.equal(synced.output_version_ids.length, 1)
    const ledger = JSON.parse(await readFile(resolve(root, '.short-drama/assets.json'), 'utf8'))
    const final = ledger.assets['shot-ep001-001'].versions.find((item) => item.id === synced.output_version_ids[0])
    const intermediate = ledger.assets['shot-ep001-001'].versions.find((item) => item.id === final.provenance.parameters.output_processing.provider_output.version_id)
    assert.equal(probeMedia(resolve(root, final.localPath)).has_audio, true)
    assert.equal(final.provenance.parameters.output_processing.audio_remux_source.version_id, 'v001')
    assert.equal(intermediate.sha256, final.provenance.parameters.output_processing.provider_output.sha256)
    assert.equal(ledger.assets['shot-ep001-001'].selectedVersionId, 'v001')

    const review = await putMediaOperationReview(root, {
      asset_key: 'shot-ep001-001', version_id: final.id, operation: 'video-upscale', approved: true, watched_full: true,
      observations: Object.fromEntries(['resolution', 'duration_fps', 'audio_preservation', 'faces_hands_text', 'motion_artifacts', 'color_crop'].map((key) => [key, '已完整检查并通过'])), issues: [],
      qc: { version: 1, passed: true, blockers: [], video_sha256: final.sha256, duration_ms: probeMedia(resolve(root, final.localPath)).duration_ms, video: { width: 640, height: 360, fps: 24 }, audio: true },
    })
    assert.equal(review.selected, true)
    assert.equal((await selectedAssetVersion(root, 'shot-ep001-001')).version.id, final.id)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('SeedVR 输出帧率漂移时不完成任务', async () => {
  const root = await fixture()
  try {
    const source = await selectedAssetVersion(root, 'shot-ep001-001')
    const snapshot = await createRequestSnapshot(root, {
      tool: 'submit_media_operation', target: 'shot-ep001-001', type: 'video', provider: 'runninghub', modelOrWorkflow: 'seedvr2.5-video-upscale', promptDocument: null,
      arguments: { operation: 'video-upscale', source: { asset_key: 'shot-ep001-001', version_id: 'v001' }, parameters: {}, source_sha256: source.version.sha256 },
    })
    await reserveTask(root, { taskId: snapshot.requestId, target: 'shot-ep001-001', type: 'video', provider: 'runninghub', requestPath: snapshot.requestPath })
    await settleReservedTask(root, snapshot.requestId, { taskId: 'task-seedvr25-drift', status: 'queued' })
    const providerOutput = resolve(root, '.short-drama/provider-output/seedvr25-drift.mp4')
    await mkdir(dirname(providerOutput), { recursive: true })
    video(providerOutput, { width: 640, height: 360, fps: 30, audio: false })
    await assert.rejects(syncTaskResult(root, 'task-seedvr25-drift', { provider: 'runninghub', status: 'completed', outputs: [{ path: providerOutput, media_type: 'video' }] }), /帧率漂移/)
    assert.equal((await selectedAssetVersion(root, 'shot-ep001-001')).version.id, 'v001')
  } finally { await rm(root, { recursive: true, force: true }) }
})
