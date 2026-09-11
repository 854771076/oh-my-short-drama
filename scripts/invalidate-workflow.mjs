import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { stages } from './workflow-stages.mjs'
import { clearSkillRunsFrom } from './skill-runs.mjs'
import { withFileLock } from './file-lock.mjs'

export async function invalidateFrom(rootArg, stage) {
  const root = resolve(rootArg)
  const targetIndex = stages.indexOf(stage)
  if (targetIndex < 0) throw new Error(`未知失效阶段：${stage}`)
  const statePath = resolve(root, '.short-drama/state.json')
  return withFileLock(statePath, async () => {
    const state = JSON.parse(await readFile(statePath, 'utf8'))
    if (stages.indexOf(state.stage) < targetIndex && !state.finishedAt) return state
    await clearSkillRunsFrom(root, stage)
    const now = new Date().toISOString()
    state.stage = stage
    state.completed = (state.completed || []).filter((item) => stages.indexOf(item) < targetIndex)
    state.invalidatedAt ||= {}
    for (const affected of stages.slice(targetIndex)) state.invalidatedAt[affected] = now
    delete state.finishedAt
    state.updatedAt = now
    await mkdir(resolve(root, '.short-drama'), { recursive: true })
    const temporary = `${statePath}.${randomUUID()}.tmp`
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { flag: 'wx' })
    await rename(temporary, statePath)
    return state
  })
}

export async function invalidateShot(rootArg, episodeKey, shotNumber, stage) {
  const root = resolve(rootArg)
  if (!/^ep-\d{3}$/.test(episodeKey) || !Number.isInteger(shotNumber) || shotNumber < 1 || !stages.includes(stage)) throw new Error('镜头失效参数无效')
  const statePath = resolve(root, '.short-drama/state.json')
  return withFileLock(statePath, async () => {
    const state = JSON.parse(await readFile(statePath, 'utf8'))
    const now = new Date().toISOString()
    state.shotInvalidatedAt ||= {}
    state.shotInvalidatedAt[episodeKey] ||= {}
    state.shotInvalidatedAt[episodeKey][shotNumber] = { stage, at: now }
    state.updatedAt = now
    const temporary = `${statePath}.${randomUUID()}.tmp`
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { flag: 'wx' })
    await rename(temporary, statePath)
    return state
  })
}
