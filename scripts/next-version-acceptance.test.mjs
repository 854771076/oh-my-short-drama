import test from 'node:test'
import assert from 'node:assert/strict'
import { acceptanceChecks } from './next-version-acceptance.mjs'

test('九项验收均有文件与可执行命令证据', () => {
  const checks = acceptanceChecks()
  assert.deepEqual(checks.map((item) => item.id), ['character-appeal', 'tail-frame', 'spatial-continuity', 'native-audio', 'voice-lip-sync', 'licensed-music', 'media-editing-mcp', 'seedvr25', 'plugin-release'])
  for (const check of checks) {
    assert.ok(check.required_files.length > 0, `${check.id} 缺少文件证据`)
    assert.ok(check.commands.length > 0, `${check.id} 缺少运行证据`)
  }
  assert.equal(checks.find((item) => item.id === 'seedvr25').requires_external_evidence, true)
})

