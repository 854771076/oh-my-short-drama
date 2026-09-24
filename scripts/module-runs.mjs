#!/usr/bin/env node
import { access, mkdir, readdir, readFile, realpath, rename, writeFile } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { dirname, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { stages } from './workflow-stages.mjs'
import { isH3Model } from './generation/providers.mjs'
import { readModuleMap } from './module-map.mjs'
import { withFileLock } from './file-lock.mjs'

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

async function exists(path) {
  try { await access(path); return true } catch { return false }
}

async function sha256(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex')
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${randomUUID()}.tmp`
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' })
  await rename(temporary, path)
}

async function confinedPaths(root, values, label) {
  const rootReal = await realpath(root)
  const output = []
  for (const value of [...new Set(values)]) {
    const path = resolve(root, value)
    const local = relative(root, path)
    if (!local || local === '..' || local.startsWith(`..${sep}`)) throw new Error(`${label}必须位于项目内：${value}`)
    await access(path)
    const actual = await realpath(path)
    if (actual !== rootReal && !actual.startsWith(`${rootReal}${sep}`)) throw new Error(`${label}真实路径必须位于项目内：${value}`)
    output.push(local)
  }
  return output
}

async function moduleReference(moduleMap, moduleId) {
  const target = moduleMap.modules[moduleId]?.path
  if (!target) throw new Error(`未知模块：${moduleId}`)
  const legacy = `skills/${moduleId}/SKILL.md`
  const path = await exists(resolve(pluginRoot, target)) ? target : legacy
  if (!await exists(resolve(pluginRoot, path))) throw new Error(`模块 reference 不存在：${moduleId}`)
  return { path, sha256: await sha256(resolve(pluginRoot, path)) }
}

function promptMode(moduleMap, moduleId, stage) {
  const prompts = Object.entries(moduleMap.prompts).filter(([, owner]) => owner === moduleId).map(([name]) => name)
  if (!prompts.length) return null
  const providerPrompts = new Set(moduleMap.provider_prompts || [])
  if (['asset-generation', 'media-production'].includes(stage) && prompts.some((name) => providerPrompts.has(name))) return 'provider-prompt'
  return prompts.some((name) => !providerPrompts.has(name)) ? 'codex-contract' : 'provider-prompt'
}

function acceptedPrompts(moduleMap, moduleId) {
  return new Set(moduleMap.completion_prompts?.[moduleId] || Object.entries(moduleMap.prompts).filter(([, owner]) => owner === moduleId).map(([name]) => name))
}

async function linkedPromptRuns(root, moduleMap, moduleId, stage, evidence) {
  const mode = promptMode(moduleMap, moduleId, stage)
  if (!mode) return []
  const directory = resolve(root, '.short-drama/prompt-runs')
  if (!await exists(directory)) throw new Error(`${moduleId} 缺少 ${mode} 提示词运行记录`)
  let cutoff
  try { cutoff = JSON.parse(await readFile(resolve(root, '.short-drama/state.json'), 'utf8')).invalidatedAt?.[stage] } catch {}
  const matches = []
  for (const file of await readdir(directory)) {
    if (!/^prompt-[0-9a-f-]+\.json$/.test(file)) continue
    const path = resolve(directory, file)
    const record = JSON.parse(await readFile(path, 'utf8'))
    if ((!cutoff || Date.parse(record.createdAt) >= Date.parse(cutoff)) && acceptedPrompts(moduleMap, moduleId).has(record.prompt) && moduleMap.prompts[record.prompt] === moduleId && record.executionMode === mode && (mode === 'provider-prompt' || evidence.includes(record.outputPath))) matches.push({ path: relative(root, path), sha256: await sha256(path), prompt: record.prompt, executionMode: mode, outputPath: record.outputPath, createdAt: record.createdAt })
  }
  if (!matches.length) throw new Error(`${moduleId} 缺少 ${mode} 提示词运行记录`)
  const ordered = matches.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
  if (mode === 'provider-prompt') return ordered.slice(-1)
  const latestByOutput = new Map(ordered.map((item) => [item.outputPath, item]))
  const linked = evidence.map((path) => latestByOutput.get(path))
  if (linked.some((item) => !item)) throw new Error(`${moduleId} 每个证据都必须有对应的 Codex 合同运行记录`)
  return linked
}

async function selectedEpisodes(root) {
  const directory = resolve(root, 'episodes')
  if (!await exists(directory)) return []
  return (await readdir(directory, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()
}

async function selectedDocument(root, episode, kind) {
  const markerPath = resolve(root, 'episodes', episode, kind, 'selected.json')
  if (!await exists(markerPath)) return null
  const marker = JSON.parse(await readFile(markerPath, 'utf8'))
  return JSON.parse(await readFile(resolve(root, marker.path), 'utf8'))
}

function hasStructuredAction(document) {
  const items = [...(document?.scenes || []), ...(document?.shots || [])]
  return items.some((item) => item?.action_complexity === 'choreographed' || item?.fight_design || item?.fight_design_ref)
}

async function needsFightDesign(root) {
  for (const episode of await selectedEpisodes(root)) {
    for (const kind of ['director-book', 'production-plan']) {
      if (hasStructuredAction(await selectedDocument(root, episode, kind))) return true
    }
  }
  return false
}

export async function requiredModules(root, stage) {
  if (!stages.includes(stage)) throw new Error(`未知阶段：${stage}`)
  const moduleMap = await readModuleMap()
  let required = new Set(moduleMap.stages?.[stage] || [])

  if (stage === 'analysis') {
    let project = { workflow: { type: 'standard' } }
    try { project = JSON.parse(await readFile(resolve(root, '.short-drama/project.json'), 'utf8')) } catch (error) { if (error?.code !== 'ENOENT') throw error }
    if (project.workflow?.type === 'viral-recreation') {
      required.delete('analyze-drama-source')
      const remainder = [...required].filter((id) => id !== 'manage-drama-projects')
      required = new Set(['manage-drama-projects', 'use-short-drama-studio', 'configure-generation-providers', 'analyze-reference-video', 'use-hypit-video', 'design-video-recreation', ...remainder])
    }
  }

  if (stage === 'asset-analysis') {
    for (const episode of await selectedEpisodes(root)) {
      const plan = await selectedDocument(root, episode, 'asset-plan')
      if (plan?.characters?.length) required.add('generate-character-profiles')
    }
  }

  if (stage === 'asset-generation') {
    let ledger = { assets: {} }
    try { ledger = JSON.parse(await readFile(resolve(root, '.short-drama/assets.json'), 'utf8')) } catch (error) { if (error?.code !== 'ENOENT') throw error }
    let needsProvider = false
    for (const episode of await selectedEpisodes(root)) {
      const plan = await selectedDocument(root, episode, 'asset-plan')
      for (const [group, moduleId] of [['characters', 'generate-character-images'], ['scenes', 'generate-scene-assets'], ['props', 'generate-prop-assets']]) {
        for (const item of plan?.[group] || []) {
          const asset = ledger.assets?.[item.key]
          const version = asset?.versions?.find((entry) => entry.id === asset.selectedVersionId)
          const reusable = version && typeof version.localPath === 'string' && !asset.staleVersionIds?.includes(version.id) && version.provenance?.created_by !== 'provider' && await exists(resolve(root, version.localPath))
          if (!reusable) { required.add(moduleId); needsProvider = true }
        }
      }
    }
    if (needsProvider) required.add('drama-generation-service')
  }

  if (stage === 'production-plan') {
    required.delete('design-fight-video')
    if (await needsFightDesign(root)) required = new Set(['design-fight-video', ...required])
    for (const episode of await selectedEpisodes(root)) {
      for (const kind of ['production-plan', 'video-prompts']) {
        const document = await selectedDocument(root, episode, kind)
        if (Array.isArray(document?.unresolved) && document.unresolved.length > 0) required.add('revise-drama-storyboards')
      }
    }
  }

  if (stage === 'media-production') {
    let needsIndependentAudio = false
    for (const episode of await selectedEpisodes(root)) {
      const plan = await selectedDocument(root, episode, 'production-plan')
      for (const shot of plan?.shots || []) {
        if ((shot.storyboard_strategy?.mode || 'image') === 'image') required.add('generate-storyboard-images')
        if (shot.previz_strategy?.mode === 'blender') {
          required.add('direct-blender-previz')
          required.add('generate-blender-previz')
        }
        const mode = typeof shot.audio_strategy === 'string' ? shot.audio_strategy : shot.audio_strategy?.mode
        if (!isH3Model(shot.provider, shot.model_or_workflow) || mode !== 'native') needsIndependentAudio = true
      }
    }
    if (needsIndependentAudio) required.add('design-drama-audio')
  }

  return [...required]
}

async function readModuleRunsFile(root) {
  const path = resolve(root, '.short-drama/module-runs.json')
  if (!await exists(path)) return { version: 1, runs: {} }
  return JSON.parse(await readFile(path, 'utf8'))
}

export async function readModuleRuns(root) {
  if (!await exists(resolve(root, '.short-drama/module-runs.json')) && await exists(resolve(root, '.short-drama/skill-runs.json'))) return migrateSkillRuns(root)
  return readModuleRunsFile(root)
}

export async function isModuleRunValid(root, run) {
  try {
    if (!run || !stages.includes(run.stage) || typeof run.moduleId !== 'string' || run.status !== 'completed' || !Array.isArray(run.evidence) || !run.evidence.length || !Array.isArray(run.inputs)) return false
    const moduleMap = await readModuleMap()
    const reference = await moduleReference(moduleMap, run.moduleId)
    if (run.referencePath !== reference.path || run.referenceSha256 !== reference.sha256) return false
    for (const [paths, hashes] of [[run.inputs, run.inputSha256], [run.evidence, run.evidenceSha256]]) {
      if (!hashes || typeof hashes !== 'object') return false
      const confined = await confinedPaths(root, paths, '凭证文件')
      for (const path of confined) if (hashes[path] !== await sha256(resolve(root, path))) return false
    }
    for (const promptRun of run.promptRuns || []) if (!await exists(resolve(root, promptRun.path)) || promptRun.sha256 !== await sha256(resolve(root, promptRun.path))) return false
    return true
  } catch {
    return false
  }
}

export async function recordModuleRun(root, stage, moduleId, evidenceValues, options = {}) {
  if (!(await requiredModules(root, stage)).includes(moduleId)) throw new Error(`${moduleId} 不是 ${stage} 当前要求的模块`)
  if (!Array.isArray(evidenceValues) || evidenceValues.length === 0) throw new Error(`${moduleId} 至少需要一个证据文件`)
  const moduleMap = await readModuleMap()
  const [evidence, inputs, reference] = await Promise.all([
    confinedPaths(root, evidenceValues, '证据'),
    confinedPaths(root, options.inputs || [], '输入'),
    moduleReference(moduleMap, moduleId),
  ])
  const promptRuns = await linkedPromptRuns(root, moduleMap, moduleId, stage, evidence)
  const run = {
    stage,
    moduleId,
    status: 'completed',
    referencePath: reference.path,
    referenceSha256: reference.sha256,
    inputs,
    inputSha256: Object.fromEntries(await Promise.all(inputs.map(async (path) => [path, await sha256(resolve(root, path))]))),
    evidence,
    evidenceSha256: Object.fromEntries(await Promise.all(evidence.map(async (path) => [path, await sha256(resolve(root, path))]))),
    promptRuns,
    completedAt: new Date().toISOString(),
  }
  const ledgerPath = resolve(root, '.short-drama/module-runs.json')
  await withFileLock(ledgerPath, async () => {
    const ledger = await readModuleRuns(root)
    ledger.runs[`${stage}:${moduleId}`] = run
    await writeJson(ledgerPath, ledger)
  })
  return run
}

export async function migrateSkillRuns(root) {
  const legacyPath = resolve(root, '.short-drama/skill-runs.json')
  const ledgerPath = resolve(root, '.short-drama/module-runs.json')
  if (!await exists(legacyPath)) return readModuleRuns(root)
  return withFileLock(ledgerPath, async () => {
    const [legacy, ledger, moduleMap] = await Promise.all([
      readFile(legacyPath, 'utf8').then(JSON.parse),
      readModuleRunsFile(root),
      readModuleMap(),
    ])
    let changed = false
    for (const [legacyKey, oldRun] of Object.entries(legacy.runs || {})) {
      const moduleId = moduleMap.legacy_skill_map?.[oldRun.skill]
      const key = `${oldRun.stage}:${moduleId}`
      if (!moduleId || ledger.runs[key] || oldRun.status !== 'completed' || !stages.includes(oldRun.stage) || !Array.isArray(oldRun.evidence) || !oldRun.evidence.length) continue
      let valid = true
      try {
        const expectedLegacySha = moduleMap.legacy_skill_sha256?.[oldRun.skill]
        if (!/^[0-9a-f]{64}$/.test(expectedLegacySha || '')) continue
        const legacySourcePath = resolve(pluginRoot, 'skills', oldRun.skill, 'SKILL.md')
        if (await exists(legacySourcePath) && await sha256(legacySourcePath) !== expectedLegacySha) continue
        const evidence = await confinedPaths(root, oldRun.evidence, '旧凭证')
        for (const path of evidence) if (oldRun.evidenceSha256?.[path] !== await sha256(resolve(root, path))) valid = false
        for (const promptRun of oldRun.promptRuns || []) if (!await exists(resolve(root, promptRun.path)) || promptRun.sha256 !== await sha256(resolve(root, promptRun.path))) valid = false
        if (!valid) continue
        const reference = await moduleReference(moduleMap, moduleId)
        ledger.runs[key] = {
          stage: oldRun.stage,
          moduleId,
          status: 'completed',
          referencePath: reference.path,
          referenceSha256: reference.sha256,
          inputs: [],
          inputSha256: {},
          evidence,
          evidenceSha256: { ...oldRun.evidenceSha256 },
          promptRuns: oldRun.promptRuns || [],
          completedAt: oldRun.completedAt,
          migratedFromSkillRun: legacyKey,
          legacyRunSha256: createHash('sha256').update(JSON.stringify(oldRun)).digest('hex'),
        }
        changed = true
      } catch {}
    }
    if (changed || !await exists(ledgerPath)) await writeJson(ledgerPath, ledger)
    return ledger
  })
}

export async function clearModuleRunsFrom(root, stage) {
  const start = stages.indexOf(stage)
  if (start < 0) throw new Error(`未知阶段：${stage}`)
  const ledgerPath = resolve(root, '.short-drama/module-runs.json')
  await withFileLock(ledgerPath, async () => {
    const ledger = await readModuleRuns(root)
    ledger.runs = Object.fromEntries(Object.entries(ledger.runs || {}).filter(([, run]) => stages.indexOf(run.stage) < start))
    await writeJson(ledgerPath, ledger)
  })
}

async function main() {
  const [command, rootArg, stage, moduleId, ...args] = process.argv.slice(2)
  if (!rootArg) throw new Error('用法：module-runs.mjs required|record|record-stage|list|migrate <项目目录> [阶段] [模块] [证据路径...] [--input 输入路径...]')
  const root = resolve(rootArg)
  if (command === 'required') return console.log(JSON.stringify(await requiredModules(root, stage), null, 2))
  if (command === 'list') return console.log(JSON.stringify(await readModuleRuns(root), null, 2))
  if (command === 'migrate') return console.log(JSON.stringify(await migrateSkillRuns(root), null, 2))
  if (command === 'record-stage') {
    if (!stage) throw new Error('用法：module-runs.mjs record-stage <项目目录> <阶段>')
    const ledger = await readModuleRuns(root)
    const missing = []
    for (const required of await requiredModules(root, stage)) if (!await isModuleRunValid(root, ledger.runs?.[`${stage}:${required}`])) missing.push(required)
    if (missing.length) throw new Error(`以下模块没有有效凭证，请先逐项 record：${missing.join('、')}`)
    return console.log(`${stage}:completed`)
  }
  if (command !== 'record' || !stage || !moduleId) throw new Error('用法：module-runs.mjs record <项目目录> <阶段> <模块> <证据路径...> [--input 输入路径...]')
  const separator = args.indexOf('--input')
  const evidence = separator < 0 ? args : args.slice(0, separator)
  const inputs = separator < 0 ? [] : args.slice(separator + 1)
  const run = await recordModuleRun(root, stage, moduleId, evidence, { inputs })
  console.log(`${run.stage}:${run.moduleId}`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch((error) => { console.error(error.message); process.exitCode = 1 })
