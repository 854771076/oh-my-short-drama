import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { createRequestSnapshot, recordDubbingAttemptOutcome, reserveTask, settleReservedTask } from './task-ledger.mjs'

async function root() {
  const value = await mkdtemp(resolve(tmpdir(), 'dubbing-paid-ledger-'))
  await mkdir(resolve(value, '.short-drama'), { recursive: true })
  await writeFile(resolve(value, '.short-drama/project.json'), '{}')
  return value
}

async function request(projectRoot, attempt) {
  return createRequestSnapshot(projectRoot, {
    tool: 'generate_audio', target: 'audio-ep001-line-001', type: 'audio', provider: 'test', modelOrWorkflow: 'tts',
    promptDocument: { kind: 'audio-plan', episode_key: 'ep-001', version_id: 'v001', line_index: 1 }, arguments: { input: '别回头' },
    dubbing_compiler: { episode_key: 'ep-001', line_index: 1, contract_version: 'v001', timing_version: 'v001', attempt, target_range: { start_ms: 0, end_ms: 1000 }, text_version: attempt === 3 ? 'adapted' : 'original', capability_gaps: [] },
  })
}

async function reserve(projectRoot, snapshot) {
  return reserveTask(projectRoot, { taskId: snapshot.requestId, target: 'audio-ep001-line-001', type: 'audio', provider: 'test', requestPath: snapshot.requestPath })
}

test('同一分集同一行的首轮并发预占只有一个成功且轮次由账本派生', async () => {
  const projectRoot = await root()
  try {
    const [one, two] = await Promise.all([request(projectRoot, 1), request(projectRoot, 1)])
    const results = await Promise.allSettled([reserve(projectRoot, one), reserve(projectRoot, two)])
    assert.equal(results.filter((item) => item.status === 'fulfilled').length, 1)
    assert.match(results.find((item) => item.status === 'rejected').reason.message, /付费轮次|已预占/)
  } finally { await rm(projectRoot, { recursive: true, force: true }) }
})

test('第二轮和第三轮必须依次绑定前轮失败对齐，第三轮还要求等义适配批准', async () => {
  const projectRoot = await root()
  try {
    const first = await request(projectRoot, 1)
    await reserve(projectRoot, first)
    await settleReservedTask(projectRoot, first.requestId, { status: 'failed' })
    const second = await request(projectRoot, 2)
    await assert.rejects(() => reserve(projectRoot, second), /前一轮.*对齐/)
    await recordDubbingAttemptOutcome(projectRoot, { episode_key: 'ep-001', line_index: 1, attempt: 1, alignment_version: 'v001', fit_passed: false, adaptation_approved: false })
    await reserve(projectRoot, second)
    await settleReservedTask(projectRoot, second.requestId, { status: 'failed' })
    const third = await request(projectRoot, 3)
    await recordDubbingAttemptOutcome(projectRoot, { episode_key: 'ep-001', line_index: 1, attempt: 2, alignment_version: 'v002', fit_passed: false, adaptation_approved: false })
    await assert.rejects(() => reserve(projectRoot, third), /等义适配.*批准/)
    await recordDubbingAttemptOutcome(projectRoot, { episode_key: 'ep-001', line_index: 1, attempt: 2, alignment_version: 'v002', fit_passed: false, adaptation_approved: true })
    await reserve(projectRoot, third)
    const duplicate = await request(projectRoot, 3)
    await assert.rejects(() => reserve(projectRoot, duplicate), /三次|已预占|付费轮次/)
  } finally { await rm(projectRoot, { recursive: true, force: true }) }
})

test('调用者不能跳号或把请求轮次回退成 1 绕过持久化计数', async () => {
  const projectRoot = await root()
  try {
    const first = await request(projectRoot, 1)
    await reserve(projectRoot, first)
    const forged = await request(projectRoot, 2)
    await assert.rejects(() => reserve(projectRoot, forged), /前一轮.*对齐/)
    const replay = await request(projectRoot, 1)
    await assert.rejects(() => reserve(projectRoot, replay), /付费轮次|已预占/)
  } finally { await rm(projectRoot, { recursive: true, force: true }) }
})
