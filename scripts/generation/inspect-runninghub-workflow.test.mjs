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
