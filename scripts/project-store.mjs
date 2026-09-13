#!/usr/bin/env node
import { access, copyFile, mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { COPYFILE_EXCL } from 'node:constants'
import { basename, dirname, extname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { stages } from './workflow-stages.mjs'
import { withFileLock } from './file-lock.mjs'
import { runPreflight } from './preflight.mjs'
import { invalidateFrom, invalidateShot } from './invalidate-workflow.mjs'
import { invalidateShotAssets } from './asset-ledger.mjs'
import { ANTI_GRID_CLAIM_ZH, ANTI_GRID_CLAIM_EN, hasAntiGridClaim } from './grid-detect.mjs'
import { changedShotNumbers } from './shot-fingerprint.mjs'
import { DEFAULT_WORKSPACE_ROOT, openStudio } from './studio.mjs'
import { normalizeModelParameters, providerSetupCatalog } from './generation/providers.mjs'
import { saveCustomArtStyle } from './art-styles.mjs'

const root = process.argv[2] === 'init' ? resolve(DEFAULT_WORKSPACE_ROOT, process.argv[3] || 'short-drama') : resolve(process.argv[3] || process.cwd())
const EPISODE_DOCUMENTS = new Set(['script-review', 'director-book', 'asset-plan', 'production-plan', 'storyboard', 'video-prompts', 'audio-plan'])
const ASSET_TYPES = { characters: 'character', scenes: 'scene', props: 'prop' }
const PROMPT_PROFILES = new Set(['seedance2', 'h3', 'generic'])
const H3_MODES = new Set(['T2VA', 'I2VA', 'FL2VA', 'L2VA', 'Ref2VA'])
const ASPECT_RATIOS = new Set(['9:16', '16:9', '1:1', '4:3', '3:4', '21:9'])
const STORYBOARD_TYPES = new Set(['single', 'storyboard', 'shot-board'])
const ADAPTATION_MODES = new Set(['original', 'faithful_adaptation', 'authorized_adaptation'])

async function exists(path) { try { await access(path); return true } catch { return false } }

function safeKey(value, field = 'key') {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value)) throw new Error(`${field} 无效`)
  return value
}

function defaultKey(value) {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'short-drama'
}

function projectKey(value) {
  if (typeof value !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) throw new Error('project key 必须是小写 kebab-case')
  return value
}

function validateEpisodeKey(value) {
  if (typeof value !== 'string' || !/^ep-\d{3}$/.test(value)) throw new Error('episode key 必须为 ep-001 格式')
  return value
}

function versionKey(value, field = 'version') {
  if (typeof value !== 'string' || !/^v\d{3}$/.test(value)) throw new Error(`${field} 必须为 v001 格式`)
  return value
}

const providerDefaults = () => ({ provider: null, model_or_workflow: null, prompt_profile: null, parameters: {} })
const defaultArtStyle = () => ({
  id: 'system-realistic',
  name: '真人风格',
  description: '真实电影级画面质感，适合标准真人短剧制作。',
  prompt: 'Realistic cinematic look, real-world scene fidelity, rich transparent colors, clean and refined image quality.',
  visualBible: {
    version: 1,
    palette: { primary: ['#15324A', '#23272B'], secondary: ['#A8ADB3'], accent: ['#C58A42'], neutral: ['#B7A99A'], scheme: 'complementary' },
    baseline: { saturation: 'muted', brightness: 'low-key', contrast: 'high', temperature: 'cool' },
    lighting: { key_direction: '有动机的侧光或侧逆光', key_quality: '自然柔光配克制阴影', continuity: '同场景锁定主光方向、曝光与白平衡' },
    narrative_arc: [
      { name: '建立', trigger: '人物与环境建立', color_shift: '冷中性基调', saturation: '克制', brightness: '平衡' },
      { name: '发展', trigger: '关系与冲突推进', color_shift: '维持冷暖平衡', saturation: '克制', brightness: '平衡' },
      { name: '转折/高潮', trigger: '真相或行动爆发', color_shift: '琥珀局部进入', saturation: '局部提高', brightness: '提高主体' },
      { name: '收束', trigger: '冲突结束', color_shift: '冷暖重新平衡', saturation: '回落', brightness: '柔和' },
    ],
    motion_language: { camera: '稳定构图和有动机的缓慢移动', stillness: '允许情绪停顿与静止镜头', impact: '冲击点只用短促微震与动作反应链', motion_blur: '仅作用于高速主体', slow_motion: '仅用于关键情绪或动作峰值' },
    negative_constraints: ['避免过饱和与过度 HDR', '避免无动机的色温跳变', '避免塑料皮肤与油腻高光'],
  },
})
function projectDefaults(key, title) {
  return {
    schema_version: 1,
    key,
    title,
    automation_mode: true,
    description: null,
    format: { aspect_ratio: null, resolution: null, fps: null, episode_count: null, episode_duration_seconds: null },
    languages: { output: null, spoken: null, subtitle: null },
    creative: { adaptation_mode: null, genre: null, tone: null, rating: null, art_style: defaultArtStyle() },
    storyboard: { type: 'shot-board', default_panel_grid_size: 4 },
    providers: { image: providerDefaults(), video: providerDefaults(), audio: providerDefaults(), music: providerDefaults() },
    createdAt: null,
    updatedAt: null,
  }
}

function mergeObject(base, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return patch
  const output = { ...base }
  for (const [key, value] of Object.entries(patch)) output[key] = value && typeof value === 'object' && !Array.isArray(value) && base?.[key] && typeof base[key] === 'object' && !Array.isArray(base[key]) ? mergeObject(base[key], value) : value
  return output
}

function nullableString(value, field) {
  if (value !== null && (typeof value !== 'string' || !value.trim())) throw new Error(`${field} 必须是非空字符串或 null`)
}

function validateArtStyle(style, label = 'art_style') {
  if (!style || typeof style !== 'object' || Array.isArray(style)) throw new Error(`${label} 必须是对象`)
  for (const field of ['id', 'name', 'description', 'prompt']) if (typeof style[field] !== 'string' || !style[field].trim()) throw new Error(`${label}.${field} 必填`)
  const bible = style.visualBible
  if (!bible || typeof bible !== 'object' || Array.isArray(bible) || bible.version !== 1) throw new Error(`${label}.visualBible 必须是 v1 对象`)
  for (const field of ['palette', 'baseline', 'lighting', 'narrative_arc', 'motion_language', 'negative_constraints']) if (!(field in bible)) throw new Error(`${label}.visualBible.${field} 必填`)
}

export function validateProject(project) {
  // 旧版 v1 没有该字段时按默认开启，下一次写入会补齐配置。
  if (!Object.hasOwn(project, 'automation_mode')) project.automation_mode = true
  exactKeys(project, ['schema_version', 'key', 'title', 'automation_mode', 'description', 'format', 'languages', 'creative', 'storyboard', 'providers', 'createdAt', 'updatedAt'], 'project.json')
  if (project.schema_version !== 1) throw new Error('project.json schema_version 必须为 1')
  if (typeof project.automation_mode !== 'boolean') throw new Error('automation_mode 必须是布尔值')
  projectKey(project.key)
  if (typeof project.title !== 'string' || !project.title.trim()) throw new Error('project title 必填')
  nullableString(project.description, 'description')
  exactKeys(project.format, ['aspect_ratio', 'resolution', 'fps', 'episode_count', 'episode_duration_seconds'], 'project.format')
  if (project.format.aspect_ratio !== null && !ASPECT_RATIOS.has(project.format.aspect_ratio)) throw new Error('format.aspect_ratio 无效')
  if (project.format.resolution !== null && !/^\d+x\d+$/.test(project.format.resolution)) throw new Error('format.resolution 必须为 宽x高 格式')
  if (project.format.aspect_ratio !== null && project.format.resolution !== null) {
    const [width, height] = project.format.resolution.split('x').map(Number)
    const [ratioWidth, ratioHeight] = project.format.aspect_ratio.split(':').map(Number)
    if (Math.abs(width / height - ratioWidth / ratioHeight) / (ratioWidth / ratioHeight) > 0.03) throw new Error('format.resolution 必须与 format.aspect_ratio 一致')
  }
  for (const field of ['fps', 'episode_count', 'episode_duration_seconds']) if (project.format[field] !== null && (!Number.isInteger(project.format[field]) || project.format[field] <= 0)) throw new Error(`format.${field} 必须是正整数或 null`)
  exactKeys(project.languages, ['output', 'spoken', 'subtitle'], 'project.languages')
  for (const field of ['output', 'spoken', 'subtitle']) nullableString(project.languages[field], `languages.${field}`)
  exactKeys(project.creative, ['adaptation_mode', 'genre', 'tone', 'rating', 'art_style'], 'project.creative')
  if (project.creative.adaptation_mode !== null && !ADAPTATION_MODES.has(project.creative.adaptation_mode)) throw new Error('creative.adaptation_mode 无效')
  for (const field of ['genre', 'tone', 'rating']) nullableString(project.creative[field], `creative.${field}`)
  if (project.creative.art_style !== null) {
    validateArtStyle(project.creative.art_style, 'creative.art_style')
  }
  exactKeys(project.storyboard, ['type', 'default_panel_grid_size'], 'project.storyboard')
  if (project.storyboard.type !== null && !STORYBOARD_TYPES.has(project.storyboard.type)) throw new Error('storyboard.type 无效')
  if (project.storyboard.default_panel_grid_size !== null && (!Number.isInteger(project.storyboard.default_panel_grid_size) || project.storyboard.default_panel_grid_size < 1 || project.storyboard.default_panel_grid_size > 16)) throw new Error('storyboard.default_panel_grid_size 必须为 1–16 或 null')
  const providerModalities = Object.hasOwn(project.providers, 'music') ? ['image', 'video', 'audio', 'music'] : ['image', 'video', 'audio']
  exactKeys(project.providers, providerModalities, 'project.providers')
  for (const modality of providerModalities) {
    const config = project.providers[modality]
    const providerFields = Object.hasOwn(config, 'parameters') ? ['provider', 'model_or_workflow', 'prompt_profile', 'parameters'] : ['provider', 'model_or_workflow', 'prompt_profile']
    exactKeys(config, providerFields, `project.providers.${modality}`)
    nullableString(config.provider, `providers.${modality}.provider`); nullableString(config.model_or_workflow, `providers.${modality}.model_or_workflow`)
    if (config.parameters !== undefined && (!config.parameters || typeof config.parameters !== 'object' || Array.isArray(config.parameters))) throw new Error(`providers.${modality}.parameters 必须是对象`)
    if (config.model_or_workflow !== null && config.provider === null) throw new Error(`providers.${modality}.model_or_workflow 需要 provider`)
    if (config.provider !== null) {
      const registered = providerSetupCatalog().find((item) => item.key === config.provider)
      if (!registered) throw new Error(`providers.${modality}.provider 未注册：${config.provider}`)
      if (config.model_or_workflow !== null && !(registered.models?.[modality] || []).some((item) => item.id === config.model_or_workflow)) throw new Error(`providers.${modality}.model_or_workflow 不受 ${config.provider} 支持`)
      if (config.model_or_workflow !== null && config.parameters !== undefined) normalizeModelParameters(config.provider, config.model_or_workflow, config.parameters)
    }
    if (modality === 'video') {
      if (config.prompt_profile !== null && !PROMPT_PROFILES.has(config.prompt_profile)) throw new Error('providers.video.prompt_profile 无效')
    } else if (config.prompt_profile !== null) throw new Error(`providers.${modality}.prompt_profile 必须为 null`)
  }
  for (const field of ['createdAt', 'updatedAt']) if (typeof project[field] !== 'string' || !Number.isFinite(Date.parse(project[field]))) throw new Error(`project.${field} 必须是 ISO 时间`)
  rejectSecrets(project)
  return project
}

function validateEpisode(episode) {
  exactKeys(episode, ['key', 'order', 'title', 'logline', 'target_duration_seconds', 'status', 'createdAt', 'updatedAt'], 'episode.json')
  validateEpisodeKey(episode.key)
  const expectedOrder = Number(episode.key.slice(3))
  if (episode.order !== expectedOrder) throw new Error('episode order 必须与 ep-001 编号一致')
  if (typeof episode.title !== 'string' || !episode.title.trim()) throw new Error('episode title 必填')
  nullableString(episode.logline, 'episode.logline')
  if (episode.target_duration_seconds !== null && (!Number.isInteger(episode.target_duration_seconds) || episode.target_duration_seconds <= 0)) throw new Error('episode.target_duration_seconds 必须是正整数或 null')
  if (!['draft', 'approved', 'in-production', 'completed'].includes(episode.status)) throw new Error('episode.status 无效')
  for (const field of ['createdAt', 'updatedAt']) if (typeof episode[field] !== 'string' || !Number.isFinite(Date.parse(episode[field]))) throw new Error(`episode.${field} 必须是 ISO 时间`)
  rejectSecrets(episode)
  return episode
}

function rejectSecrets(value, path = '') {
  if (!value || typeof value !== 'object') return
  for (const [key, child] of Object.entries(value)) {
    const childPath = path ? `${path}.${key}` : key
    if (/(?:api[_-]?key|token|password|secret|authorization)/i.test(key)) throw new Error(`项目数据禁止包含密钥字段：${childPath}`)
    rejectSecrets(child, childPath)
  }
}

async function sha256(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

async function markVisualAssetsStale() {
  const path = resolve(root, '.short-drama/assets.json')
  if (!await exists(path)) return
  await withFileLock(path, async () => {
    const ledger = await readJson(path)
    const visual = new Set(['character', 'scene', 'prop', 'storyboard', 'video'])
    for (const asset of Object.values(ledger.assets || {})) {
      if (!visual.has(asset.type)) continue
      asset.staleVersionIds = [...new Set([...(asset.staleVersionIds || []), ...(asset.versions || []).map((version) => version.id)])]
      if (asset.staleVersionIds.includes(asset.selectedVersionId)) asset.selectedVersionId = null
      asset.updatedAt = new Date().toISOString()
    }
    await writeJson(path, ledger)
  })
}

function validateAssetPlan(document) {
  if (!document || typeof document !== 'object' || Array.isArray(document)) throw new Error('asset-plan 必须是对象')
  const required = ['episode_key', 'characters', 'scenes', 'props', 'unresolved']
  if (Object.keys(document).sort().join() !== required.sort().join()) throw new Error(`asset-plan 顶层字段必须且只能是：${required.join(', ')}`)
  if (typeof document.episode_key !== 'string' || !document.episode_key) throw new Error('asset-plan episode_key 必填')
  if (!Array.isArray(document.unresolved)) throw new Error('asset-plan unresolved[] 必填')
  const keys = new Set()
  for (const [group, type] of Object.entries(ASSET_TYPES)) {
    if (!Array.isArray(document[group])) throw new Error(`asset-plan ${group}[] 必填`)
    for (const item of document[group]) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error(`${group} 资产必须是对象`)
      exactKeys(item, ['key', 'type', 'name', 'evidence', 'visual_description', 'versions', 'derived_from', 'status', 'selected_version'], `${group} 资产`)
      safeKey(item.key, `${group}.key`)
      if (keys.has(item.key)) throw new Error(`asset key 重复：${item.key}`)
      keys.add(item.key)
      if (item.type !== type) throw new Error(`${item.key}.type 必须是 ${type}`)
      if (typeof item.name !== 'string' || !item.name.trim()) throw new Error(`${item.key}.name 必填`)
      if (!Array.isArray(item.evidence) || item.evidence.length === 0) throw new Error(`${item.key}.evidence[] 必填`)
      for (const [index, evidence] of item.evidence.entries()) {
        exactKeys(evidence, ['source', 'locator', 'quote'], `${item.key}.evidence[${index}]`)
        if (!['script', 'director-book', 'source-analysis'].includes(evidence.source) || ![evidence.locator, evidence.quote].every((value) => typeof value === 'string' && value.trim())) throw new Error(`${item.key}.evidence[${index}] 无效`)
      }
      if (typeof item.visual_description !== 'string' || !item.visual_description.trim()) throw new Error(`${item.key}.visual_description 必填`)
      if (!Array.isArray(item.versions) || item.versions.length === 0) throw new Error(`${item.key}.versions[] 必填`)
      const versionKeys = new Set()
      for (const [index, version] of item.versions.entries()) {
        exactKeys(version, ['key', 'label', 'trigger', 'evidence'], `${item.key}.versions[${index}]`)
        versionKey(version.key, `${item.key}.versions[${index}].key`)
        if (versionKeys.has(version.key)) throw new Error(`${item.key} 版本 key 重复：${version.key}`)
        versionKeys.add(version.key)
        if (![version.label, version.trigger, version.evidence].every((value) => typeof value === 'string' && value.trim())) throw new Error(`${item.key}.versions[${index}] 描述不完整`)
      }
      if (item.derived_from !== null) safeKey(item.derived_from, `${item.key}.derived_from`)
      if (!['planned', 'ready', 'blocked'].includes(item.status)) throw new Error(`${item.key}.status 无效`)
      if (item.selected_version !== null && (!versionKeys.has(versionKey(item.selected_version, `${item.key}.selected_version`)))) throw new Error(`${item.key}.selected_version 不在 versions[]`)
    }
  }
  for (const [index, unresolved] of document.unresolved.entries()) {
    exactKeys(unresolved, ['id', 'question', 'affects'], `asset-plan unresolved[${index}]`)
    safeKey(unresolved.id, `asset-plan unresolved[${index}].id`)
    if (typeof unresolved.question !== 'string' || !unresolved.question.trim() || !Array.isArray(unresolved.affects) || unresolved.affects.some((key) => { try { safeKey(key); return false } catch { return true } })) throw new Error(`asset-plan unresolved[${index}] 无效`)
  }
}

function exactKeys(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} 必须是对象`)
  if (Object.keys(value).sort().join() !== [...keys].sort().join()) throw new Error(`${label} 顶层字段必须且只能是：${keys.join(', ')}`)
}

function validatePromptRoute(value, label, allowUnresolved = false) {
  if (!PROMPT_PROFILES.has(value.prompt_profile)) {
    if (allowUnresolved && (value.prompt_profile === null || value.prompt_profile === undefined || value.prompt_profile === '')) return
    throw new Error(`${label}.prompt_profile 无效`)
  }
  if (typeof value.input_mode !== 'string' || !value.input_mode.trim()) {
    if (allowUnresolved) return
    throw new Error(`${label}.input_mode 必填`)
  }
  if (value.prompt_profile === 'h3' && !H3_MODES.has(value.input_mode)) throw new Error(`${label}.input_mode 与 H3 不匹配`)
  if (value.prompt_profile === 'seedance2' && !['first-last-frame', 'full-reference'].includes(value.input_mode)) throw new Error(`${label}.input_mode 与 Seedance 2.0 不匹配`)
}

export function validateVideoPrompts(document, episodeKey) {
  exactKeys(document, ['episode_key', 'source_versions', 'shots', 'unresolved', 'approved'], 'video-prompts')
  if (document.episode_key !== episodeKey) throw new Error('video-prompts episode_key 与目标分集不一致')
  if (!document.source_versions || typeof document.source_versions !== 'object' || Array.isArray(document.source_versions)) throw new Error('video-prompts source_versions 必须是对象')
  if (!Array.isArray(document.shots) || document.shots.length === 0) throw new Error('video-prompts shots[] 必填')
  if (!Array.isArray(document.unresolved) || typeof document.approved !== 'boolean') throw new Error('video-prompts approved/unresolved 无效')
  const shotNumbers = new Set()
  for (const shot of document.shots) {
    const required = ['shot_number', 'production_plan_version', 'storyboard_version', 'provider', 'model_or_workflow', 'prompt_profile', 'input_mode', 'prompt', 'duration', 'references', 'continuity', 'audio_policy', 'errors']
    for (const key of required) if (!(key in shot)) throw new Error(`video-prompts shot 缺少 ${key}`)
    if (shotNumbers.has(shot.shot_number)) throw new Error(`video-prompts shot_number 重复：${shot.shot_number}`)
    shotNumbers.add(shot.shot_number)
    validatePromptRoute(shot, `video-prompts shot ${shot.shot_number}`)
    if (!Array.isArray(shot.references) || !Array.isArray(shot.errors)) throw new Error(`video-prompts shot ${shot.shot_number} references/errors 必须是数组`)
    if (!shot.continuity || typeof shot.continuity !== 'object' || Array.isArray(shot.continuity) || !shot.audio_policy || typeof shot.audio_policy !== 'object' || Array.isArray(shot.audio_policy)) throw new Error(`video-prompts shot ${shot.shot_number} continuity/audio_policy 必须是对象`)
    if (!Number.isFinite(shot.duration) || shot.duration <= 0) throw new Error(`video-prompts shot ${shot.shot_number} duration 无效`)
    if (typeof shot.prompt !== 'string' || (!shot.prompt.trim() && shot.errors.length === 0)) throw new Error(`video-prompts shot ${shot.shot_number} prompt 为空且无错误`)
    if (shot.prompt_profile === 'seedance2' && (shot.duration < 4 || shot.duration > 15)) throw new Error(`video-prompts shot ${shot.shot_number} Seedance 2.0 时长必须为 4–15 秒`)
    if (shot.prompt_profile === 'seedance2' && shot.errors.length === 0) {
      const ranges = [...shot.prompt.matchAll(/\[(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)\s*(?:s|秒)\]/g)].map((match) => match.slice(1).map(Number))
      if (shot.duration >= 13 && ranges.length === 0) throw new Error(`video-prompts shot ${shot.shot_number} 13–15 秒提示词必须使用时间段`)
      if (ranges.length && (ranges[0][0] !== 0 || ranges.some(([start, end], index) => end <= start || (index > 0 && start !== ranges[index - 1][1])) || ranges.at(-1)[1] !== shot.duration)) throw new Error(`video-prompts shot ${shot.shot_number} 时间段必须从 0 连续覆盖完整时长`)
    }
    if (shot.prompt_profile === 'h3' && shot.errors.length === 0) {
      if (shot.duration < (shot.model_or_workflow === 'MiniMax-H3-Max' ? 5 : 4) || shot.duration > 15) throw new Error(`video-prompts shot ${shot.shot_number} MiniMax H3 时长无效`)
      if (shot.model_or_workflow === 'MiniMax-H3-Max' && shot.input_mode === 'Ref2VA') throw new Error(`video-prompts shot ${shot.shot_number} H3-Max 不支持 Ref2VA`)
      const sections = shot.input_mode === 'Ref2VA'
        ? ['subject_definitions:', 'summary:', 'retention_analysis:', 'detailed_description:', 'overall_soundscape:', 'non_diegetic_music:']
        : ['integrated_multimodal_description:', 'overall_soundscape:', 'non_diegetic_music:']
      const positions = sections.map((section) => shot.prompt.indexOf(section))
      if (positions.some((position) => position < 0) || positions.some((position, index) => index > 0 && position <= positions[index - 1])) throw new Error(`video-prompts shot ${shot.shot_number} H3 段落结构无效`)
      if (shot.provider === 'comfly' && (shot.model_or_workflow !== 'minimax-h3' || shot.input_mode !== 'Ref2VA' || shot.duration < 5)) throw new Error(`video-prompts shot ${shot.shot_number} 与 Comfly H3 合同不匹配`)
      if (shot.provider === 'runninghub' && shot.model_or_workflow === 'minimax-h3-reference-to-video' && shot.duration < 5) throw new Error(`video-prompts shot ${shot.shot_number} RunningHub H3 有效时长至少为 5 秒`)
    }
    // 固定反宫格声明：所有配置文件无错镜头必须原样包含（归一化匹配，标点空白不敏感）
    if (shot.errors.length === 0 && !hasAntiGridClaim(shot.prompt)) throw new Error(`video-prompts shot ${shot.shot_number} prompt 必须原样包含固定反宫格声明（见 write-drama-video-prompts 模板）`)
  }
  if (document.approved && (document.unresolved.length || document.shots.some((shot) => shot.errors.length))) throw new Error('video-prompts 存在未决项或错误时不得 approved')
}

function validateDocument(kind, document, episodeKey) {
  const contracts = {
    'source-analysis': ['source_scope', 'adaptation_mode', 'facts', 'timeline', 'characters', 'locations', 'props', 'conflicts', 'themes', 'visual_challenges', 'content_constraints', 'user_requirements', 'contradictions', 'open_questions', 'coverage'],
    brief: ['title', 'logline', 'adaptation_mode', 'genre', 'audience', 'platform', 'tone', 'core_conflict', 'output_language', 'spoken_language', 'subtitle_language', 'aspect_ratio', 'episode_count', 'episode_duration_seconds', 'rating', 'existing_materials', 'required_deliverables', 'prohibited_content', 'ending_type', 'creative_constraints', 'open_questions', 'approved'],
    bible: ['premise', 'genre', 'tone', 'themes', 'world_rules', 'ending', 'characters', 'relationships', 'three_act', 'conflict_ladder', 'promises_and_payoffs', 'foreshadowing', 'continuity_rules', 'adaptation_constraints', 'open_questions'],
    outline: ['episodes', 'coverage_check', 'continuity_check'],
    'script-review': ['episode_key', 'script_version', 'dimensions', 'issues', 'compliance', 'approved'],
    'director-book': ['episode_key', 'source_script_version', 'scenes', 'continuity_ledger', 'open_questions'],
    'production-plan': ['episode_key', 'source_versions', 'shots', 'totals', 'unresolved', 'approved'],
    'art-style': ['mode', 'style', 'decision_reason', 'approved'],
    'audio-plan': document.music_tracks === undefined ? ['episode_key', 'source_versions', 'lines', 'voice_bindings', 'unresolved', 'approved'] : ['episode_key', 'source_versions', 'lines', 'voice_bindings', 'music_tracks', 'unresolved', 'approved'],
  }
  if (contracts[kind]) exactKeys(document, contracts[kind], kind)
  if (kind === 'source-analysis' && !['original', 'faithful_adaptation', 'authorized_adaptation'].includes(document.adaptation_mode)) throw new Error('source-analysis adaptation_mode 无效')
  if (kind === 'source-analysis' && document.coverage?.complete !== true) throw new Error('source-analysis coverage.complete 必须为 true')
  if (kind === 'brief' && (typeof document.approved !== 'boolean' || !Array.isArray(document.open_questions))) throw new Error('brief approved/open_questions 无效')
  if (kind === 'bible') {
    if (!Array.isArray(document.characters)) throw new Error('bible characters[] 必填')
    const fields = ['name', 'dramatic_function', 'desire', 'need', 'fear', 'hidden_fact', 'arc_start', 'arc_turn', 'arc_end']
    document.characters.forEach((character, index) => {
      exactKeys(character, fields, `bible characters[${index}]`)
      if (fields.some((field) => typeof character[field] !== 'string')) throw new Error(`bible characters[${index}] 字段必须是字符串`)
    })
  }
  if (kind === 'art-style') {
    if (!['confirmed-default', 'custom'].includes(document.mode) || typeof document.decision_reason !== 'string' || !document.decision_reason.trim() || typeof document.approved !== 'boolean') throw new Error('art-style mode/decision_reason/approved 无效')
    validateArtStyle(document.style, 'art-style.style')
  }
  if (kind === 'audio-plan') {
    if (document.episode_key !== episodeKey || !document.source_versions || typeof document.source_versions !== 'object' || Array.isArray(document.source_versions) || !Array.isArray(document.lines) || !Array.isArray(document.voice_bindings) || !Array.isArray(document.unresolved) || typeof document.approved !== 'boolean') throw new Error('audio-plan 合同无效')
    document.lines.forEach((line, index) => {
      const fields = ['line_index', 'speaker', 'line_type', 'content', 'emotion', 'emotion_strength', 'pronunciation_notes', 'matched_shot']
      for (const field of fields) if (!(field in line)) throw new Error(`audio-plan lines[${index}] 缺少 ${field}`)
      if (line.line_index !== index + 1 || typeof line.speaker !== 'string' || !line.speaker || typeof line.content !== 'string' || !line.content || !Array.isArray(line.pronunciation_notes) || typeof line.emotion_strength !== 'number' || line.emotion_strength < 0.1 || line.emotion_strength > 0.5) throw new Error(`audio-plan lines[${index}] 无效`)
    })
    if (document.music_tracks !== undefined) {
      if (!Array.isArray(document.music_tracks)) throw new Error('audio-plan music_tracks 必须是数组')
      document.music_tracks.forEach((track, index) => {
        exactKeys(track, ['key', 'purpose', 'title', 'prompt', 'tags', 'lyrics', 'make_instrumental', 'provider', 'model', 'matched_shots'], `audio-plan music_tracks[${index}]`)
        if (!/^(?:op|ed|bgm|music-video)(?:-[a-z0-9]+)*$/.test(track.key) || !['op', 'ed', 'bgm', 'music-video'].includes(track.purpose)) throw new Error(`audio-plan music_tracks[${index}] key/purpose 无效`)
        for (const field of ['title', 'prompt', 'tags', 'provider', 'model']) if (typeof track[field] !== 'string' || !track[field].trim()) throw new Error(`audio-plan music_tracks[${index}].${field} 必填`)
        if (typeof track.lyrics !== 'string' || typeof track.make_instrumental !== 'boolean' || !Array.isArray(track.matched_shots) || track.matched_shots.some((shot) => !Number.isInteger(shot) || shot <= 0)) throw new Error(`audio-plan music_tracks[${index}] 内容无效`)
        if (track.make_instrumental && track.lyrics.trim()) throw new Error(`audio-plan music_tracks[${index}] 纯音乐不能包含歌词`)
      })
    }
    if (document.approved && document.unresolved.length) throw new Error('audio-plan 存在未决项时不得 approved')
  }
  if (kind === 'outline') {
    if (!Array.isArray(document.episodes) || document.episodes.length === 0) throw new Error('outline episodes[] 必填')
    document.episodes.forEach((episode, index) => {
      if (episode.key !== `ep-${String(index + 1).padStart(3, '0')}` || episode.order !== index + 1) throw new Error('outline episode key/order 必须连续')
    })
  }
  if (kind === 'script-review') {
    if (document.episode_key !== episodeKey) throw new Error('script-review episode_key 与目标分集不一致')
    versionKey(document.script_version, 'script-review script_version')
    if (!document.dimensions || typeof document.dimensions !== 'object' || Array.isArray(document.dimensions)) throw new Error('script-review dimensions 必须是对象')
    for (const dimension of ['opening', 'pace', 'payoff', 'dialogue', 'continuity', 'production_feasibility']) {
      if (!['passed', 'failed'].includes(document.dimensions[dimension]?.status)) throw new Error(`script-review ${dimension}.status 无效`)
      if (typeof document.dimensions[dimension]?.note !== 'string') throw new Error(`script-review ${dimension}.note 必须是字符串`)
    }
    if (!Array.isArray(document.issues) || !document.compliance || typeof document.compliance.passed !== 'boolean' || !Array.isArray(document.compliance.issues) || typeof document.approved !== 'boolean') throw new Error('script-review issues/compliance/approved 无效')
    for (const [index, issue] of document.issues.entries()) {
      for (const field of ['scene_or_line', 'severity', 'dimension', 'finding', 'required_change']) if (typeof issue?.[field] !== 'string' || !issue[field].trim()) throw new Error(`script-review issues[${index}].${field} 必填`)
      if (!['P0', 'P1', 'P2'].includes(issue.severity) || !['opening', 'pace', 'payoff', 'dialogue', 'continuity', 'production_feasibility', 'compliance'].includes(issue.dimension)) throw new Error(`script-review issues[${index}] 分类无效`)
    }
    if (document.approved && (document.compliance.passed !== true || Object.values(document.dimensions).some((item) => item.status !== 'passed') || document.issues.some((item) => ['P0', 'P1'].includes(item?.severity)))) throw new Error('script-review 存在阻断项时不得 approved')
  }
  if (['director-book', 'production-plan'].includes(kind)) {
    if (document.episode_key !== episodeKey) throw new Error(`${kind} episode_key 与目标分集不一致`)
    if (!Array.isArray(kind === 'director-book' ? document.scenes : document.shots) || (kind === 'director-book' ? document.scenes : document.shots).length === 0) throw new Error(`${kind} 内容数组必填且不得为空`)
  }
  if (kind === 'director-book') {
    versionKey(document.source_script_version, 'director-book source_script_version')
    if (!Array.isArray(document.continuity_ledger) || !Array.isArray(document.open_questions)) throw new Error('director-book continuity_ledger/open_questions 必须是数组')
    const fields = ['scene_key', 'source_scene', 'dramatic_objective', 'beats', 'subtext', 'performance_direction', 'blocking', 'eyelines', 'axis_rule', 'camera_strategy', 'lighting_and_color', 'sound_plan', 'transition_in', 'transition_out', 'continuity_state', 'asset_requirements', 'prohibited_changes']
    const sceneKeys = new Set()
    document.scenes.forEach((scene, index) => {
      for (const field of fields) if (!(field in scene)) throw new Error(`director-book scenes[${index}] 缺少 ${field}`)
      if (typeof scene.scene_key !== 'string' || !scene.scene_key || sceneKeys.has(scene.scene_key) || typeof scene.source_scene !== 'string' || !scene.source_scene.trim() || typeof scene.dramatic_objective !== 'string' || !scene.dramatic_objective.trim() || !Array.isArray(scene.beats) || scene.beats.length === 0 || !Array.isArray(scene.asset_requirements) || !Array.isArray(scene.prohibited_changes)) throw new Error(`director-book scenes[${index}] 场次合同无效`)
      sceneKeys.add(scene.scene_key)
    })
  }
  if (kind === 'production-plan' && (typeof document.approved !== 'boolean' || !Array.isArray(document.unresolved))) throw new Error('production-plan approved/unresolved 无效')
  if (kind === 'production-plan') {
    const fields = ['shot_number', 'dependencies', 'image_strategy', 'video_strategy', 'audio_strategy', 'provider', 'model_or_workflow', 'prompt_profile', 'input_mode', 'duration_seconds', 'resolution', 'aspect_ratio', 'candidate_count', 'reference_assets', 'estimated_paid_calls', 'fallback', 'review_checks', 'status']
    const numbers = new Set()
    document.shots.forEach((shot, index) => {
      for (const field of fields) if (!(field in shot)) throw new Error(`production-plan shots[${index}] 缺少 ${field}`)
      if (shot.shot_number !== index + 1 || numbers.has(shot.shot_number)) throw new Error(`production-plan shots[${index}].shot_number 必须从 1 连续递增`)
      numbers.add(shot.shot_number)
      for (const field of ['dependencies', 'reference_assets', 'review_checks']) if (!Array.isArray(shot[field])) throw new Error(`production-plan shots[${index}].${field} 必须是数组`)
      for (const field of ['image_strategy', 'video_strategy', 'audio_strategy']) if (!shot[field] || typeof shot[field] !== 'object' || Array.isArray(shot[field])) throw new Error(`production-plan shots[${index}].${field} 必须是对象`)
      for (const field of ['mode', 'board_type', 'panel_grid_size', 'overflow_strategy']) if (!(field in shot.image_strategy)) throw new Error(`production-plan shots[${index}].image_strategy 缺少 ${field}`)
      if (shot.image_strategy.mode !== 'generate') throw new Error(`production-plan shots[${index}].image_strategy.mode 必须为 generate`)
      if (!STORYBOARD_TYPES.has(shot.image_strategy.board_type ?? 'shot-board')) throw new Error(`production-plan shots[${index}].image_strategy.board_type 无效`)
      if (!Number.isInteger(shot.image_strategy.panel_grid_size) || shot.image_strategy.panel_grid_size < 1 || shot.image_strategy.panel_grid_size > 16 || (shot.image_strategy.board_type === 'single') !== (shot.image_strategy.panel_grid_size === 1)) throw new Error(`production-plan shots[${index}].image_strategy.panel_grid_size 与分镜类型不匹配`)
      if (!['compose-assets', 'reject'].includes(shot.image_strategy.overflow_strategy ?? 'compose-assets')) throw new Error(`production-plan shots[${index}].image_strategy.overflow_strategy 无效`)
      for (const field of ['provider', 'model_or_workflow', 'resolution', 'aspect_ratio']) if (typeof shot[field] !== 'string' || !shot[field]) throw new Error(`production-plan shots[${index}].${field} 必填`)
      if (!Number.isInteger(shot.duration_seconds) || shot.duration_seconds <= 0 || !Number.isInteger(shot.candidate_count) || shot.candidate_count <= 0 || !Number.isInteger(shot.estimated_paid_calls) || shot.estimated_paid_calls < 0) throw new Error(`production-plan shots[${index}] 数量或时长无效`)
      if (!['ready', 'blocked'].includes(shot.status)) throw new Error(`production-plan shots[${index}].status 无效`)
      validatePromptRoute(shot, `production-plan shots[${index}]`, document.approved === false && document.unresolved.length > 0)
      if (shot.provider === 'comfly' && (shot.model_or_workflow !== 'minimax-h3' || shot.input_mode !== 'Ref2VA' || shot.duration_seconds < 5)) throw new Error(`production-plan shots[${index}] 与 Comfly H3 合同不匹配`)
      if (shot.provider === 'runninghub' && shot.model_or_workflow === 'minimax-h3-reference-to-video' && shot.duration_seconds < 5) throw new Error(`production-plan shots[${index}] RunningHub H3 有效时长至少为 5 秒`)
    })
    if (document.approved && (document.unresolved.length || document.shots.some((shot) => shot.status !== 'ready'))) throw new Error('production-plan 存在未决项或阻塞镜头时不得 approved')
  }
  if (kind === 'storyboard') {
    exactKeys(document, ['episode_key', 'source_versions', 'panels'], 'storyboard')
    if (!document.source_versions || typeof document.source_versions !== 'object' || Array.isArray(document.source_versions) || Object.keys(document.source_versions).length === 0) throw new Error('storyboard source_versions 必须是非空对象')
    for (const [source, version] of Object.entries(document.source_versions)) versionKey(version, `storyboard source_versions.${source}`)
    if (!Array.isArray(document.panels) || document.panels.length === 0) throw new Error('storyboard panels[] 必填')
    const fields = ['panel_number', 'shot_number', 'description', 'characters', 'location', 'source_text', 'duration']
    for (const [index, panel] of document.panels.entries()) {
      for (const field of fields) if (!(field in panel)) throw new Error(`storyboard panels[${index}] 缺少 ${field}`)
      if (panel.shot_number !== panel.panel_number) throw new Error(`storyboard panels[${index}] shot_number 必须等于 panel_number`)
      if (!Array.isArray(panel.characters) || panel.characters.some((character) => !character || typeof character !== 'object' || Array.isArray(character) || typeof character.name !== 'string' || !character.name.trim())) throw new Error(`storyboard panels[${index}].characters 无效`)
      if (!Number.isInteger(panel.duration) || panel.duration <= 0 || typeof panel.description !== 'string' || !panel.description.trim() || typeof panel.location !== 'string' || !panel.location.trim() || typeof panel.source_text !== 'string' || !panel.source_text.trim()) throw new Error(`storyboard panels[${index}] 描述、场景、来源或时长无效`)
    }
    const numbers = document.panels.map((panel) => panel.panel_number)
    if (numbers.some((number, index) => number !== index + 1)) throw new Error('storyboard panel_number 必须从 1 连续递增')
    if (document.episode_key && document.episode_key !== episodeKey) throw new Error('storyboard episode_key 与目标分集不一致')
  }
  if (kind === 'video-prompts') validateVideoPrompts(document, episodeKey)
}

async function validateEpisodeDocument(kind, episodeKey, document) {
  validateDocument(kind, document, episodeKey)
  if (kind === 'asset-plan') {
    validateAssetPlan(document)
    if (document.episode_key !== episodeKey) throw new Error('asset-plan episode_key 与目标分集不一致')
  }
  if (kind !== 'video-prompts') return
  const ledger = await readJson(resolve(root, '.short-drama', 'assets.json'))
  for (const shot of document.shots) {
    await access(resolve(episodeRoot(episodeKey), 'production-plan', `${safeKey(shot.production_plan_version, 'production plan version')}.json`))
    await access(resolve(episodeRoot(episodeKey), 'storyboard', `${safeKey(shot.storyboard_version, 'storyboard version')}.json`))
    for (const type of ['image', 'video', 'audio']) {
      const references = shot.references.filter((item) => item?.type === type)
      if (references.some((item, index) => item.order !== index + 1)) throw new Error(`video-prompts shot ${shot.shot_number} ${type} 引用顺序无效`)
    }
    for (const reference of shot.references) {
      safeKey(reference.asset_key, 'reference asset key'); versionKey(reference.version_id, 'reference version id')
      if (typeof reference.role !== 'string' || !reference.role.trim()) throw new Error(`video-prompts shot ${shot.shot_number} 引用用途必填`)
      const asset = ledger.assets?.[reference.asset_key]
      const version = asset?.versions?.find((item) => item.id === reference.version_id)
      if (!version || asset.selectedVersionId !== reference.version_id) throw new Error(`video-prompts shot ${shot.shot_number} 引用必须是已选本地版本：${reference.asset_key}@${reference.version_id}`)
      await access(resolve(root, version.localPath))
    }
  }
}

async function readJson(path) { return JSON.parse(await readFile(path, 'utf8')) }

async function writeJson(path, value, exclusive = false) {
  rejectSecrets(value)
  await mkdir(dirname(path), { recursive: true })
  const content = `${JSON.stringify(value, null, 2)}\n`
  if (exclusive) return writeFile(path, content, { flag: 'wx' })
  const temporary = `${path}.${randomUUID()}.tmp`
  await writeFile(temporary, content, { flag: 'wx' })
  await rename(temporary, path)
}

async function writeText(path, content, exclusive = false) {
  await mkdir(dirname(path), { recursive: true })
  if (exclusive) return writeFile(path, content, { flag: 'wx' })
  const temporary = `${path}.${randomUUID()}.tmp`
  await writeFile(temporary, content, { flag: 'wx' })
  await rename(temporary, path)
}

function episodeRoot(key) { return resolve(root, 'episodes', validateEpisodeKey(key)) }

async function main() {
  const command = process.argv[2]
  if (command === '--self-check') {
    if (safeKey('ep-001') !== 'ep-001') throw new Error('key 自检失败')
    versionKey('v001')
    const now = new Date().toISOString()
    validateProject({ ...projectDefaults('short-drama', '短剧'), createdAt: now, updatedAt: now })
    if (projectDefaults('short-drama', '短剧').automation_mode !== true) throw new Error('全自动化默认值自检失败')
    try {
      validateProject({ ...projectDefaults('short-drama', '短剧'), format: { aspect_ratio: '16:9', resolution: '1080x1920', fps: 24, episode_count: 1, episode_duration_seconds: 60 }, createdAt: now, updatedAt: now })
      throw new Error('画幅与分辨率一致性自检失败')
    } catch (error) { if (!String(error.message).includes('必须与 format.aspect_ratio 一致')) throw error }
    try {
      validateProject({ ...projectDefaults('short-drama', '短剧'), providers: { ...projectDefaults('short-drama', '短剧').providers, video: { provider: 'comfly', model_or_workflow: 'minimax-h3', prompt_profile: 'h3', parameters: { duration: 8, resolution: '1K', ratio: '16:9', generate_audio: true } } }, createdAt: now, updatedAt: now })
      throw new Error('Provider 参数枚举自检失败')
    } catch (error) { if (!String(error.message).includes('模型参数不受支持')) throw error }
    try { safeKey('../bad'); throw new Error('路径自检失败') } catch (error) { if (!String(error.message).includes('无效')) throw error }
    const assetPlan = { episode_key: 'ep-001', characters: [{ key: 'char-a', type: 'character', name: 'A', evidence: [{ source: 'script', locator: 'scene-001', quote: 'A 入场' }], visual_description: '外观未知，待确认', versions: [{ key: 'v001', label: '基础造型', trigger: '首次出场', evidence: 'scene-001' }], derived_from: null, status: 'planned', selected_version: null }], scenes: [], props: [], unresolved: [] }
    validateAssetPlan(assetPlan)
    try { validateAssetPlan({ ...assetPlan, characters: [{ ...assetPlan.characters[0], evidence: [{}] }] }); throw new Error('资产证据自检失败') } catch (error) { if (!String(error.message).includes('顶层字段')) throw error }
    validateDocument('outline', { episodes: [{ key: 'ep-001', order: 1 }], coverage_check: {}, continuity_check: {} })
    validateDocument('audio-plan', { episode_key: 'ep-001', source_versions: {}, lines: [], voice_bindings: [], music_tracks: [{ key: 'op', purpose: 'op', title: '片头曲', prompt: '紧张悬疑电子乐', tags: 'cinematic,electronic', lyrics: '', make_instrumental: true, provider: 'starrouter', model: 'suno_music', matched_shots: [1] }], unresolved: [], approved: true }, 'ep-001')
    validateVideoPrompts({ episode_key: 'ep-001', source_versions: {}, unresolved: [], approved: true, shots: [{ shot_number: 1, production_plan_version: 'v001', storyboard_version: 'v001', provider: 'runninghub', model_or_workflow: 'minimax-h3-reference-to-video', prompt_profile: 'h3', input_mode: 'Ref2VA', prompt: `subject_definitions:\nA\nsummary:\nA\nretention_analysis:\nA\ndetailed_description:\n${ANTI_GRID_CLAIM_EN}\nA\n${ANTI_GRID_CLAIM_EN}\noverall_soundscape:\nA\nnon_diegetic_music:\nN/A`, duration: 5, references: [], continuity: {}, audio_policy: {}, errors: [] }] }, 'ep-001')
    const seedance = { episode_key: 'ep-001', source_versions: {}, unresolved: [], approved: true, shots: [{ shot_number: 1, production_plan_version: 'v001', storyboard_version: 'v001', provider: 'starrouter', model_or_workflow: 'dreamina-seedance-2-0-260128', prompt_profile: 'seedance2', input_mode: 'first-last-frame', prompt: `${ANTI_GRID_CLAIM_ZH}\n[0–5s] 人物走到门口。[5–15s] 人物停下并回头。\n${ANTI_GRID_CLAIM_ZH}`, duration: 15, references: [], continuity: {}, audio_policy: {}, errors: [] }] }
    validateVideoPrompts(seedance, 'ep-001')
    try { validateVideoPrompts({ ...seedance, shots: [{ ...seedance.shots[0], prompt: '[1–8s] 人物走动。[9–15s] 人物停下。' }] }, 'ep-001'); throw new Error('时间段自检失败') } catch (error) { if (!String(error.message).includes('从 0 连续覆盖')) throw error }
    try { validateVideoPrompts({ ...seedance, shots: [{ ...seedance.shots[0], prompt: '[0–15s] 连续画面，不要分屏。' }] }, 'ep-001'); throw new Error('反宫格声明自检失败') } catch (error) { if (!String(error.message).includes('反宫格声明')) throw error }
    return console.log('ok')
  }
  if (command === 'init') {
    const metadataPath = process.argv[4]
    const metadata = metadataPath
      ? await readJson(resolve(metadataPath))
      : { key: defaultKey(basename(root)), title: basename(root) || 'short-drama' }
    const key = projectKey(metadata.key || defaultKey(basename(root)))
    const title = typeof metadata.title === 'string' && metadata.title.trim() ? metadata.title.trim() : basename(root) || 'short-drama'
    // 初始化必须是一次性操作；任一项目账本已存在都禁止继续写，避免半初始化时覆盖或混写状态。
    for (const path of [
      resolve(root, '.short-drama/project.json'),
      resolve(root, '.short-drama/state.json'),
      resolve(root, '.short-drama/skill-runs.json'),
      resolve(root, '.short-drama/assets.json'),
      resolve(root, '.short-drama/tasks.json'),
      resolve(root, '.short-drama/shot-reviews.json'),
      resolve(root, 'source/manifest.json'),
    ]) {
      try { await access(path); throw new Error(`项目已存在：${root}`) } catch (error) { if (error?.code !== 'ENOENT') throw error }
    }
    for (const directory of ['source', 'episodes', 'assets/characters', 'assets/scenes', 'assets/props', 'assets/storyboards', 'assets/audio', 'assets/videos', 'assets/other', 'editing', 'delivery', '.short-drama/requests', '.short-drama/prompt-runs', '.short-drama/evidence', '.short-drama/uploads', '.short-drama/environment']) {
      await mkdir(resolve(root, directory), { recursive: true })
    }
    const now = new Date().toISOString()
    const project = mergeObject(projectDefaults(key, title), { ...metadata, key, title, createdAt: now, updatedAt: now })
    validateProject(project)
    await writeJson(resolve(root, '.short-drama/project.json'), project, true)
    await writeJson(resolve(root, '.short-drama/state.json'), { version: 1, stage: stages[0], completed: [], invalidatedAt: {}, updatedAt: now }, true)
    await writeJson(resolve(root, '.short-drama/skill-runs.json'), { version: 1, runs: {} }, true)
    await writeJson(resolve(root, '.short-drama/assets.json'), { version: 1, assets: {} }, true)
    await writeJson(resolve(root, '.short-drama/tasks.json'), { version: 1, tasks: {} }, true)
    await writeJson(resolve(root, '.short-drama/shot-reviews.json'), { version: 1, reviews: {} }, true)
    await writeJson(resolve(root, 'source/manifest.json'), { version: 1, sources: {} }, true)
    await runPreflight(root, 'init')
    await writeText(resolve(root, '.short-drama/RESUME.md'), '# 短剧项目恢复入口\n\n每次新会话先读取 `project.json`、`state.json`、`skill-runs.json`、`environment.json` 与 `source/manifest.json`，再运行插件的 `validate-project.mjs`、`workflow.mjs status` 和 `skill-runs.mjs required`。读取 `project.json` 的 `automation_mode`：默认开启时由 agent 自行处理常规确认，关闭时逐项等待用户；任何模式都不得绕过阶段门禁、权限事实或安全校验。只执行当前阶段返回的原子 Skill；文本由 Codex 生成，媒体才调用 Provider。提示词渲染记录在 `prompt-runs/`，媒体调用记录在 `requests/`，临时公开参考图记录在 `uploads/`；先查询有效收据，不能直接重复上传。\n', true)
    try {
      await writeText(resolve(root, 'AGENTS.md'), '# 本地短剧项目\n\n本目录由 `oh-my-short-drama` 管理。开始或恢复制作时，必须先读取 `.short-drama/RESUME.md`、`.short-drama/project.json` 和 `.short-drama/state.json`。`project.json` 的 `automation_mode` 默认为 `true`；开启时 agent 自主处理常规确认，关闭时等待用户确认。任何模式都不得跳过 Skill 凭证、版本、选版、权限事实和验收门禁。\n', true)
    } catch (error) { if (error?.code !== 'EEXIST') throw error }
    if (dirname(root) === DEFAULT_WORKSPACE_ROOT && process.env.SHORT_DRAMA_STUDIO_ACTIVE !== '1') try { await openStudio() } catch (error) { console.warn(error.message) }
    return console.log(root)
  }
  if (command === 'project') return console.log(JSON.stringify(validateProject(await readJson(resolve(root, '.short-drama/project.json'))), null, 2))
  if (command === 'validate-project-config') {
    validateProject(await readJson(resolve(root, '.short-drama/project.json')))
    return console.log(JSON.stringify({ valid: true, schema_version: 1 }))
  }
  if (command === 'migrate-project-config') {
    const path = resolve(root, '.short-drama/project.json')
    const current = await readJson(path)
    if (current.schema_version === 1) { validateProject(current); return console.log(JSON.stringify(current, null, 2)) }
    const now = new Date().toISOString()
    const provider = (modality) => {
      const value = current.providers?.[modality] || {}
      return { provider: value.provider ?? null, model_or_workflow: value.model_or_workflow ?? value.model ?? value.workflowId ?? null, prompt_profile: modality === 'video' ? value.prompt_profile ?? value.promptProfile ?? null : null }
    }
    const migrated = mergeObject(projectDefaults(projectKey(current.key), current.title), {
      description: current.description ?? null,
      format: { aspect_ratio: current.aspectRatio ?? current.aspect_ratio ?? null, resolution: current.resolution ?? null, fps: current.fps ?? null, episode_count: current.episodeCount ?? null, episode_duration_seconds: current.episodeDurationSeconds ?? null },
      languages: { output: current.outputLanguage ?? null, spoken: current.spokenLanguage ?? null, subtitle: current.subtitleLanguage ?? null },
      creative: { adaptation_mode: current.adaptationMode ?? null, genre: current.genre ?? null, tone: current.tone ?? null, rating: current.rating ?? null, art_style: current.artStyle ?? null },
      storyboard: { type: current.storyboardType ?? null, default_panel_grid_size: current.defaultPanelGridSize ?? null },
      providers: { image: provider('image'), video: provider('video'), audio: provider('audio') },
      createdAt: current.createdAt || now,
      updatedAt: now,
    })
    validateProject(migrated)
    await writeJson(resolve(root, '.short-drama', `project.legacy.${now.replace(/[:.]/g, '-')}.json`), current, true)
    await writeJson(path, migrated)
    return console.log(JSON.stringify(migrated, null, 2))
  }
  if (command === 'migrate-project-layout') {
    const episodeKey = process.argv[4] || 'ep-001'
    validateEpisodeKey(episodeKey)
    await readJson(resolve(episodeRoot(episodeKey), 'episode.json'))
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const pairs = [
      ['editing/timeline.json', `editing/${episodeKey}/timeline.json`],
      ['editing/review.json', `editing/${episodeKey}/review.json`],
      ['delivery/final.mp4', `delivery/${episodeKey}/final.mp4`],
      ['delivery/final.srt', `delivery/${episodeKey}/final.srt`],
      ['delivery/final.ass', `delivery/${episodeKey}/final.ass`],
      ['delivery/manifest.json', `delivery/${episodeKey}/manifest.legacy.${timestamp}.json`],
    ]
    const moves = []
    for (const [from, to] of pairs) {
      if (!await exists(resolve(root, from))) continue
      if (await exists(resolve(root, to))) throw new Error(`迁移目标已存在：${to}`)
      moves.push([from, to])
    }
    if (!moves.length) return console.log(JSON.stringify({ migrated: [] }))
    await invalidateFrom(root, 'editing')
    for (const [from, to] of moves) {
      await mkdir(dirname(resolve(root, to)), { recursive: true })
      await rename(resolve(root, from), resolve(root, to))
    }
    return console.log(JSON.stringify({ migrated: moves.map(([from, to]) => ({ from, to })), regenerate_manifest: moves.some(([from]) => from === 'delivery/manifest.json') }, null, 2))
  }
  if (command === 'update-project') {
    const patchPath = process.argv[4]
    if (!patchPath) throw new Error('用法：update-project <项目目录> <更新 JSON>')
    const current = await readJson(resolve(root, '.short-drama/project.json'))
    const update = await readJson(resolve(patchPath))
    if (update.key && update.key !== current.key) throw new Error('project key 不可变')
    if ('schema_version' in update && update.schema_version !== current.schema_version) throw new Error('schema_version 不可直接修改')
    if ('createdAt' in update) throw new Error('createdAt 不可修改')
    const next = mergeObject(validateProject(current), { ...update, key: current.key, schema_version: current.schema_version, createdAt: current.createdAt, updatedAt: new Date().toISOString() })
    for (const modality of ['image', 'video', 'audio', 'music']) if (Object.hasOwn(update.providers?.[modality] || {}, 'parameters')) next.providers[modality].parameters = update.providers[modality].parameters
    validateProject(next)
    const keys = Object.keys(update).filter((key) => key !== 'updatedAt')
    const changedKeys = keys.filter((key) => JSON.stringify(current[key]) !== JSON.stringify(next[key]))
    const artStyleChanged = JSON.stringify(current.creative.art_style) !== JSON.stringify(next.creative.art_style)
    const automationOnly = changedKeys.length > 0 && changedKeys.every((key) => key === 'automation_mode')
    const invalidationStage = changedKeys.every((key) => key === 'providers') ? 'production-plan' : changedKeys.every((key) => key === 'creative') && Object.keys(update.creative || {}).every((key) => key === 'art_style') ? 'asset-analysis' : 'analysis'
    if (changedKeys.length > 0 && !automationOnly) await invalidateFrom(root, invalidationStage)
    if (artStyleChanged) await markVisualAssetsStale()
    if (artStyleChanged && next.creative.art_style) await saveCustomArtStyle(next.creative.art_style, dirname(root))
    await writeJson(resolve(root, '.short-drama/project.json'), next)
    const skillRunsPath = resolve(root, '.short-drama/skill-runs.json')
    if (await exists(skillRunsPath)) {
      // 项目配置由本命令完成授权写入，立即刷新管理 Skill 自身证据；下游证据仍由失效阶段门禁重新要求。
      const skillRuns = await readJson(skillRunsPath)
      const manageRun = skillRuns.runs?.['analysis:manage-drama-projects']
      if (manageRun?.evidence?.includes('.short-drama/project.json')) {
        manageRun.evidenceSha256['.short-drama/project.json'] = await sha256(resolve(root, '.short-drama/project.json'))
        manageRun.completedAt = new Date().toISOString()
        await writeJson(skillRunsPath, skillRuns)
      }
    }
    return console.log(JSON.stringify(next, null, 2))
  }
  if (command === 'put-source') {
    const [sourceKey, versionId, inputPath] = process.argv.slice(4)
    if (typeof sourceKey !== 'string' || !/^src-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(sourceKey)) throw new Error('source key 必须为 src-xxx 格式')
    versionKey(versionId, 'source version')
    if (!inputPath) throw new Error('用法：put-source <项目目录> <source key> <version> <来源文件>')
    const input = resolve(inputPath)
    const extension = extname(input).toLowerCase()
    if (!['.txt', '.md', '.json', '.pdf', '.docx', '.epub'].includes(extension)) throw new Error('来源文件仅支持 txt、md、json、pdf、docx、epub')
    if (!(await stat(input)).isFile()) throw new Error('来源文件无效')
    const manifestPath = resolve(root, 'source/manifest.json')
    return withFileLock(manifestPath, async () => {
      const manifest = await readJson(manifestPath)
      const source = manifest.sources[sourceKey] || { key: sourceKey, versions: [], selectedVersionId: null }
      if (source.versions.some((item) => item.id === versionId)) throw new Error(`来源版本已存在：${sourceKey}@${versionId}`)
      const target = resolve(root, 'source', sourceKey, `${versionId}${extension}`)
      await mkdir(dirname(target), { recursive: true })
      await copyFile(input, target, COPYFILE_EXCL)
      const info = await stat(target)
      source.versions.push({ id: versionId, localPath: `source/${sourceKey}/${versionId}${extension}`, sizeBytes: info.size, sha256: await sha256(target), createdAt: new Date().toISOString() })
      manifest.sources[sourceKey] = source
      await writeJson(manifestPath, manifest)
      console.log(JSON.stringify(source.versions.at(-1), null, 2))
    })
  }
  if (command === 'select-source') {
    const [sourceKey, versionId] = process.argv.slice(4)
    if (typeof sourceKey !== 'string' || !/^src-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(sourceKey)) throw new Error('source key 必须为 src-xxx 格式')
    versionKey(versionId, 'source version')
    const manifestPath = resolve(root, 'source/manifest.json')
    return withFileLock(manifestPath, async () => {
      const manifest = await readJson(manifestPath)
      const source = manifest.sources[sourceKey]
      const version = source?.versions?.find((item) => item.id === versionId)
      if (!version) throw new Error(`来源版本不存在：${sourceKey}@${versionId}`)
      await access(resolve(root, version.localPath))
      await invalidateFrom(root, 'analysis')
      source.selectedVersionId = versionId
      source.selectedAt = new Date().toISOString()
      await writeJson(manifestPath, manifest)
      console.log(JSON.stringify(source, null, 2))
    })
  }
  if (command === 'put-document') {
    const [kind, inputPath] = process.argv.slice(4)
    if (!['source-analysis', 'brief', 'bible', 'outline', 'art-style'].includes(kind) || !inputPath) throw new Error('用法：put-document <项目目录> <source-analysis|brief|bible|outline|art-style> <JSON>')
    const document = await readJson(resolve(inputPath))
    validateDocument(kind, document)
    await invalidateFrom(root, kind === 'art-style' ? 'asset-analysis' : 'analysis')
    await writeJson(resolve(root, '.short-drama', `${kind}.json`), document)
    return console.log(kind)
  }
  if (command === 'put-episode') {
    const inputPath = process.argv[4]
    if (!inputPath) throw new Error('用法：put-episode <项目目录> <分集 JSON>')
    const input = await readJson(resolve(inputPath))
    const allowed = new Set(['key', 'order', 'title', 'logline', 'target_duration_seconds', 'status'])
    for (const key of Object.keys(input)) if (!allowed.has(key)) throw new Error(`episode 输入字段无效：${key}`)
    validateEpisodeKey(input.key)
    const now = new Date().toISOString()
    const episode = { key: input.key, order: input.order ?? Number(input.key.slice(3)), title: input.title, logline: input.logline ?? null, target_duration_seconds: input.target_duration_seconds ?? null, status: input.status ?? 'draft', createdAt: now, updatedAt: now }
    validateEpisode(episode)
    await invalidateFrom(root, 'script')
    await Promise.all(['editing', 'delivery'].map((area) => mkdir(resolve(root, area, episode.key), { recursive: true })))
    await writeJson(resolve(episodeRoot(episode.key), 'episode.json'), episode, true)
    return console.log(episode.key)
  }
  if (command === 'update-episode') {
    const [episodeKey, patchPath] = process.argv.slice(4)
    validateEpisodeKey(episodeKey)
    if (!patchPath) throw new Error('用法：update-episode <项目目录> <episode key> <更新 JSON>')
    const target = resolve(episodeRoot(episodeKey), 'episode.json')
    const current = await readJson(target)
    const update = await readJson(resolve(patchPath))
    if (update.key && update.key !== episodeKey) throw new Error('episode key 不可变')
    const next = { ...current, ...update, key: episodeKey, createdAt: current.createdAt, updatedAt: new Date().toISOString() }
    validateEpisode(next)
    await invalidateFrom(root, 'script')
    await writeJson(target, next)
    return console.log(JSON.stringify(next, null, 2))
  }
  if (command === 'list-episodes') {
    const directory = resolve(root, 'episodes')
    const entries = await readdir(directory, { withFileTypes: true })
    const episodes = []
    for (const entry of entries.filter((item) => item.isDirectory())) episodes.push(validateEpisode(await readJson(resolve(directory, entry.name, 'episode.json'))))
    return console.log(JSON.stringify(episodes.sort((a, b) => (a.order ?? 0) - (b.order ?? 0)), null, 2))
  }
  if (command === 'put-episode-document') {
    const [kind, episodeKey, versionId, inputPath, ...flags] = process.argv.slice(4)
    if (!EPISODE_DOCUMENTS.has(kind)) throw new Error('episode document 类型无效')
    validateEpisodeKey(episodeKey); versionKey(versionId, `${kind} version`)
    if (!inputPath) throw new Error('用法：put-episode-document <项目目录> <script-review|director-book|asset-plan|production-plan|storyboard|video-prompts|audio-plan> <episode key> <version> <JSON>')
    await readJson(resolve(episodeRoot(episodeKey), 'episode.json'))
    const document = await readJson(resolve(inputPath))
    await validateEpisodeDocument(kind, episodeKey, document)
    await writeJson(resolve(episodeRoot(episodeKey), kind, `${versionId}.json`), document, true)
    if (flags.includes('--select')) {
      const invalidationStage = { 'script-review': 'script', 'director-book': 'director-book', 'asset-plan': 'asset-analysis', storyboard: 'production-plan', 'production-plan': 'production-plan', 'video-prompts': 'media-production', 'audio-plan': 'media-production' }[kind]
      await invalidateFrom(root, invalidationStage)
      await writeJson(resolve(episodeRoot(episodeKey), kind, 'selected.json'), { versionId, path: `episodes/${episodeKey}/${kind}/${versionId}.json`, selectedAt: new Date().toISOString() })
    }
    return console.log(flags.includes('--select') ? `${versionId} selected` : versionId)
  }
  if (command === 'validate-episode-document') {
    const [kind, episodeKey, inputPath] = process.argv.slice(4)
    if (!EPISODE_DOCUMENTS.has(kind) || !inputPath) throw new Error('用法：validate-episode-document <项目目录> <类型> <episode key> <JSON>')
    validateEpisodeKey(episodeKey)
    const document = await readJson(resolve(inputPath))
    await validateEpisodeDocument(kind, episodeKey, document)
    return console.log('ok')
  }
  if (command === 'put-script') {
    const [episodeKey, versionId, inputPath] = process.argv.slice(4)
    validateEpisodeKey(episodeKey); versionKey(versionId, 'script version')
    if (!inputPath) throw new Error('用法：put-script <项目目录> <episode key> <version> <剧本文件>')
    await readJson(resolve(episodeRoot(episodeKey), 'episode.json'))
    const extension = extname(inputPath).toLowerCase()
    if (!['.json', '.md', '.txt'].includes(extension)) throw new Error('剧本文件仅支持 JSON、Markdown 或纯文本')
    const content = await readFile(resolve(inputPath), 'utf8')
    if (extension === '.json') rejectSecrets(JSON.parse(content))
    await writeText(resolve(episodeRoot(episodeKey), 'scripts', `${versionId}${extension}`), content, true)
    return console.log(versionId)
  }
  if (command === 'select-script') {
    const [episodeKey, versionId, extension = '.json'] = process.argv.slice(4)
    validateEpisodeKey(episodeKey); versionKey(versionId, 'script version')
    if (!['.json', '.md', '.txt'].includes(extension)) throw new Error('剧本扩展名无效')
    await access(resolve(episodeRoot(episodeKey), 'scripts', `${versionId}${extension}`))
    await invalidateFrom(root, 'script')
    const selected = { versionId, path: `episodes/${episodeKey}/scripts/${versionId}${extension}`, selectedAt: new Date().toISOString() }
    await writeJson(resolve(episodeRoot(episodeKey), 'scripts', 'selected.json'), selected)
    return console.log(JSON.stringify(selected, null, 2))
  }
  if (command === 'script') {
    const [episodeKey, requestedVersion, requestedExtension = '.json'] = process.argv.slice(4)
    validateEpisodeKey(episodeKey)
    if (requestedVersion) {
      versionKey(requestedVersion, 'script version')
      if (!['.json', '.md', '.txt'].includes(requestedExtension)) throw new Error('剧本扩展名无效')
      return process.stdout.write(await readFile(resolve(episodeRoot(episodeKey), 'scripts', `${requestedVersion}${requestedExtension}`), 'utf8'))
    }
    const selected = await readJson(resolve(episodeRoot(episodeKey), 'scripts', 'selected.json'))
    return process.stdout.write(await readFile(resolve(root, selected.path), 'utf8'))
  }
  if (command === 'select-episode-document') {
    const [kind, episodeKey, versionId] = process.argv.slice(4)
    if (!EPISODE_DOCUMENTS.has(kind)) throw new Error('episode document 类型无效')
    validateEpisodeKey(episodeKey); versionKey(versionId, `${kind} version`)
    const document = await readJson(resolve(episodeRoot(episodeKey), kind, `${versionId}.json`))
    await validateEpisodeDocument(kind, episodeKey, document)
    const invalidationStage = { 'script-review': 'script', 'director-book': 'director-book', 'asset-plan': 'asset-analysis', storyboard: 'production-plan', 'production-plan': 'production-plan', 'video-prompts': 'media-production', 'audio-plan': 'media-production' }[kind]
    const marker = resolve(episodeRoot(episodeKey), kind, 'selected.json')
    if (['storyboard', 'production-plan', 'video-prompts'].includes(kind) && await exists(marker)) {
      const previousSelection = await readJson(marker)
      const previous = await readJson(resolve(root, previousSelection.path))
      const changed = changedShotNumbers(kind, previous, document)
      for (const shotNumber of changed) await invalidateShot(root, episodeKey, shotNumber, invalidationStage)
      if (changed.length) await invalidateShotAssets(root, episodeKey, changed, kind)
    } else await invalidateFrom(root, invalidationStage)
    const selected = { versionId, path: `episodes/${episodeKey}/${kind}/${versionId}.json`, selectedAt: new Date().toISOString() }
    await writeJson(resolve(episodeRoot(episodeKey), kind, 'selected.json'), selected)
    return console.log(JSON.stringify(selected, null, 2))
  }
  if (command === 'episode-document') {
    const [kind, episodeKey, requestedVersion] = process.argv.slice(4)
    if (!EPISODE_DOCUMENTS.has(kind)) throw new Error('episode document 类型无效')
    validateEpisodeKey(episodeKey)
    const versionId = requestedVersion || (await readJson(resolve(episodeRoot(episodeKey), kind, 'selected.json'))).versionId
    versionKey(versionId, `${kind} version`)
    return console.log(JSON.stringify(await readJson(resolve(episodeRoot(episodeKey), kind, `${versionId}.json`)), null, 2))
  }
  throw new Error('用法：project-store.mjs init|project|validate-project-config|migrate-project-config|update-project|put-source|select-source|put-document|put-episode|update-episode|list-episodes|put-script|select-script|script|put-episode-document|validate-episode-document|select-episode-document|episode-document ...')
}

if (resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) main().catch((error) => { console.error(error.message); process.exitCode = 1 })
