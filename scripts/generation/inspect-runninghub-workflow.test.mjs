import test from 'node:test'
import assert from 'node:assert/strict'
import fixture from './fixtures/seedvr25-workflow-shape.json' with { type: 'json' }
import { inspectVideoUpscaleWorkflow } from './inspect-runninghub-workflow.mjs'

test('唯一识别视频输入和保存节点', () => {
  assert.deepEqual(inspectVideoUpscaleWorkflow(fixture, '2099866760106491906'), { workflow_id: '2099866760106491906', video_input: { node_id: '12', field_name: 'video' }, video_output: { node_id: '98', class_type: 'VHS_VideoCombine' }, optional_parameters: {} })
})

test('多个视频输入节点时拒绝猜测', () => {
  assert.throws(() => inspectVideoUpscaleWorkflow({ ...fixture, 13: fixture['12'] }, '2099866760106491906'), /无法唯一识别视频输入节点/)
})

test('命令行兼容官方获取工作流接口的 data.prompt 包装', async () => {
  const { randomUUID } = await import('node:crypto')
  const { mkdtemp, readFile, rm, writeFile } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { resolve } = await import('node:path')
  const { spawnSync } = await import('node:child_process')
  const root = await mkdtemp(resolve(tmpdir(), 'runninghub-workflow-export-'))
  try {
    const input = resolve(root, 'response.json')
    const output = new URL(`./fixtures/generated-seedvr25-mapping-${randomUUID()}.json`, import.meta.url)
    await writeFile(input, JSON.stringify({ code: 0, data: { prompt: JSON.stringify(fixture) } }))
    const result = spawnSync(process.execPath, [new URL('./inspect-runninghub-workflow.mjs', import.meta.url).pathname, input, '2099866760106491906', '--output', output.pathname], { encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    const mapping = JSON.parse(await readFile(output, 'utf8'))
    assert.equal(mapping.video_input.node_id, '12')
    assert.equal(mapping.video_output.node_id, '98')
    await rm(output, { force: true })
  } finally { await rm(root, { recursive: true, force: true }) }
})
