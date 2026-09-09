#!/usr/bin/env node
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { stages } from './workflow-stages.mjs'
import { inspectStage } from './workflow-gates.mjs'
import { withFileLock } from './file-lock.mjs'
import { clearSkillRunsFrom } from './skill-runs.mjs'

const root = resolve(process.argv[3] || process.cwd())
const statePath = resolve(root, '.short-drama/state.json')

async function readState() {
  return JSON.parse(await readFile(statePath, 'utf8'))
}

async function save(state) {
  await mkdir(resolve(root, '.short-drama'), { recursive: true })
  const content = `${JSON.stringify(state, null, 2)}\n`
  const temporary = `${statePath}.${randomUUID()}.tmp`
  await writeFile(temporary, content, { flag: 'wx' })
  await rename(temporary, statePath)
}

async function inspectProgress(state) {
  const results = []
  for (const stage of [...new Set([...(state.completed || []), state.stage])]) results.push(await inspectStage(root, stage))
  return results
}

async function main() {
  const command = process.argv[2]
  if (command === 'status') return console.log(JSON.stringify(await readState(), null, 2))
  if (command === 'check') {
    const state = await readState()
    const gates = await inspectProgress(state)
    const failed = gates.filter((gate) => !gate.ready)
    const result = { stage: state.stage, ready: failed.length === 0, gates, missing: failed.flatMap((gate) => gate.missing.map((item) => `${gate.stage}: ${item}`)) }
    console.log(JSON.stringify(result, null, 2))
    if (!result.ready) process.exitCode = 2
    return
  }
  if (command === 'complete') return withFileLock(statePath, async () => {
    const state = await readState()
    if (state.stage !== stages.at(-1)) throw new Error(`只能在 ${stages.at(-1)} 阶段完成项目`)
    const gates = await inspectProgress(state)
    const failed = gates.filter((gate) => !gate.ready)
    if (failed.length) throw new Error(`阶段门禁未通过：${failed.flatMap((gate) => gate.missing.map((item) => `${gate.stage}: ${item}`)).join('；')}`)
    if (state.finishedAt) return console.log(JSON.stringify(state, null, 2))
    state.completed = [...new Set([...state.completed, state.stage])]
    state.finishedAt = new Date().toISOString()
    state.updatedAt = state.finishedAt
    await save(state)
    console.log(JSON.stringify(state, null, 2))
  })
  if (command === 'advance' || command === 'rewind') return withFileLock(statePath, async () => {
    const state = await readState()
    if (state.finishedAt && command === 'advance') throw new Error('项目已完成；如需修改请先 rewind')
    if (command === 'advance') {
    const target = process.argv[4]
    const currentIndex = stages.indexOf(state.stage)
    if (!stages.includes(target)) throw new Error(`未知阶段：${target}`)
    if (stages.indexOf(target) !== currentIndex + 1) throw new Error(`只能从 ${state.stage} 前进到 ${stages[currentIndex + 1] || '终点'}`)
    const gates = await inspectProgress(state)
    const failed = gates.filter((gate) => !gate.ready)
    if (failed.length) throw new Error(`阶段门禁未通过：${failed.flatMap((gate) => gate.missing.map((item) => `${gate.stage}: ${item}`)).join('；')}`)
    state.completed = [...new Set([...state.completed, state.stage])]
    state.stage = target
    delete state.finishedAt
    state.updatedAt = new Date().toISOString()
    await save(state)
    return console.log(JSON.stringify(state, null, 2))
    }
    if (command === 'rewind') {
    const target = process.argv[4]
    const currentIndex = stages.indexOf(state.stage)
    const targetIndex = stages.indexOf(target)
    if (targetIndex < 0 || targetIndex >= currentIndex) throw new Error(`只能回退到 ${state.stage} 之前的阶段`)
    state.completed = state.completed.filter((stage) => stages.indexOf(stage) < targetIndex)
    state.stage = target
    state.updatedAt = new Date().toISOString()
    state.invalidatedAt ||= {}
    for (const affected of stages.slice(targetIndex)) state.invalidatedAt[affected] = state.updatedAt
    await clearSkillRunsFrom(root, target)
    await save(state)
    return console.log(JSON.stringify(state, null, 2))
    }
  })
  throw new Error('用法：workflow.mjs status|check|advance|rewind|complete <项目目录> [目标阶段]；初始化使用 project-store.mjs init')
}

main().catch((error) => { console.error(error.message); process.exitCode = 1 })
