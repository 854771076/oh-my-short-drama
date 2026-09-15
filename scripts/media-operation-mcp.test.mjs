import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { addAssetVersion, putAsset, selectAssetVersion } from './asset-ledger.mjs'
import { listTasks } from './task-ledger.mjs'

process.env.RUNNINGHUB_VIDEO_UPSCALE_WORKFLOW_ID = 'workflow-upscale-test'
const { call, tools } = await import('./generation/mcp.mjs')

function generateVideo(path) {
  const result = spawnSync('ffmpeg', ['-nostdin', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=green:s=320x180:r=24:d=2', '-c:v', 'mpeg4', '-pix_fmt', 'yuv420p', '-y', path], { encoding: 'utf8' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(result.stderr || '测试视频生成失败')
}

async function fixture() {
  const root = await mkdtemp(resolve(tmpdir(), 'short-drama-operation-mcp-'))
  await mkdir(resolve(root, '.short-drama'), { recursive: true })
  await writeFile(resolve(root, '.short-drama/project.json'), '{}')
  await writeFile(resolve(root, '.short-drama/state.json'), `${JSON.stringify({ stage: 'editing', completed: [] })}\n`)
  const path = resolve(root, 'assets/videos/shot-ep001-001/v001.mp4')
  await mkdir(dirname(path), { recursive: true })
  generateVideo(path)
  await putAsset(root, { key: 'shot-ep001-001', type: 'video', name: '镜头 1' })
  await addAssetVersion(root, 'shot-ep001-001', { id: 'v001', localPath: 'assets/videos/shot-ep001-001/v001.mp4', provenance: { origin: 'imported', created_by: 'user', provider: null, model_or_workflow: null, task_id: null, prompt_document: null, source_assets: [], parameters: {} } })
  await selectAssetVersion(root, 'shot-ep001-001', 'v001')
  return root
}

test('媒体操作 MCP 注册统一工具', () => {
  for (const name of ['submit_media_operation', 'get_media_operation', 'register_media_operation_output']) assert.ok(tools.some((tool) => tool.name === name), `缺少 ${name}`)
})

test('未确认的远端媒体操作只返回摘要且不建任务', async () => {
  const root = await fixture()
  try {
    const preview = await call('submit_media_operation', { project_root: root, target: 'shot-ep001-001', operation: 'video-upscale', provider: 'runninghub', model: 'workflow-upscale-test', workflow_id: 'workflow-upscale-test', node_info_list: [{ nodeId: '1', fieldName: 'video', fieldValue: '@asset:0' }], source: { asset_key: 'shot-ep001-001', version_id: 'v001' }, parameters: { scale: 2 }, confirmed: false })
    assert.equal(preview.requires_confirmation, true)
    assert.equal(preview.capability, 'transform.video-upscale')
    assert.equal((await listTasks(root)).length, 0)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('本地操作完成候选版本但不伪造远端任务', async () => {
  const root = await fixture()
  try {
    const done = await call('submit_media_operation', { project_root: root, target: 'shot-ep001-001', operation: 'trim', provider: 'local', source: { asset_key: 'shot-ep001-001', version_id: 'v001' }, range: { start_ms: 250, end_ms: 1250 }, parameters: {}, confirmed: true })
    assert.equal(done.status, 'completed')
    assert.match(done.output_version_id, /^v\d{3}$/)
    assert.equal((await listTasks(root)).length, 0)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
