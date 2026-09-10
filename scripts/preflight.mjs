#!/usr/bin/env node
import { constants } from 'node:fs'
import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { credential } from './generation/credentials.mjs'

function hasCommand(name) {
  return spawnSync('/usr/bin/env', ['sh', '-lc', `command -v ${name}`], { encoding: 'utf8' }).status === 0
}

export async function runPreflight(projectRoot, mode = 'init', persist = true) {
  if (!['init', 'media', 'editing'].includes(mode)) throw new Error('preflight 模式必须是 init、media 或 editing')
  const root = resolve(projectRoot)
  await mkdir(root, { recursive: true })
  await access(root, constants.R_OK | constants.W_OK)
  const nodeMajor = Number(process.versions.node.split('.')[0])
  const providers = {
    starrouter: Boolean(credential('STARROUTER_API_KEY')),
    runninghub: Boolean(credential('RUNNINGHUB_API_KEY')),
    comfly: Boolean(credential('COMFLY_TOKEN')),
  }
  let selectedProviders = {}
  try {
    const project = JSON.parse(await readFile(resolve(root, '.short-drama/project.json'), 'utf8'))
    selectedProviders = Object.fromEntries(['image', 'video', 'audio', 'music'].map((modality) => [modality, project.providers?.[modality]?.provider || null]))
  } catch (error) {
    if (mode !== 'init') throw new Error(`无法读取 project.json：${error.message}`)
  }
  const checks = {
    node: { ok: nodeMajor >= 20, version: process.versions.node },
    project_directory: { ok: true },
    ffmpeg: { ok: hasCommand('ffmpeg') },
    ffprobe: { ok: hasCommand('ffprobe') },
    npm: { ok: hasCommand('npm') },
    npx: { ok: hasCommand('npx') },
    providers,
    selected_providers: selectedProviders,
  }
  const errors = []
  if (!checks.node.ok) errors.push('需要 Node.js 20 或更高版本')
  if (mode === 'media') {
    const selected = [...new Set(Object.values(selectedProviders).filter(Boolean))]
    if (selected.length === 0) errors.push('项目尚未选择媒体 Provider')
    for (const provider of selected) {
      if (!(provider in providers)) errors.push(`不支持的 Provider：${provider}`)
      else if (!providers[provider]) errors.push(`项目选择了 ${provider}，但未检测到对应凭据`)
    }
  }
  if (mode === 'editing') for (const name of ['ffmpeg', 'ffprobe', 'npm', 'npx']) if (!checks[name].ok) errors.push(`缺少 ${name}`)
  const report = { version: 1, mode, ok: errors.length === 0, checks, errors, checkedAt: new Date().toISOString() }
  if (persist) {
    const path = resolve(root, '.short-drama/environment.json')
    const history = resolve(root, '.short-drama/environment')
    await mkdir(history, { recursive: true })
    const content = `${JSON.stringify(report, null, 2)}\n`
    const temporary = `${path}.${randomUUID()}.tmp`
    await writeFile(temporary, content, { flag: 'wx' })
    await rename(temporary, path)
    await writeFile(resolve(history, `${report.checkedAt.replace(/[:.]/g, '-')}-${mode}.json`), content, { flag: 'wx' })
    report.path = relative(root, path)
  }
  if (errors.length) throw new Error(errors.join('；'))
  return report
}

async function main() {
  if (process.argv.includes('--self-check')) {
    const report = await runPreflight(process.cwd(), 'init', false)
    if (!report.ok || !report.checks.node.ok) throw new Error('preflight 自检失败')
    return console.log('ok')
  }
  console.log(JSON.stringify(await runPreflight(process.argv[3] || process.cwd(), process.argv[2] || 'init'), null, 2))
}

if (resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) main().catch((error) => { console.error(error.message); process.exitCode = 1 })
