import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { addAssetVersion, putAsset, selectAssetVersion } from '../asset-ledger.mjs'
import { listTasks } from '../task-ledger.mjs'

process.env.RUNNINGHUB_API_KEY = 'test-runninghub-key'
const { seedVrSmoke } = await import('./live-smoke-test.mjs')

test('SeedVR 冒烟默认只输出精确付费摘要', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'seedvr25-smoke-'))
  try {
    await mkdir(resolve(root, '.short-drama'), { recursive: true })
    await writeFile(resolve(root, '.short-drama/project.json'), '{}')
    await writeFile(resolve(root, '.short-drama/state.json'), `${JSON.stringify({ stage: 'editing', completed: [] })}\n`)
    const path = resolve(root, 'assets/videos/shot-ep001-001/v001.mp4')
    await mkdir(dirname(path), { recursive: true })
    const generated = spawnSync('ffmpeg', ['-nostdin', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=gray:s=320x180:r=24:d=2', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-shortest', '-c:v', 'mpeg4', '-c:a', 'aac', '-pix_fmt', 'yuv420p', '-y', path], { encoding: 'utf8' })
    if (generated.status !== 0) throw new Error(generated.stderr || '测试视频生成失败')
    await putAsset(root, { key: 'shot-ep001-001', type: 'video', name: '镜头 1' })
    await addAssetVersion(root, 'shot-ep001-001', { id: 'v001', localPath: 'assets/videos/shot-ep001-001/v001.mp4', provenance: { origin: 'imported', created_by: 'user', provider: null, model_or_workflow: null, task_id: null, prompt_document: null, source_assets: [], parameters: {} } })
    await selectAssetVersion(root, 'shot-ep001-001', 'v001')
    const summary = await seedVrSmoke({ root, assetKey: 'shot-ep001-001', versionId: 'v001', confirmed: false })
    assert.equal(summary.requires_confirmation, true)
    assert.equal(summary.workflow_id, '2099866760106491906')
    assert.equal(summary.source_media.duration_ms, 2000)
    assert.equal(summary.source_media.audio, true)
    assert.equal(summary.upload.occurs_only_after_confirmation, true)
    assert.equal((await listTasks(root)).length, 0)
  } finally { await rm(root, { recursive: true, force: true }) }
})
