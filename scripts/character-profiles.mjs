#!/usr/bin/env node
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateAudienceAppeal } from './character-appeal.mjs'

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const vocabulary = JSON.parse(await readFile(resolve(pluginRoot, 'references/controlled-vocabulary.json'), 'utf8'))
const profileRules = vocabulary.characterProfile
const NEW_FIELDS = ['name', 'aliases', 'introduction', 'gender', 'age_range', 'role_level', 'archetype', 'personality_tags', 'era_period', 'social_class', 'occupation', 'costume_tier', 'suggested_colors', 'primary_identifier', 'visual_keywords', 'performance_bible', 'voice_identity', 'audience_appeal', 'expected_appearances']
const PERFORMANCE_FIELDS = ['center_of_gravity', 'gait', 'habitual_actions', 'eyeline_behavior', 'blink_rhythm', 'stress_response', 'forbidden_performance']
const VOICE_FIELDS = ['pitch', 'timbre', 'accent', 'pace', 'delivery']
const UPDATE_FIELDS = ['name', 'updated_introduction', 'updated_aliases']

function object(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${field} 必须是对象`)
  return value
}

function exactFields(value, fields, label) {
  const keys = Object.keys(object(value, label)).sort()
  const expected = [...fields].sort()
  if (JSON.stringify(keys) !== JSON.stringify(expected)) throw new Error(`${label} 字段必须且只能是：${fields.join(', ')}`)
}

function text(value, field, allowEmpty = false) {
  if (typeof value !== 'string' || (!allowEmpty && !value.trim())) throw new Error(`${field} 必须是${allowEmpty ? '' : '非空'}字符串`)
  if (value.length > 160 && /(?:performance_bible|voice_identity)/.test(field)) throw new Error(`${field} 超过 160 字符`)
}

function textList(value, field, limits = {}) {
  if (!Array.isArray(value)) throw new Error(`${field} 必须是数组`)
  if (limits.min !== undefined && value.length < limits.min) throw new Error(`${field} 至少 ${limits.min} 项`)
  if (limits.max !== undefined && value.length > limits.max) throw new Error(`${field} 最多 ${limits.max} 项`)
  for (const [index, item] of value.entries()) text(item, `${field}[${index}]`)
  if (new Set(value.map((item) => item.trim().toLocaleLowerCase())).size !== value.length) throw new Error(`${field} 不得重复`)
}

function validateNew(character, index) {
  const label = `new_characters[${index}]`
  exactFields(character, NEW_FIELDS, label)
  for (const field of ['name', 'introduction', 'age_range', 'archetype', 'era_period', 'social_class', 'occupation']) text(character[field], `${label}.${field}`)
  text(character.primary_identifier, `${label}.primary_identifier`, !['S', 'A'].includes(character.role_level))
  textList(character.aliases, `${label}.aliases`)
  textList(character.personality_tags, `${label}.personality_tags`, { min: 2, max: 5 })
  textList(character.suggested_colors, `${label}.suggested_colors`, { min: 2, max: 3 })
  textList(character.visual_keywords, `${label}.visual_keywords`)
  if (!profileRules.roleLevels.includes(character.role_level)) throw new Error(`${label}.role_level 枚举无效`)
  if (!profileRules.costumeTiers.includes(character.costume_tier)) throw new Error(`${label}.costume_tier 枚举无效`)
  if (!profileRules.genders.includes(character.gender)) throw new Error(`${label}.gender 枚举无效`)
  exactFields(character.performance_bible, PERFORMANCE_FIELDS, `${label}.performance_bible`)
  for (const field of PERFORMANCE_FIELDS.filter((name) => !['habitual_actions', 'forbidden_performance'].includes(name))) text(character.performance_bible[field], `${label}.performance_bible.${field}`)
  textList(character.performance_bible.habitual_actions, `${label}.performance_bible.habitual_actions`, { max: 8 })
  textList(character.performance_bible.forbidden_performance, `${label}.performance_bible.forbidden_performance`, { max: 8 })
  exactFields(character.voice_identity, VOICE_FIELDS, `${label}.voice_identity`)
  for (const field of VOICE_FIELDS) text(character.voice_identity[field], `${label}.voice_identity.${field}`)
  validateAudienceAppeal(character.audience_appeal, character)
  if (!Array.isArray(character.expected_appearances) || character.expected_appearances.length === 0) throw new Error(`${label}.expected_appearances 至少一项`)
  const ids = new Set()
  for (const [appearanceIndex, appearance] of character.expected_appearances.entries()) {
    exactFields(appearance, ['id', 'change_reason'], `${label}.expected_appearances[${appearanceIndex}]`)
    if (!Number.isInteger(appearance.id) || appearance.id < 1 || ids.has(appearance.id)) throw new Error(`${label}.expected_appearances id 无效或重复`)
    ids.add(appearance.id)
    text(appearance.change_reason, `${label}.expected_appearances[${appearanceIndex}].change_reason`)
  }
  if (!ids.has(1)) throw new Error(`${label}.expected_appearances 缺少 id=1`)
}

export function validateAnalysis(value) {
  exactFields(value, ['new_characters', 'updated_characters'], '输出')
  if (!Array.isArray(value.new_characters) || !Array.isArray(value.updated_characters)) throw new Error('new_characters/updated_characters 必须是数组')
  value.new_characters.forEach(validateNew)
  value.updated_characters.forEach((character, index) => {
    const label = `updated_characters[${index}]`
    exactFields(character, UPDATE_FIELDS, label)
    text(character.name, `${label}.name`)
    text(character.updated_introduction, `${label}.updated_introduction`)
    textList(character.updated_aliases, `${label}.updated_aliases`)
  })
  const names = [...value.new_characters, ...value.updated_characters].map((item) => item.name.trim().toLocaleLowerCase())
  if (new Set(names).size !== names.length) throw new Error('同一人物不能同时新增或更新多次')
  return value
}

async function readStore(root) {
  try {
    const store = object(JSON.parse(await readFile(resolve(root, 'assets/characters/profiles.json'), 'utf8')), '人物库')
    if (!Array.isArray(store.characters)) throw new Error('人物库 characters 必须是数组')
    return store
  } catch (error) {
    if (error?.code === 'ENOENT') return { version: 1, characters: [] }
    throw error
  }
}

async function saveStore(root, store) {
  const path = resolve(root, 'assets/characters/profiles.json')
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${randomUUID()}.tmp`
  await writeFile(temporary, `${JSON.stringify(store, null, 2)}\n`, { flag: 'wx' })
  await rename(temporary, path)
}

function identitySet(character) {
  return new Set([character.name, ...(character.aliases || [])].map((value) => value.trim().toLocaleLowerCase()).filter(Boolean))
}

async function main() {
  const [command, rootArg, fileArg] = process.argv.slice(2)
  if (command === '--self-check') {
    validateAnalysis({ new_characters: [], updated_characters: [] })
    return console.log('ok')
  }
  if (!rootArg) throw new Error('必须提供项目目录')
  const root = resolve(rootArg)
  if (command === 'context') {
    const store = await readStore(root)
    return console.log(JSON.stringify({ characters: store.characters.map(({ name, aliases = [], introduction = '' }) => ({ name, aliases, introduction })) }, null, 2))
  }
  if (!fileArg) throw new Error(`${command} 必须提供分析结果 JSON`)
  const analysis = validateAnalysis(JSON.parse(await readFile(resolve(fileArg), 'utf8')))
  if (command === 'validate') return console.log('ok')
  if (command !== 'apply') throw new Error('用法：character-profiles.mjs context <项目目录> | validate|apply <项目目录> <结果 JSON>')
  const store = await readStore(root)
  for (const update of analysis.updated_characters) {
    const current = store.characters.find((character) => character.name === update.name)
    if (!current) throw new Error(`待更新人物不存在：${update.name}`)
    current.introduction = update.updated_introduction
    current.aliases = update.updated_aliases
  }
  for (const character of analysis.new_characters) {
    const incoming = identitySet(character)
    if (store.characters.some((current) => [...identitySet(current)].some((name) => incoming.has(name)))) throw new Error(`新增人物与已有规范名或别名冲突：${character.name}`)
    store.characters.push(character)
  }
  store.version = 1
  store.updatedAt = new Date().toISOString()
  await saveStore(root, store)
  console.log(JSON.stringify({ characters: store.characters.length, path: 'assets/characters/profiles.json' }))
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((error) => { console.error(error.message); process.exitCode = 1 })
