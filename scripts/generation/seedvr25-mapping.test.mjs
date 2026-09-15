import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('内置映射绑定指定工作流且有唯一输入输出', async () => {
  const mapping = JSON.parse(await readFile(new URL('./seedvr2.5-video-upscale.mapping.json', import.meta.url)))
  assert.equal(mapping.workflow_id, '2099866760106491906')
  assert.match(mapping.video_input.node_id, /^\d+$/)
  assert.ok(mapping.video_input.field_name)
  assert.match(mapping.video_output.node_id, /^\d+$/)
  assert.match(mapping.source_export_sha256, /^[0-9a-f]{64}$/)
})
