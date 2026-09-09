#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { listReferenceUploads } from './media-hosting/publish.mjs'

async function findProjectRoot(start) {
  let current = resolve(start)
  while (true) {
    try { await readFile(resolve(current, '.short-drama/project.json')); return current } catch {}
    const parent = dirname(current)
    if (parent === current) return null
    current = parent
  }
}

const root = await findProjectRoot(process.cwd())
if (!root) process.exit(0)

const messages = []
try {
  const project = JSON.parse(await readFile(resolve(root, '.short-drama/project.json'), 'utf8'))
  messages.push(`短剧项目：${project.title}（${root}）`)
  messages.push(project.schema_version === 1 ? `项目规范：v${project.schema_version}` : '项目配置仍是旧版，请先运行 migrate-project-config')
} catch {}
try {
  const state = JSON.parse(await readFile(resolve(root, '.short-drama/state.json'), 'utf8'))
  messages.push(`当前短剧工作流阶段：${state.stage}；已完成：${(state.completed || []).join('、') || '无'}`)
} catch {}
try {
  const sources = JSON.parse(await readFile(resolve(root, 'source/manifest.json'), 'utf8'))
  const selected = Object.values(sources.sources || {}).filter((source) => source.selectedVersionId)
  if (selected.length) messages.push(`已选来源：${selected.map((source) => `${source.key}@${source.selectedVersionId}`).join('、')}`)
} catch {}
try {
  const ledger = JSON.parse(await readFile(resolve(root, '.short-drama/tasks.json'), 'utf8'))
  const active = Object.values(ledger.tasks || {}).filter((task) => ['submitting', 'queued', 'running'].includes(task.status))
  if (active.length) messages.push(`在途任务：${active.map((task) => `${task.taskId}(${task.status})`).join('、')}`)
} catch {}
try {
  const uploads = await listReferenceUploads(root, { state: 'active' })
  if (uploads.length) messages.push(`有效临时参考图：${uploads.length} 个，最早到期 ${uploads.map((item) => item.expires_at).sort()[0]}`)
} catch {}
if (messages.length) console.log(`${messages.join('；')}。先读取 .short-drama/RESUME.md，再读取当前阶段要求的原子 Skill，不要跳过阶段门禁。`)
