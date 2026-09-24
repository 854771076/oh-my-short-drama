import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import test from 'node:test'
import { resolve } from 'node:path'
import { moduleById, modulesForStage, readModuleMap, validateModuleMap } from './module-map.mjs'

const root = resolve(import.meta.dirname, '..')

test('模块注册表覆盖全部旧 Skill，且目标路径唯一', async () => {
  const map = await readModuleMap(root)
  const skillDirectories = (await readdir(resolve(root, 'skills'), { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
  const legacyIds = Object.keys(map.legacy_skill_map).sort()

  assert.deepEqual(legacyIds, skillDirectories)
  assert.deepEqual(Object.keys(map.legacy_skill_sha256).sort(), skillDirectories)
  assert.equal(Object.keys(map.modules).length, skillDirectories.length)
  assert.equal(new Set(Object.values(map.modules).map((item) => item.path)).size, skillDirectories.length)
  for (const [id, module] of Object.entries(map.modules)) {
    assert.match(module.path, /^skills\/short-drama\/references\/(?:workflow|creation|assets|storyboard|generation|review|editing|recreation|market|operations)\/[a-z0-9-]+\.md$/)
    assert.equal(map.legacy_skill_map[id], id)
    assert.match(map.legacy_skill_sha256[id], /^[0-9a-f]{64}$/)
  }
})

test('模块注册表阶段顺序确定，查询结果不可变', async () => {
  const map = await readModuleMap(root)
  for (const [stage, expected] of Object.entries(map.stages)) {
    assert.deepEqual(modulesForStage(map, stage), expected)
    assert.deepEqual(modulesForStage(map, stage), expected)
    assert.equal(new Set(expected).size, expected.length)
    for (const id of expected) assert.equal(moduleById(map, id).stage, stage)
  }
})

test('模块注册表拒绝未知 owner、缺失依赖和循环依赖', async () => {
  const source = JSON.parse(await readFile(resolve(root, 'references/module-map.json'), 'utf8'))

  const unknownOwner = structuredClone(source)
  unknownOwner.prompts.example = 'missing-module'
  assert.throws(() => validateModuleMap(unknownOwner), /未知模块/)

  const missingDependency = structuredClone(source)
  missingDependency.modules['short-drama'].dependencies = ['missing-module']
  assert.throws(() => validateModuleMap(missingDependency), /依赖不存在/)

  const cycle = structuredClone(source)
  cycle.modules['short-drama'].dependencies = ['write-drama-episode']
  cycle.modules['write-drama-episode'].dependencies = ['short-drama']
  assert.throws(() => validateModuleMap(cycle), /循环依赖/)
})
