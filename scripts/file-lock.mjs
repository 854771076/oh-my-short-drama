#!/usr/bin/env node
import { mkdir, rm, stat } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'

const wait = (milliseconds) => new Promise((done) => setTimeout(done, milliseconds))

export async function withFileLock(target, action, { timeoutMs = 10_000, staleMs = 60_000 } = {}) {
  const lock = `${target}.lock`
  const deadline = Date.now() + timeoutMs
  await mkdir(dirname(target), { recursive: true })
  while (true) {
    try {
      await mkdir(lock)
      break
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
      let age
      try { age = Date.now() - (await stat(lock)).mtimeMs } catch (statError) { if (statError?.code === 'ENOENT') continue; throw statError }
      if (age > staleMs) await rm(lock, { recursive: true, force: true })
      else if (Date.now() >= deadline) throw new Error(`等待文件锁超时：${target}`)
      else await wait(25)
    }
  }
  try { return await action() } finally { await rm(lock, { recursive: true, force: true }) }
}

async function selfCheck() {
  const target = resolve(tmpdir(), `short-drama-lock-${randomUUID()}`)
  let active = 0
  let maximum = 0
  await Promise.all([1, 2, 3].map(() => withFileLock(target, async () => {
    active += 1
    maximum = Math.max(maximum, active)
    await wait(10)
    active -= 1
  })))
  if (maximum !== 1) throw new Error('文件锁自检失败')
  console.log('ok')
}

if (import.meta.url === `file://${process.argv[1]}` && process.argv.includes('--self-check')) selfCheck().catch((error) => { console.error(error.message); process.exitCode = 1 })
