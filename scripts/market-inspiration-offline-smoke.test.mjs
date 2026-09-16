import test from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { resolve } from 'node:path'
import { promisify } from 'node:util'

const execute = promisify(execFile)

test('离线 smoke 从已保存 market-report.v2 生成并登记市场灵感', async () => {
  const script = resolve(import.meta.dirname, 'market-inspiration-offline-smoke.mjs')
  const { stdout } = await execute(process.execPath, [script])
  const result = JSON.parse(stdout)

  assert.deepEqual(result, {
    ok: true,
    report_schema: 'market-report.v2',
    inspiration_schema: 'market-inspiration.v1',
    brief_reference_saved: true,
    project_genre_unchanged: true,
    brief_platform_unchanged: true,
    refresh_calls: 0,
  })
})
