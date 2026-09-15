import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import mapping from './seedvr2.5-video-upscale.mapping.json' with { type: 'json' }

process.env.RUNNINGHUB_API_KEY = 'test-runninghub-key'
const { runninghub, submitSeedVr25 } = await import('./runninghub.mjs')

test('上传视频后只覆盖真实映射声明的输入节点', async (context) => {
  const root = await mkdtemp(resolve(tmpdir(), 'seedvr25-adapter-'))
  const source = resolve(root, 'source.mp4')
  await writeFile(source, Buffer.from('video-fixture'))
  context.after(() => rm(root, { recursive: true, force: true }))
  const calls = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), body: options.body })
    if (String(url).endsWith('/openapi/v2/media/upload/binary')) return new Response(JSON.stringify({ code: 0, data: { fileName: 'api/source.mp4' } }))
    if (String(url).endsWith('/task/openapi/create')) return new Response(JSON.stringify({ code: 0, data: { taskId: 'task-seedvr25' } }))
    throw new Error(`意外请求：${url}`)
  }
  context.after(() => { globalThis.fetch = originalFetch })

  const result = await submitSeedVr25({ operation: 'video-upscale', model: 'seedvr2.5-video-upscale', source_video_path: source, confirmed: true })
  const create = calls.find((call) => call.url.endsWith('/task/openapi/create'))
  const body = JSON.parse(create.body)
  assert.equal(body.workflowId, '2099866760106491906')
  assert.deepEqual(body.nodeInfoList, [{ nodeId: mapping.video_input.node_id, fieldName: mapping.video_input.field_name, fieldValue: 'api/source.mp4' }])
  assert.equal(result.model, 'seedvr2.5-video-upscale')
  assert.equal(result.task_id, 'task-seedvr25')
})

test('SeedVR2.5 只作为固定视频超分变换公开', async () => {
  assert.equal(runninghub.capabilities['transform.video-upscale'], true)
  assert.ok(runninghub.catalog.transform.includes('seedvr2.5-video-upscale'))
  assert.ok(!runninghub.catalog.video.includes('seedvr2.5-video-upscale'))
  await assert.rejects(() => submitSeedVr25({ operation: 'video-inpaint', model: 'seedvr2.5-video-upscale', confirmed: true }), /只支持 video-upscale/)
  await assert.rejects(() => submitSeedVr25({ operation: 'video-upscale', model: 'other', confirmed: true }), /只支持 video-upscale/)
})
