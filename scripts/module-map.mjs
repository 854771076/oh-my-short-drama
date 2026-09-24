#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const categories = new Set(['workflow', 'creation', 'assets', 'storyboard', 'generation', 'review', 'editing', 'recreation', 'market', 'operations'])

function assertString(value, message) {
  if (typeof value !== 'string' || !value) throw new Error(message)
}

export function validateModuleMap(map) {
  if (!map || map.version !== 1 || !map.modules || typeof map.modules !== 'object' || Array.isArray(map.modules)) throw new Error('module-map.json 合同无效')
  const ids = new Set(Object.keys(map.modules))
  const paths = new Set()
  for (const [id, module] of Object.entries(map.modules)) {
    assertString(id, '模块 ID 无效')
    if (!module || typeof module !== 'object' || Array.isArray(module)) throw new Error(`模块定义无效：${id}`)
    assertString(module.path, `模块路径无效：${id}`)
    if (paths.has(module.path)) throw new Error(`模块路径重复：${module.path}`)
    paths.add(module.path)
    if (!categories.has(module.category)) throw new Error(`模块分类无效：${id}`)
    if (module.stage !== null && typeof module.stage !== 'string') throw new Error(`模块阶段无效：${id}`)
    if (!Array.isArray(module.dependencies) || module.dependencies.some((dependency) => typeof dependency !== 'string')) throw new Error(`模块依赖无效：${id}`)
    for (const dependency of module.dependencies) if (!ids.has(dependency)) throw new Error(`模块依赖不存在：${id} -> ${dependency}`)
  }

  for (const [stage, modules] of Object.entries(map.stages || {})) {
    if (!Array.isArray(modules) || new Set(modules).size !== modules.length) throw new Error(`阶段模块列表无效：${stage}`)
    for (const id of modules) {
      if (!ids.has(id)) throw new Error(`阶段引用未知模块：${stage} -> ${id}`)
      if (map.modules[id].stage !== stage) throw new Error(`模块阶段不一致：${id}`)
    }
  }
  for (const [prompt, owner] of Object.entries(map.prompts || {})) {
    if (!ids.has(owner)) throw new Error(`提示词引用未知模块：${prompt} -> ${owner}`)
  }
  for (const [owner, prompts] of Object.entries(map.completion_prompts || {})) {
    if (!ids.has(owner)) throw new Error(`完成提示词引用未知模块：${owner}`)
    if (!Array.isArray(prompts) || prompts.some((prompt) => map.prompts?.[prompt] !== owner)) throw new Error(`完成提示词归属无效：${owner}`)
  }
  for (const [legacy, id] of Object.entries(map.legacy_skill_map || {})) {
    if (!legacy || !ids.has(id)) throw new Error(`旧 Skill 映射无效：${legacy}`)
  }

  const visiting = new Set()
  const visited = new Set()
  function visit(id) {
    if (visiting.has(id)) throw new Error(`模块存在循环依赖：${id}`)
    if (visited.has(id)) return
    visiting.add(id)
    for (const dependency of map.modules[id].dependencies) visit(dependency)
    visiting.delete(id)
    visited.add(id)
  }
  for (const id of ids) visit(id)
  return map
}

export async function readModuleMap(root = defaultRoot) {
  return validateModuleMap(JSON.parse(await readFile(resolve(root, 'references/module-map.json'), 'utf8')))
}

export function moduleById(map, id) {
  const module = map.modules?.[id]
  if (!module) throw new Error(`未知模块：${id}`)
  return module
}

export function modulesForStage(map, stage) {
  if (!Array.isArray(map.stages?.[stage])) throw new Error(`未知阶段：${stage}`)
  return [...map.stages[stage]]
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const map = await readModuleMap(process.argv[2] ? resolve(process.argv[2]) : defaultRoot)
  console.log(JSON.stringify(map, null, 2))
}
