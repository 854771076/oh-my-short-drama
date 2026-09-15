#!/usr/bin/env node
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { call as callGeneration, tools as generationTools } from './generation/mcp.mjs'
import { selfCheck as checkComfly } from './generation/comfly.mjs'
import { selfCheck as checkRunningHub } from './generation/runninghub.mjs'
import { selfCheck as checkStarRouter } from './generation/starrouter.mjs'
import { selfCheck as checkProviders } from './generation/providers.mjs'
import { selfCheck as checkLitterbox } from './media-hosting/litterbox.mjs'
import { selfCheck as checkBailian } from './generation/bailian.mjs'
import { listReferenceUploads, publishReferenceImage, selfCheck as checkPublish, validateTemporaryReferenceUrl } from './media-hosting/publish.mjs'
import { validateVideoReferenceBindings } from './reference-bindings.mjs'
import { ANTI_GRID_CLAIM_ZH, PANEL_BOARD_CLAIM_ZH } from './grid-detect.mjs'
import { missingPrevizAssets, missingStoryboardAssets } from './workflow-gates.mjs'

const plugin = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const skillMap = JSON.parse(await readFile(resolve(plugin, 'references/skill-map.json'), 'utf8'))
const providerPrompts = new Set(skillMap.provider_prompts || [])
function run(script, ...args) {
  const result = spawnSync(process.execPath, [resolve(plugin, 'scripts', script), ...args], { encoding: 'utf8' })
  if (result.status !== 0) throw new Error(`${script} 失败：${result.stderr || result.stdout}`)
  return result.stdout
}

function runTest(path) {
  const result = spawnSync(process.execPath, ['--test', resolve(plugin, path)], { encoding: 'utf8' })
  if (result.status !== 0) throw new Error(`${path} 失败：${result.stderr || result.stdout}`)
}

function runAsync(script, ...args) {
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, [resolve(plugin, 'scripts', script), ...args], { stdio: ['ignore', 'pipe', 'pipe'] })
    let stderr = ''
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('error', fail)
    child.on('close', (code) => code === 0 ? done() : fail(new Error(`${script} 失败：${stderr}`)))
  })
}

async function json(root, name, value) {
  const path = resolve(root, name)
  await writeFile(path, `${JSON.stringify(value)}\n`)
  return path
}

async function recordSkills(root, stage, evidence) {
  const required = JSON.parse(run('skill-runs.mjs', 'required', root, stage))
  const typedEvidence = {
    'analyze-drama-source': '.short-drama/source-analysis.json',
    'define-drama-brief': '.short-drama/brief.json',
    'design-drama-bible': '.short-drama/bible.json',
    'outline-drama-series': '.short-drama/outline.json',
    'short-drama': 'episodes/ep-001/scripts/v001.md',
    'write-drama-episode': 'episodes/ep-001/scripts/v001.md',
    humanizer: 'episodes/ep-001/scripts/v002.md',
    'review-drama-script': 'episodes/ep-001/script-review/v001.json',
    'write-drama-director-book': 'episodes/ep-001/director-book/v001.json',
    'plan-drama-assets': 'episodes/ep-001/asset-plan/v001.json',
    'generate-drama-art-style': '.short-drama/art-style.json',
    'generate-character-profiles': 'assets/characters/profiles.json',
    'build-drama-storyboard': 'episodes/ep-001/storyboard/v001.json',
    'plan-drama-production': 'episodes/ep-001/production-plan/v001.json',
    'write-drama-video-prompts': 'episodes/ep-001/video-prompts/v001.json',
    'design-drama-audio': 'episodes/ep-001/audio-plan/v001.json',
    'remotion-best-practices': 'editing/ep-001/timeline.json',
    'edit-drama-timeline': 'editing/ep-001/review.json',
    'edit-deliver-drama': 'delivery/ep-001/manifest.json',
  }
  for (const skill of required) {
    const skillEvidence = typedEvidence[skill] || evidence
    const owned = skillMap.completion_prompts?.[skill] || Object.entries(skillMap.prompts).filter(([, owner]) => owner === skill).map(([name]) => name)
    if (owned.length) {
      const providerOwned = owned.filter((name) => providerPrompts.has(name))
      const prompt = ['asset-generation', 'media-production'].includes(stage) && providerOwned.length ? providerOwned[0] : owned.find((name) => !providerPrompts.has(name)) || providerOwned[0]
      const template = resolve(plugin, 'skills', skill, 'assets/prompts', `${prompt}.zh.txt`)
      const templateText = await readFile(template, 'utf8')
      const vars = Object.fromEntries([...templateText.matchAll(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g)].map((match) => [match[1], '测试']))
      const varsPath = await json(root, `prompt-vars-${stage}-${skill}.json`, vars)
      if (providerPrompts.has(prompt)) run('render-prompt.mjs', '--template', template, '--vars', varsPath, '--output', resolve(root, `prompt-${stage}-${skill}.txt`), '--project-root', root)
      else run('render-prompt.mjs', '--template', template, '--vars', varsPath, '--codex-output', resolve(root, skillEvidence), '--project-root', root)
    }
    run('skill-runs.mjs', 'record', root, stage, skill, skillEvidence)
  }
}

async function checkMultiEpisodeEvidence() {
  const root = await mkdtemp(resolve(tmpdir(), 'short-drama-multi-'))
  try {
    run('project-store.mjs', 'init', root)
    const ledgerBefore = await readFile(resolve(root, '.short-drama/skill-runs.json'), 'utf8')
    const duplicateInit = spawnSync(process.execPath, [resolve(plugin, 'scripts/project-store.mjs'), 'init', root], { encoding: 'utf8' })
    if (duplicateInit.status === 0 || !duplicateInit.stderr.includes('项目已存在')) throw new Error('重复初始化保护失效')
    run('project-store.mjs', 'update-project', root, await json(root, 'same-config.json', { description: null }))
    if ((await readFile(resolve(root, '.short-drama/skill-runs.json'), 'utf8')) !== ledgerBefore) throw new Error('保存未变化配置不应清理 Skill 凭证')
    for (const [key, order] of [['ep-001', 1], ['ep-002', 2]]) {
      run('project-store.mjs', 'put-episode', root, await json(root, `${key}.json`, { key, order, title: `第${order}集` }))
      await writeFile(resolve(root, `${key}.md`), `# 第${order}集\n`)
      run('project-store.mjs', 'put-script', root, key, 'v001', resolve(root, `${key}.md`))
    }
    const incomplete = spawnSync(process.execPath, [resolve(plugin, 'scripts/skill-runs.mjs'), 'record', root, 'script', 'write-drama-episode', 'episodes/ep-001/scripts/v001.md'], { encoding: 'utf8' })
    if (incomplete.status === 0 || !incomplete.stderr.includes('缺少 ep-002 的执行证据')) throw new Error('多集 Skill 证据覆盖门禁失效')
    await writeFile(resolve(root, 'editing/timeline.json'), '{}\n')
    await writeFile(resolve(root, 'delivery/final.mp4'), 'legacy')
    await writeFile(resolve(root, 'delivery/manifest.json'), '{}\n')
    const migration = JSON.parse(run('project-store.mjs', 'migrate-project-layout', root, 'ep-001'))
    if (migration.migrated.length !== 3 || !migration.regenerate_manifest || (await readFile(resolve(root, 'delivery/ep-001/final.mp4'), 'utf8')) !== 'legacy') throw new Error('旧项目分集目录迁移失败')
    if (!(await readdir(resolve(root, 'delivery/ep-001'))).some((name) => name.startsWith('manifest.legacy.'))) throw new Error('旧 manifest 未保留')
  } finally { await rm(root, { recursive: true, force: true }) }
}

async function checkBailianVoiceLifecycle() {
  const bailianRoot = await mkdtemp(resolve(tmpdir(), 'short-drama-bailian-'))
  const originalFetch = globalThis.fetch
  const originalKey = process.env.BAILIAN_API_KEY
  // 项目外哨兵：植入账本 preview_path 穿越行时，delete_voice 绝不能删掉它
  const sentinelName = `p7-sentinel-${process.pid}.txt`
  const sentinelPath = resolve(bailianRoot, '..', sentinelName)
  try {
    // 前置门禁阶段：即使环境里预置了 BAILIAN_API_KEY 也先摘除，并用拒绝型 fetch 陷阱兜底任何意外出站
    delete process.env.BAILIAN_API_KEY
    globalThis.fetch = async (url) => { throw new Error(`前置门禁自检阶段禁止任何真实网络请求：${url}`) }
    const bailianInit = await json(bailianRoot, 'initial-project.json', { key: 'bailian-drama', title: '百炼配音短剧', providers: { image: { provider: 'starrouter', model_or_workflow: 'gpt-image-2', prompt_profile: null }, video: { provider: 'starrouter', model_or_workflow: 'dreamina-seedance-2-0-260128', prompt_profile: 'seedance2', parameters: { watermark: true } }, audio: { provider: 'bailian', model_or_workflow: 'cosyvoice-v3.5-plus', prompt_profile: null, parameters: { speed: 1, response_format: 'wav', sample_rate: 24000, volume: 50, pitch: 1, language_hints: 'zh', instruction: '' } }, music: { provider: 'starrouter', model_or_workflow: 'suno_music', prompt_profile: null, parameters: { make_instrumental: true } } } })
    run('project-store.mjs', 'init', bailianRoot, bailianInit)
    // path 模式克隆门禁要求 assets/ 真实存在（realpath assetsRoot）
    await mkdir(resolve(bailianRoot, 'assets'), { recursive: true })
    const bailianProject = JSON.parse(run('project-store.mjs', 'project', bailianRoot))
    if (bailianProject.providers.audio.provider !== 'bailian' || bailianProject.providers.audio.model_or_workflow !== 'cosyvoice-v3.5-plus') throw new Error('百炼配音配置未被项目存储接受')
    const expectRejected = async (name, payload, expected) => {
      const file = await json(bailianRoot, name, payload)
      const result = spawnSync(process.execPath, [resolve(plugin, 'scripts/project-store.mjs'), 'update-project', bailianRoot, file], { encoding: 'utf8' })
      if (result.status === 0 || !result.stderr.includes(expected)) throw new Error(`百炼非法配置未被拒绝（应含：${expected}）：${result.stderr}`)
    }
    await expectRejected('invalid-hint.json', { providers: { audio: { model_or_workflow: 'cosyvoice-v2', prompt_profile: null, parameters: { language_hints: 'ja' } } } }, '选项无效')
    await expectRejected('v3-plus-instruction.json', { providers: { audio: { model_or_workflow: 'cosyvoice-v3-plus', prompt_profile: null, parameters: { language_hints: 'zh', instruction: '冷静地说' } } } }, '模型参数不受支持')
    await expectRejected('unknown-model.json', { providers: { audio: { provider: 'bailian', model_or_workflow: 'not-a-model', prompt_profile: null } } }, '不受 bailian 支持')

    // 前置门禁：全部必须在到达百炼网络前被拒绝（fetch 是拒绝陷阱，且未设置 BAILIAN_API_KEY）
    const rights = { usage_scope: 'non-commercial', confirmed: true, rights_confirmed: true, public_exposure_confirmed: true, usage_terms_confirmed: true }
    const expectGate = async (label, payload, fragment) => {
      try { await callGeneration('clone_voice', payload); throw new Error(`${label} 未被拒绝`) }
      catch (error) { if (!String(error.message).includes(fragment)) throw error }
    }
    await expectGate('私网克隆 URL', { provider: 'bailian', project_root: bailianRoot, prefix: 'cl', audio_url: 'http://127.0.0.1/a.wav', ...rights }, '公网 HTTPS')
    await expectGate('元数据地址克隆 URL', { provider: 'bailian', project_root: bailianRoot, prefix: 'cl', audio_url: 'https://169.254.169.254/latest/meta-data/', ...rights }, '公网 HTTPS')
    try { await callGeneration('clone_voice', { provider: 'bailian', project_root: bailianRoot, prefix: 'cl', reference_audio_path: '/etc/hosts', ...rights }); throw new Error('项目外参考音频未被拒绝') }
    catch (error) { if (!String(error.message).includes('assets/ 内文件')) throw error }
    // 付费确认门先于素材权利门（与权利门不同的 confirmed=true 文案）
    await expectGate('未确认克隆', { provider: 'bailian', project_root: bailianRoot, prefix: 'cl', audio_url: 'https://example.com/a.wav', rights_confirmed: true, public_exposure_confirmed: true, usage_terms_confirmed: true, usage_scope: 'non-commercial' }, 'confirmed=true')
    // 权利门：三个布尔字段各自独立为 false 都必须被同一条素材权利文案拒绝
    for (const field of ['rights_confirmed', 'public_exposure_confirmed', 'usage_terms_confirmed']) {
      await expectGate(`权利字段 ${field}=false`, { provider: 'bailian', project_root: bailianRoot, prefix: 'cl', audio_url: 'https://example.com/a.wav', ...{ ...rights, [field]: false } }, '必须确认素材权利')
    }
    // 权利门：confirmed=true 但缺 rights_confirmed（其余为 true）
    await expectGate('缺少 rights_confirmed', { provider: 'bailian', project_root: bailianRoot, prefix: 'cl', audio_url: 'https://example.com/a.wav', confirmed: true, public_exposure_confirmed: true, usage_terms_confirmed: true, usage_scope: 'non-commercial' }, '必须确认素材权利')
    // 权利门：全部布尔为 true 但 usage_scope 越枚举
    await expectGate('越界 usage_scope', { provider: 'bailian', project_root: bailianRoot, prefix: 'cl', audio_url: 'https://example.com/a.wav', confirmed: true, rights_confirmed: true, public_exposure_confirmed: true, usage_terms_confirmed: true, usage_scope: 'internal' }, '必须确认素材权利')
    try { await callGeneration('design_voice', { provider: 'bailian', project_root: bailianRoot, flavor: 'cosyvoice-design', voice_prompt: '低沉女声', preview_text: '你好', prefix: 'cv', confirmed: true }); throw new Error('过短预览文本未被拒绝') }
    catch (error) { if (!String(error.message).includes('预览文本')) throw error }
    try { await callGeneration('delete_voice', { provider: 'bailian', project_root: bailianRoot, voice_id: 'cosyvoice-v2-x' }); throw new Error('未确认删除未被拒绝') }
    catch (error) { if (!String(error.message).includes('confirmed=true')) throw error }

    // fetch 桩端到端：litterbox 上传 + customization 四个 action 全部本地桩接
    process.env.BAILIAN_API_KEY = 'self-check-key'
    const jsonResponse = (payload) => new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } })
    globalThis.fetch = async (url, options = {}) => {
      const href = String(url)
      if (href.includes('litterbox.catbox.moe')) return new Response('https://litter.catbox.moe/ref.wav', { status: 200 })
      if (!href.includes('/audio/tts/customization')) throw new Error(`未桩接的请求：${href}`)
      const body = JSON.parse(options.body || '{}')
      const action = body.input?.action
      if (body.model === 'voice-enrollment' && action === 'list_voice') return jsonResponse({ output: { voices: [{ voice_id: 'cosyvoice-v3.5-plus-t1', target_model: 'cosyvoice-v3.5-plus', status: 'OK' }, { voice_id: 'cosyvoice-v3.5-plus-cl1', target_model: 'cosyvoice-v3.5-plus', status: 'OK' }] }, request_id: 'r-list-c' })
      if (body.model === 'qwen-voice-design' && action === 'list') return jsonResponse({ output: { voices: [{ voice: 'qwen-old-1' }] } })
      if (action === 'create_voice') return body.input.url
        ? jsonResponse({ output: { voice_id: 'cosyvoice-v3.5-plus-cl1', target_model: 'cosyvoice-v3.5-plus', status: 'OK' }, request_id: 'r-clone' })
        : jsonResponse({ output: { voice_id: 'cosyvoice-v3.5-plus-t1', target_model: 'cosyvoice-v3.5-plus', status: 'OK', preview_audio: { data: Buffer.from('preview pcm').toString('base64'), sample_rate: 24000, response_format: 'wav' } }, request_id: 'r-design' })
      if (action === 'delete_voice' || action === 'delete') return jsonResponse({ request_id: 'r-delete' })
      throw new Error(`未桩接的 customization action：${action}`)
    }
    const designed = await callGeneration('design_voice', { provider: 'bailian', project_root: bailianRoot, flavor: 'cosyvoice-design', voice_prompt: '低沉女声', preview_text: '你好，这是试听。', prefix: 'cv', target_model: 'cosyvoice-v3.5-plus', confirmed: true })
    if (designed.voice_id !== 'cosyvoice-v3.5-plus-t1' || !designed.preview_path?.endsWith('.wav')) throw new Error('design_voice 端到端结果错误')
    const preview = await readFile(resolve(bailianRoot, designed.preview_path))
    if (preview.length === 0) throw new Error('音色预览音频未落盘')
    await writeFile(resolve(bailianRoot, 'assets', 'ref.wav'), Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVE'), Buffer.alloc(32)]))
    const cloned = await callGeneration('clone_voice', { provider: 'bailian', project_root: bailianRoot, prefix: 'cl', reference_audio_path: resolve(bailianRoot, 'assets', 'ref.wav'), target_model: 'cosyvoice-v3.5-plus', ...rights })
    if (cloned.voice_id !== 'cosyvoice-v3.5-plus-cl1' || !cloned.upload_receipt_id || cloned.source !== 'clone') throw new Error('clone_voice 端到端结果错误')
    const ledger = JSON.parse(await readFile(resolve(bailianRoot, '.short-drama', 'voices.json'), 'utf8'))
    if (ledger.voices.length !== 2) throw new Error('音色登记条数错误')
    const listed = await callGeneration('list_voices', { provider: 'bailian', project_root: bailianRoot })
    if (listed.provider !== 'bailian' || listed.voices.length !== 3 || listed.local_only.length !== 0) throw new Error('list_voices 云端/本地叠加错误')
    const t1Row = listed.voices.find((item) => item.voice_id === 'cosyvoice-v3.5-plus-t1')
    const cl1Row = listed.voices.find((item) => item.voice_id === 'cosyvoice-v3.5-plus-cl1')
    if (t1Row?.local?.source !== 'design' || cl1Row?.local?.source !== 'clone' || !listed.voices.some((item) => item.source === 'qwen')) throw new Error('list_voices 本地登记叠加错误')
    const receipts = await listReferenceUploads(bailianRoot, { state: 'active' })
    if (receipts.length !== 1 || receipts[0].media_type !== 'audio') throw new Error('克隆音频托管收据缺失')
    const deleted = await callGeneration('delete_voice', { provider: 'bailian', project_root: bailianRoot, voice_id: 'cosyvoice-v3.5-plus-t1', confirmed: true })
    if (!deleted.local_removed || !deleted.preview_deleted || deleted.flavor !== 'cosyvoice') throw new Error('delete_voice 收敛结果错误')
    const ledgerAfter = JSON.parse(await readFile(resolve(bailianRoot, '.short-drama', 'voices.json'), 'utf8'))
    if (ledgerAfter.voices.length !== 1 || ledgerAfter.voices[0].voice_id !== 'cosyvoice-v3.5-plus-cl1') throw new Error('删除后本地登记未收敛')

    // P6：付费设计已成功但本地预览落盘失败（目标路径预建成目录 → writeFile EISDIR）：不得抛出/不得重试，登记 preview_path=null 并给中文 warning
    const previewTarget = resolve(bailianRoot, '.short-drama', 'voice-previews', 'cosyvoice-v3.5-plus-t1.wav')
    await mkdir(previewTarget, { recursive: true })
    const degraded = await callGeneration('design_voice', { provider: 'bailian', project_root: bailianRoot, flavor: 'cosyvoice-design', voice_prompt: '低沉女声', preview_text: '你好，这是试听。', prefix: 'cv', target_model: 'cosyvoice-v3.5-plus', confirmed: true })
    if (degraded.voice_id !== 'cosyvoice-v3.5-plus-t1' || degraded.preview_path !== null || !String(degraded.warning).includes('试听音频保存失败') || !String(degraded.warning).includes('list_voices/delete_voice')) throw new Error('预览落盘失败降级返回错误')
    const degradedLedger = JSON.parse(await readFile(resolve(bailianRoot, '.short-drama', 'voices.json'), 'utf8'))
    const degradedRow = degradedLedger.voices.find((item) => item.voice_id === 'cosyvoice-v3.5-plus-t1')
    if (!degradedRow || degradedRow.preview_path !== null) throw new Error('预览落盘失败后登记行必须为 preview_path=null')
    await rm(previewTarget, { recursive: true, force: true })

    // P7：植入穿越 preview_path 的账本行，delete_voice 必须在读取边界拒绝；项目外哨兵保留、账本行保留
    await writeFile(sentinelPath, 'guard')
    const plantedLedger = { version: 1, voices: [{ voice_id: 'cosyvoice-v2-p7probe', flavor: 'cosyvoice-clone', target_model: 'cosyvoice-v2', prefix: 'p7', name: 'p7', source: 'clone', preview_path: `../${sentinelName}`, upload_receipt_id: null, request_id: null, created_at: new Date().toISOString() }] }
    await writeFile(resolve(bailianRoot, '.short-drama', 'voices.json'), `${JSON.stringify(plantedLedger)}\n`)
    try {
      await callGeneration('delete_voice', { provider: 'bailian', project_root: bailianRoot, voice_id: 'cosyvoice-v2-p7probe', confirmed: true })
      throw new Error('穿越 preview_path 账本行未被拒绝')
    } catch (error) {
      if (!String(error.message).includes('形状损坏')) throw error
    }
    if ((await readFile(sentinelPath, 'utf8').catch(() => null)) !== 'guard') throw new Error('项目外哨兵文件被穿越删除')
    const preservedLedger = JSON.parse(await readFile(resolve(bailianRoot, '.short-drama', 'voices.json'), 'utf8'))
    if (preservedLedger.voices.length !== 1 || preservedLedger.voices[0].voice_id !== 'cosyvoice-v2-p7probe' || preservedLedger.voices[0].preview_path !== `../${sentinelName}`) throw new Error('拒绝删除后植入账本行应原样保留')
    await rm(sentinelPath, { force: true })
  } finally {
    globalThis.fetch = originalFetch
    if (originalKey === undefined) delete process.env.BAILIAN_API_KEY
    else process.env.BAILIAN_API_KEY = originalKey
    await rm(sentinelPath, { force: true })
    await rm(bailianRoot, { recursive: true, force: true })
  }
}

async function main() {
  if (!process.argv.includes('--self-check')) throw new Error('仅支持 --self-check')
  runTest('scripts/media-pipeline.integration.test.mjs')
  const imageSchema = generationTools.find((tool) => tool.name === 'generate_image')?.inputSchema?.properties
  if (!imageSchema?.reference_paths || imageSchema.reference_image_paths || JSON.stringify(imageSchema.reference_manifest?.items?.required) !== JSON.stringify(['type', 'order', 'asset_key', 'version_id', 'role'])) throw new Error('图片生成 MCP Schema 与运行时参考素材合同不一致')
  for (const name of ['transcribe_audio', 'translate_audio']) if (!generationTools.find((tool) => tool.name === name)?.inputSchema?.properties?.file_path) throw new Error(`${name} MCP Schema 缺失`)
  for (const name of ['design_voice', 'clone_voice', 'list_voices', 'delete_voice']) if (!generationTools.find((tool) => tool.name === name)) throw new Error(`${name} MCP 工具缺失`)
  const cloneSchema = generationTools.find((tool) => tool.name === 'clone_voice')?.inputSchema
  for (const field of ['confirmed', 'rights_confirmed', 'public_exposure_confirmed', 'usage_terms_confirmed', 'usage_scope']) if (!cloneSchema?.required?.includes(field)) throw new Error(`clone_voice 缺少必填确认字段：${field}`)
  const audioSchema = generationTools.find((tool) => tool.name === 'generate_audio')?.inputSchema?.properties
  if (!audioSchema.language_hints || !audioSchema.instruction || audioSchema.response_format.enum.join() !== 'mp3,pcm,flac,wav,opus') throw new Error('generate_audio 百炼字段缺失')
  for (const script of ['asset-ledger.mjs', 'character-profiles.mjs', 'editing-store.mjs', 'export-edit-subtitles.mjs', 'file-lock.mjs', 'freeze-edit-candidate.mjs', 'media-tools.mjs', 'native-audio-audit.mjs', 'preflight.mjs', 'previz-self-check.mjs', 'project-store.mjs', 'render-prompt.mjs', 'review-ledger.mjs', 'shot-fingerprint.mjs', 'task-ledger.mjs', 'task-sync.mjs', 'workflow-gates.mjs', 'generation/bailian.mjs', 'generation/voice-tools.mjs', 'voice-ledger.mjs']) run(script, '--self-check')
  for (const check of [checkComfly, checkRunningHub, checkStarRouter, checkProviders, checkLitterbox, checkBailian, checkPublish]) await check()
  await checkMultiEpisodeEvidence()
  await checkBailianVoiceLifecycle()
  const root = await mkdtemp(resolve(tmpdir(), 'short-drama-integration-'))
  try {
    const initialProject = await json(root, 'initial-project.json', { key: 'integration-drama', title: '集成测试短剧', providers: { image: { provider: 'starrouter', model_or_workflow: 'gpt-image-2', prompt_profile: null }, video: { provider: 'starrouter', model_or_workflow: 'dreamina-seedance-2-0-260128', prompt_profile: 'seedance2', parameters: { watermark: true } }, audio: { provider: 'starrouter', model_or_workflow: 'speech-2.8-hd', prompt_profile: null, parameters: { speed: 1, response_format: 'flac' } }, music: { provider: 'starrouter', model_or_workflow: 'suno_music', prompt_profile: null, parameters: { make_instrumental: true } } } })
    run('project-store.mjs', 'init', root, initialProject)
    const initialized = JSON.parse(run('project-store.mjs', 'project', root))
    if (initialized.schema_version !== 1 || !('format' in initialized) || !('providers' in initialized) || initialized.creative?.art_style?.id !== 'system-realistic') throw new Error('项目规范 v1 初始化失败')
    for (const [name, field] of [['assets.json', 'assets'], ['tasks.json', 'tasks'], ['shot-reviews.json', 'reviews']]) {
      const ledger = JSON.parse(await readFile(resolve(root, '.short-drama', name), 'utf8'))
      if (ledger.version !== 1 || !ledger[field] || typeof ledger[field] !== 'object') throw new Error(`初始化缺少 ${name}`)
    }
    const invalidFormat = spawnSync(process.execPath, [resolve(plugin, 'scripts/project-store.mjs'), 'update-project', root, await json(root, 'invalid-format.json', { format: { aspect_ratio: '16:9', resolution: '1080x1920' } })], { encoding: 'utf8' })
    if (invalidFormat.status === 0 || !invalidFormat.stderr.includes('必须与 format.aspect_ratio 一致')) throw new Error('画幅与分辨率冲突未被拒绝')
    run('project-store.mjs', 'update-project', root, await json(root, 'replace-video-parameters.json', { providers: { video: { parameters: { duration: 5 } } } }))
    if (Object.keys(JSON.parse(run('project-store.mjs', 'project', root)).providers.video.parameters).join() !== 'duration') throw new Error('模型参数更新未整体替换旧字段')
    const mediaHosts = await callGeneration('list_media_hosts')
    if (!mediaHosts.litterbox?.free || mediaHosts.litterbox?.permanent || mediaHosts.litterbox?.expiries?.join(',') !== '1h,12h,24h,72h' || !mediaHosts.litterbox?.media_types?.includes('audio')) throw new Error('Litterbox MCP 能力目录无效')
    try { await callGeneration('transcribe_audio', { provider: 'starrouter', model: 'whisper-1', file_path: '/etc/hosts', project_root: root, confirmed: true }); throw new Error('项目外 ASR 文件未被拒绝') }
    catch (error) { if (!String(error.message).includes('assets/ 内文件')) throw error }
    const environment = JSON.parse(await readFile(resolve(root, '.short-drama/environment.json'), 'utf8'))
    if (!environment.ok || !(await readFile(resolve(root, '.short-drama/RESUME.md'), 'utf8')).includes('skill-runs.mjs required')) throw new Error('环境预检或跨会话恢复入口初始化失败')
    const promptTemplate = resolve(plugin, 'skills/generate-character-images/assets/prompts/character_asset_sheet.zh.txt')
    const promptOutput = resolve(root, 'prompt-output.txt')
    const promptText = await readFile(promptTemplate, 'utf8')
    const promptVars = Object.fromEntries([...promptText.matchAll(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g)].map((match) => [match[1], '测试']))
    run('render-prompt.mjs', '--template', promptTemplate, '--vars', await json(root, 'prompt-vars.json', promptVars), '--output', promptOutput, '--project-root', root)
    const promptRuns = await readdir(resolve(root, '.short-drama/prompt-runs'))
    const promptRun = JSON.parse(await readFile(resolve(root, '.short-drama/prompt-runs', promptRuns[0]), 'utf8'))
    if (promptRun.executionMode !== 'provider-prompt' || Object.keys(promptRun.variables).length === 0) throw new Error('Provider 提示词留痕失败')
    const codexTemplate = resolve(plugin, 'skills/define-drama-brief/assets/prompts/drama_brief.zh.txt')
    const codexTemplateText = await readFile(codexTemplate, 'utf8')
    const codexVars = Object.fromEntries([...codexTemplateText.matchAll(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g)].map((match) => [match[1], '测试']))
    const codexOutput = resolve(root, 'codex-output.md')
    await writeFile(codexOutput, '# Codex 实际产物\n')
    run('render-prompt.mjs', '--template', codexTemplate, '--vars', await json(root, 'codex-vars.json', codexVars), '--codex-output', codexOutput, '--project-root', root)
    const wrongMode = spawnSync(process.execPath, [resolve(plugin, 'scripts/render-prompt.mjs'), '--template', codexTemplate, '--vars', resolve(root, 'codex-vars.json'), '--output', resolve(root, 'wrong-prompt.txt'), '--project-root', root], { encoding: 'utf8' })
    if (wrongMode.status === 0 || !wrongMode.stderr.includes('必须使用 --codex-output')) throw new Error('Prompt 类型误用未被拒绝')
    const codexRuns = await readdir(resolve(root, '.short-drama/prompt-runs'))
    const recorded = await Promise.all(codexRuns.map(async (name) => JSON.parse(await readFile(resolve(root, '.short-drama/prompt-runs', name), 'utf8'))))
    if (!recorded.some((item) => item.executionMode === 'codex-contract' && item.codexOutput === '# Codex 实际产物\n')) throw new Error('Codex 合同与实际产物留痕失败')
    await writeFile(resolve(root, 'source.md'), '# 原始故事\n')
    run('project-store.mjs', 'put-source', root, 'src-story', 'v001', resolve(root, 'source.md'))
    run('project-store.mjs', 'select-source', root, 'src-story', 'v001')
    run('asset-ledger.mjs', 'put', root, await json(root, 'char-a.json', { key: 'char-a', type: 'character', name: 'char-a' }))
    const media = resolve(root, 'char-a.png')
    await writeFile(media, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'))
    run('asset-ledger.mjs', 'import', root, 'char-a', media, 'v001', '-')
    run('asset-ledger.mjs', 'select', root, 'char-a', 'v001')
    await mkdir(resolve(root, 'assets/characters'), { recursive: true })
    const integrationCharacter = { name: 'A', aliases: [], introduction: '测试人物', gender: 'unknown', age_range: '成年', role_level: 'A', archetype: '推动者', personality_tags: ['克制', '果断'], era_period: '现代', social_class: '普通', occupation: '测试职业', costume_tier: 2, suggested_colors: ['黑', '灰'], primary_identifier: '利落短发', visual_keywords: ['克制'], performance_bible: { center_of_gravity: '稳定', gait: '利落', habitual_actions: [], eyeline_behavior: '直视', blink_rhythm: '平稳', stress_response: '停顿', forbidden_performance: [] }, voice_identity: { pitch: '中', timbre: '清晰', accent: '普通话', pace: '中速', delivery: '克制' }, audience_appeal: { age_class: 'adult', appeal_mode: 'adult-charisma', screen_presence: '克制而利落', grooming_and_makeup: '利落短发与干净修容', costume_signature: '深色外套与哑光领扣', memory_anchors: ['利落短发', '哑光领扣'], prohibited_treatment: [] }, expected_appearances: [{ id: 1, change_reason: '基础造型' }] }
    const characterProfileBytes = Buffer.from(`${JSON.stringify({ version: 1, characters: [integrationCharacter] }, null, 2)}\n`)
    await writeFile(resolve(root, 'assets/characters/profiles.json'), characterProfileBytes)
    const identity = {
      identity_binding: { profile_name: 'A', profile_sha256: createHash('sha256').update(characterProfileBytes).digest('hex'), appearance_id: 1 },
      identity_constraints: { age_class: 'adult', grooming_and_makeup: '利落短发与干净修容', costume_signature: '深色外套与哑光领扣', memory_anchors: ['利落短发', '哑光领扣'] },
    }
    const publishInput = { service: 'litterbox', asset_key: 'char-a', version_id: 'v001', expires_in: '1h', usage_scope: 'non-commercial', confirmed: true, rights_confirmed: true, public_exposure_confirmed: true, usage_terms_confirmed: true }
    try { await publishReferenceImage(root, { ...publishInput, confirmed: false }, async () => new Response('https://litter.catbox.moe/test.png')); throw new Error('未确认公开上传仍被执行') } catch (error) { if (!String(error.message).includes('confirmed=true')) throw error }
    const uploadReceipt = await publishReferenceImage(root, publishInput, async (url, options) => {
      if (String(url) !== 'https://litterbox.catbox.moe/resources/internals/api.php' || options.method !== 'POST' || options.body.get('time') !== '1h' || options.body.get('reqtype') !== 'fileupload') throw new Error('Litterbox 请求合同错误')
      return new Response('https://litter.catbox.moe/test.png', { status: 200 })
    })
    if (uploadReceipt.permanent || !uploadReceipt.receipt_path.startsWith('.short-drama/uploads/') || uploadReceipt.asset_key !== 'char-a') throw new Error('Litterbox 上传收据失败')
    const reused = await publishReferenceImage(root, publishInput, async () => { throw new Error('有效收据不应重复上传') })
    if (!reused.reused || reused.id !== uploadReceipt.id || (await listReferenceUploads(root, { state: 'active' })).length !== 1) throw new Error('Litterbox 收据复用或查询失败')
    await validateTemporaryReferenceUrl(root, uploadReceipt.url, { asset_key: 'char-a', version_id: 'v001' })
    const referenceManifest = [{ type: 'image', order: 1, asset_key: 'char-a', version_id: 'v001', role: 'first_frame', ...identity }]
    try { await validateTemporaryReferenceUrl(root, uploadReceipt.url, { asset_key: 'char-a', version_id: 'v001' }, Date.parse(uploadReceipt.expires_at)); throw new Error('到期收据仍被接受') } catch (error) { if (!String(error.message).includes('校验时间点有效')) throw error }
    const repeatedManifest = [1, 2].map((order) => ({ type: 'image', order, asset_key: 'char-a', version_id: 'v001', role: 'reference_image', ...identity }))
    await validateVideoReferenceBindings(root, 'starrouter', { prompt_profile: 'seedance2', reference_image_urls: [uploadReceipt.url, uploadReceipt.url] }, repeatedManifest)
    const selectedPath = resolve(root, JSON.parse(await readFile(resolve(root, '.short-drama/assets.json'), 'utf8')).assets['char-a'].versions[0].localPath)
    await validateVideoReferenceBindings(root, 'runninghub', { model: 'minimax-h3-reference-to-video', reference_image_paths: [selectedPath] }, [referenceManifest[0]])
    try { await validateVideoReferenceBindings(root, 'runninghub', { model: 'minimax-h3-reference-to-video', reference_image_paths: [media] }, [referenceManifest[0]]); throw new Error('错误本地参考路径仍被接受') } catch (error) { if (!String(error.message).includes('本地参考路径与资产版本不一致')) throw error }
    try { await validateTemporaryReferenceUrl(root, 'https://litter.catbox.moe/untracked.png', { asset_key: 'char-a', version_id: 'v001' }); throw new Error('无收据 Litterbox URL 被接受') } catch (error) { if (!String(error.message).includes('本地上传收据')) throw error }
    const snapshot = async (name, target, type, provider, tool, args, promptDocument = null) => JSON.parse(run('task-ledger.mjs', 'snapshot', root, await json(root, `${name}-request.json`, { tool, target, type, provider, modelOrWorkflow: args.model || args.workflow_id, promptDocument, arguments: { ...args, confirmed: true } })))
    const videoPromptText = `${ANTI_GRID_CLAIM_ZH}\n@图片1 作为首帧，人物抬头后停在结束姿态。\n${ANTI_GRID_CLAIM_ZH}`
    const videoPromptText2 = `${ANTI_GRID_CLAIM_ZH}\n@图片1 作为首帧，人物转身走向门口后停住。\n${ANTI_GRID_CLAIM_ZH}`
    const videoPromptReference = { episode_key: 'ep-001', version_id: 'v001', shot_number: 1 }
    const videoPromptReference2 = { episode_key: 'ep-001', version_id: 'v001', shot_number: 2 }
    const audioPromptReference = { kind: 'audio-plan', episode_key: 'ep-001', version_id: 'v001', line_index: 1 }
    const requestA = await snapshot('task-a', 'shot-ep001-001', 'video', 'starrouter', 'submit_video', { model: 'dreamina-seedance-2-0-260128', prompt_profile: 'seedance2', input_mode: 'first-last-frame', prompt_version: 'v001', prompt: videoPromptText, duration: 5, frame_url: uploadReceipt.url, reference_manifest: referenceManifest }, videoPromptReference)
    const requestD = await snapshot('task-d', 'shot-ep001-002', 'video', 'starrouter', 'submit_video', { model: 'dreamina-seedance-2-0-260128', prompt_profile: 'seedance2', input_mode: 'first-last-frame', prompt_version: 'v001', prompt: videoPromptText2, duration: 5, frame_url: uploadReceipt.url, reference_manifest: referenceManifest }, videoPromptReference2)
    const requestB = await snapshot('task-b', 'shot-b', 'video', 'runninghub', 'submit_video', { workflow_id: 'workflow-b', prompt: '失败任务提示词' })
    const requestC = await snapshot('task-c', 'audio-ep001-a', 'audio', 'starrouter', 'generate_audio', { model: 'speech-2.8-hd', input: '别绕弯子。', voice: 'male-qn-qingse', speed: 1, response_format: 'flac' }, audioPromptReference)
    const taskA = await json(root, 'task-a.json', { taskId: 'task-a', target: 'shot-ep001-001', type: 'video', provider: 'starrouter', requestPath: requestA.requestPath, status: 'running' })
    const taskB = await json(root, 'task-b.json', { taskId: 'task-b', target: 'shot-b', type: 'video', provider: 'runninghub', requestPath: requestB.requestPath, status: 'failed' })
    const taskC = await json(root, 'task-c.json', { taskId: 'task-c', target: 'audio-ep001-a', type: 'audio', provider: 'starrouter', requestPath: requestC.requestPath, status: 'running' })
    const taskD = await json(root, 'task-d.json', { taskId: 'task-d', target: 'shot-ep001-002', type: 'video', provider: 'starrouter', requestPath: requestD.requestPath, status: 'running' })
    await Promise.all([runAsync('task-ledger.mjs', 'put', root, taskA), runAsync('task-ledger.mjs', 'put', root, taskB), runAsync('task-ledger.mjs', 'put', root, taskC), runAsync('task-ledger.mjs', 'put', root, taskD)])
    if (Object.keys(JSON.parse(run('task-ledger.mjs', 'list', root)).tasks).length !== 4) throw new Error('并发任务账本写入丢失')
    try {
      await callGeneration('generate_image', { provider: 'starrouter', model: 'gpt-image-2', prompt: '越级调用', reference_manifest: [], confirmed: true, project_root: root, target: 'other-early', prompt_document: null })
      throw new Error('分析阶段仍可调用媒体生成')
    } catch (error) { if (!String(error.message).includes('只能在 asset-generation 或 media-production')) throw error }
    const source = { source_scope: {}, adaptation_mode: 'original', facts: [], timeline: [], characters: [], locations: [], props: [], conflicts: [], themes: [], visual_challenges: [], content_constraints: [], user_requirements: [], contradictions: [], open_questions: [], coverage: { complete: true, ranges: [] } }
    const brief = { title: '测试', logline: '', adaptation_mode: 'original', genre: '', audience: '', platform: '', tone: '', core_conflict: '', output_language: 'zh-CN', spoken_language: 'zh-CN', subtitle_language: 'zh-CN', aspect_ratio: '9:16', episode_count: 1, episode_duration_seconds: 30, rating: '', existing_materials: [], required_deliverables: [], prohibited_content: [], ending_type: '', creative_constraints: [], open_questions: [], approved: true }
    const bible = { premise: '', genre: '', tone: '', themes: [], world_rules: [], ending: {}, characters: [{ name: '测试角色', dramatic_function: '主角', desire: '完成目标', need: '面对真相', fear: '失去同伴', hidden_fact: '隐瞒了过去', arc_start: '逃避', arc_turn: '承担', arc_end: '和解' }], relationships: [], three_act: {}, conflict_ladder: [], promises_and_payoffs: [], foreshadowing: [], continuity_rules: [], adaptation_constraints: [], open_questions: [] }
    const outline = { episodes: [{ key: 'ep-001', order: 1 }], coverage_check: { complete: true, gaps: [], overlaps: [] }, continuity_check: { valid: true, issues: [] } }
    for (const [kind, value] of Object.entries({ 'source-analysis': source, brief, bible, outline })) run('project-store.mjs', 'put-document', root, kind, await json(root, `${kind}.json`, value))
    const legacyBible = { ...bible, characters: [{ ...bible.characters[0], secret: bible.characters[0].hidden_fact }] }
    delete legacyBible.characters[0].hidden_fact
    const legacyBibleResult = spawnSync(process.execPath, [resolve(plugin, 'scripts/project-store.mjs'), 'put-document', root, 'bible', await json(root, 'legacy-bible.json', legacyBible)], { encoding: 'utf8' })
    if (legacyBibleResult.status === 0 || !legacyBibleResult.stderr.includes('hidden_fact')) throw new Error('故事圣经旧 secret 字段未被合同层明确拒绝')
    const missingPromptRun = spawnSync(process.execPath, [resolve(plugin, 'scripts/skill-runs.mjs'), 'record', root, 'analysis', 'analyze-drama-source', '.short-drama/source-analysis.json'], { encoding: 'utf8' })
    if (missingPromptRun.status === 0 || !missingPromptRun.stderr.includes('缺少 codex-contract 提示词运行记录')) throw new Error('缺少提示词运行记录的 Skill 被错误登记')
    await recordSkills(root, 'analysis', '.short-drama/source-analysis.json')
    const sourceAnalysisPath = resolve(root, '.short-drama/source-analysis.json')
    const originalAnalysis = await readFile(sourceAnalysisPath, 'utf8')
    await writeFile(sourceAnalysisPath, `${originalAnalysis.trim()} \n`)
    const changedEvidence = spawnSync(process.execPath, [resolve(plugin, 'scripts/workflow.mjs'), 'advance', root, 'script'], { encoding: 'utf8' })
    if (changedEvidence.status === 0 || !changedEvidence.stderr.includes('证据无效或已变化')) throw new Error('Skill 证据篡改未被拒绝')
    await writeFile(sourceAnalysisPath, originalAnalysis)
    run('workflow.mjs', 'advance', root, 'script')
    await new Promise((done) => setTimeout(done, 5))
    run('project-store.mjs', 'select-source', root, 'src-story', 'v001')
    const replayedPrompt = spawnSync(process.execPath, [resolve(plugin, 'scripts/skill-runs.mjs'), 'record', root, 'analysis', 'analyze-drama-source', '.short-drama/source-analysis.json'], { encoding: 'utf8' })
    if (replayedPrompt.status === 0 || !replayedPrompt.stderr.includes('缺少 codex-contract 提示词运行记录')) throw new Error('阶段失效后仍可重放旧提示词凭证')
    await recordSkills(root, 'analysis', '.short-drama/source-analysis.json')
    run('workflow.mjs', 'advance', root, 'script')

    run('project-store.mjs', 'put-episode', root, await json(root, 'episode.json', { key: 'ep-001', title: '第一集', order: 1 }))
    await writeFile(resolve(root, 'script.md'), '# 第一集\n')
    run('project-store.mjs', 'put-script', root, 'ep-001', 'v001', resolve(root, 'script.md'))
    await writeFile(resolve(root, 'script-humanized.md'), '# 第一集\n\nA：别绕弯子。\n')
    run('project-store.mjs', 'put-script', root, 'ep-001', 'v002', resolve(root, 'script-humanized.md'))
    run('project-store.mjs', 'select-script', root, 'ep-001', 'v002', '.md')
    const scriptReview = { episode_key: 'ep-001', script_version: 'v002', dimensions: Object.fromEntries(['opening', 'pace', 'payoff', 'dialogue', 'continuity', 'production_feasibility'].map((key) => [key, { status: 'passed', note: '' }])), issues: [], compliance: { passed: true, issues: [] }, approved: true }
    run('project-store.mjs', 'put-episode-document', root, 'script-review', 'ep-001', 'v001', await json(root, 'script-review.json', scriptReview))
    run('project-store.mjs', 'select-episode-document', root, 'script-review', 'ep-001', 'v001')
    await recordSkills(root, 'script', 'episodes/ep-001/script-review/v001.json')
    run('workflow.mjs', 'advance', root, 'director-book')

    const director = { episode_key: 'ep-001', source_script_version: 'v002', scenes: [{ scene_key: 'scene-001', source_scene: '第一场', dramatic_objective: '建立冲突', beats: ['A 发问'], subtext: '试探', performance_direction: {}, blocking: {}, eyelines: {}, axis_rule: {}, camera_strategy: {}, lighting_and_color: {}, sound_plan: {}, transition_in: null, transition_out: null, continuity_state: {}, asset_requirements: [], prohibited_changes: [] }], continuity_ledger: [], open_questions: [] }
    run('project-store.mjs', 'put-episode-document', root, 'director-book', 'ep-001', 'v001', await json(root, 'director.json', director))
    run('project-store.mjs', 'select-episode-document', root, 'director-book', 'ep-001', 'v001')
    await recordSkills(root, 'director-book', 'episodes/ep-001/director-book/v001.json')
    run('workflow.mjs', 'advance', root, 'asset-analysis')

    const assetPlan = { episode_key: 'ep-001', characters: [{ key: 'char-a', type: 'character', name: 'A', evidence: [{ source: 'script', locator: '第一场', quote: 'A：别绕弯子。' }], visual_description: '外观未知，待确认', versions: [{ key: 'v001', label: '基础造型', trigger: '第一场', evidence: '剧本第一场' }], derived_from: null, status: 'ready', selected_version: 'v001' }], scenes: [], props: [], unresolved: [] }
    run('project-store.mjs', 'put-episode-document', root, 'asset-plan', 'ep-001', 'v001', await json(root, 'asset-plan.json', assetPlan))
    run('project-store.mjs', 'select-episode-document', root, 'asset-plan', 'ep-001', 'v001')
    run('project-store.mjs', 'put-episode-document', root, 'asset-plan', 'ep-001', 'v002', await json(root, 'asset-plan-v002.json', assetPlan))
    await writeFile(resolve(root, 'episodes/ep-001/asset-plan/v002.json'), `${JSON.stringify({ ...assetPlan, characters: [{ ...assetPlan.characters[0], evidence: [{}] }] }, null, 2)}\n`)
    const invalidSelection = spawnSync(process.execPath, [resolve(plugin, 'scripts/project-store.mjs'), 'select-episode-document', root, 'asset-plan', 'ep-001', 'v002'], { encoding: 'utf8' })
    if (invalidSelection.status === 0 || !invalidSelection.stderr.includes('顶层字段')) throw new Error('被篡改的文档仍可选版')
    const currentStyle = JSON.parse(run('project-store.mjs', 'project', root)).creative.art_style
    run('project-store.mjs', 'put-document', root, 'art-style', await json(root, 'art-style.json', { mode: 'confirmed-default', style: currentStyle, decision_reason: '确认使用项目默认真人风格', approved: true }))
    const planAsProfile = spawnSync(process.execPath, [resolve(plugin, 'scripts/skill-runs.mjs'), 'record', root, 'asset-analysis', 'generate-character-profiles', 'episodes/ep-001/asset-plan/v001.json'], { encoding: 'utf8' })
    if (planAsProfile.status === 0 || !planAsProfile.stderr.includes('证据类型无效')) throw new Error('资产计划被错误接受为人物档案证据')
    const characterProfile = { new_characters: [integrationCharacter], updated_characters: [] }
    run('character-profiles.mjs', 'validate', root, await json(root, 'character-profile.json', characterProfile))
    await recordSkills(root, 'asset-analysis', 'episodes/ep-001/asset-plan/v001.json')
    run('workflow.mjs', 'advance', root, 'asset-generation')
    try {
      await callGeneration('generate_image', { provider: 'starrouter', model: 'invalid-model', prompt: '路径边界测试', reference_paths: ['/etc/hosts'], reference_manifest: [], confirmed: true, project_root: root, target: 'char-outside', prompt_document: null })
      throw new Error('项目外上传路径未被拒绝')
    } catch (error) { if (!String(error.message).includes('assets/ 内文件')) throw error }
    try {
      await callGeneration('generate_image', { provider: 'starrouter', model: 'gpt-image-2', prompt: '失败请求也必须保留的提示词', reference_manifest: [], output_compression: 0, confirmed: true, project_root: root, target: 'other-failed', prompt_document: null })
      throw new Error('生成失败留档自检未触发')
    } catch (error) { if (!String(error.message).includes('正整数')) throw error }
    const failed = Object.values(JSON.parse(run('task-ledger.mjs', 'list', root)).tasks).find((task) => task.target === 'other-failed')
    const failedRequest = JSON.parse(await readFile(resolve(root, failed.requestPath), 'utf8'))
    if (failed.status !== 'failed' || failedRequest.arguments.prompt !== '失败请求也必须保留的提示词') throw new Error('失败生成请求未完整留档')
    try {
      await callGeneration('generate_image', { provider: 'starrouter', model: 'gpt-image-2', prompt: '没有对应提示词运行记录', reference_manifest: [], confirmed: true, project_root: root, target: 'char-a', prompt_document: { kind: 'asset-plan', episode_key: 'ep-001', version_id: 'v001', asset_key: 'char-a' } })
      throw new Error('无关图片提示词未被拒绝')
    } catch (error) { if (!String(error.message).includes('对应 Skill')) throw error }

    if (JSON.parse(run('skill-runs.mjs', 'required', root, 'asset-generation')).includes('generate-character-images')) throw new Error('可复用导入资产仍错误要求生成 Skill')
    const assetEvidence = run('snapshot-stage-evidence.mjs', root, 'asset-generation').trim()
    await recordSkills(root, 'asset-generation', assetEvidence)
    run('workflow.mjs', 'advance', root, 'production-plan')

    const storyboard = { episode_key: 'ep-001', source_versions: { director_book: 'v001' }, panels: [{ panel_number: 1, shot_number: 1, description: 'A 抬头发问', characters: [{ name: 'A' }], location: '测试场景', source_text: '别绕弯子。', duration: 5 }, { panel_number: 2, shot_number: 2, description: 'A 转身走向门口', characters: [{ name: 'A' }], location: '测试场景', source_text: 'A 转身走向门口。', duration: 5 }] }
    run('project-store.mjs', 'put-episode-document', root, 'storyboard', 'ep-001', 'v001', await json(root, 'storyboard.json', storyboard))
    run('project-store.mjs', 'select-episode-document', root, 'storyboard', 'ep-001', 'v001')
    const productionShot = { dependencies: [], image_strategy: { mode: 'generate', board_type: 'shot-board', panel_grid_size: 4, overflow_strategy: 'compose-assets' }, video_strategy: { mode: 'generate' }, audio_strategy: { mode: 'post-dub' }, provider: 'starrouter', model_or_workflow: 'dreamina-seedance-2-0-260128', prompt_profile: 'seedance2', input_mode: 'first-last-frame', duration_seconds: 5, resolution: '1080x1920', aspect_ratio: '9:16', candidate_count: 1, reference_assets: [{ key: 'char-a', version_id: 'v001', role: 'first_frame', order: 1 }], estimated_paid_calls: 1, fallback: {}, review_checks: ['visual'], status: 'ready' }
    const production = { episode_key: 'ep-001', source_versions: {}, shots: [1, 2].map((shot_number, index) => ({ shot_number, ...productionShot, image_strategy: { ...productionShot.image_strategy, board_type: index === 0 ? 'single' : 'storyboard', panel_grid_size: index === 0 ? 1 : 3 } })), totals: {}, unresolved: [], approved: true }
    const invalidGridSize = { ...production, shots: production.shots.map((shot, index) => index ? shot : { ...shot, image_strategy: { ...shot.image_strategy, panel_grid_size: 2 } }) }
    const invalidGridResult = spawnSync(process.execPath, [resolve(plugin, 'scripts/project-store.mjs'), 'put-episode-document', root, 'production-plan', 'ep-001', 'v009', await json(root, 'production-invalid-grid.json', invalidGridSize)], { encoding: 'utf8' })
    if (invalidGridResult.status === 0 || !invalidGridResult.stderr.includes('panel_grid_size 与分镜类型不匹配')) throw new Error('分镜类型与格数不一致未被拒绝')
    const invalidPreviz = { ...production, shots: production.shots.map((shot, index) => index ? shot : { ...shot, previz_strategy: { mode: 'blender', purpose: 'review', fps: 1 } }) }
    const invalidPrevizResult = spawnSync(process.execPath, [resolve(plugin, 'scripts/project-store.mjs'), 'put-episode-document', root, 'production-plan', 'ep-001', 'v008', await json(root, 'production-invalid-previz.json', invalidPreviz)], { encoding: 'utf8' })
    if (invalidPrevizResult.status === 0 || !invalidPrevizResult.stderr.includes('previz_strategy Blender 参数无效')) throw new Error('灰模预演参数错误未被拒绝')
    const unsupportedMotionReference = { ...production, shots: production.shots.map((shot) => ({ ...shot, storyboard_strategy: { mode: 'blender' }, image_strategy: { ...shot.image_strategy, mode: 'skip' }, previz_strategy: { mode: 'blender', purpose: 'motion-reference', fps: 12 } })) }
    const unsupportedMotionResult = spawnSync(process.execPath, [resolve(plugin, 'scripts/project-store.mjs'), 'put-episode-document', root, 'production-plan', 'ep-001', 'v006', await json(root, 'production-unsupported-motion-reference.json', unsupportedMotionReference)], { encoding: 'utf8' })
    if (unsupportedMotionResult.status === 0 || !unsupportedMotionResult.stderr.includes('不支持白模参考视频')) throw new Error('不支持参考视频的 Provider 仍接受 motion-reference')
    const blenderSelection = { ...production, shots: production.shots.map((shot) => ({ ...shot, storyboard_strategy: { mode: 'blender' }, image_strategy: { ...shot.image_strategy, mode: 'skip' }, previz_strategy: { mode: 'blender', purpose: 'review', fps: 12 } })) }
    run('project-store.mjs', 'put-episode-document', root, 'production-plan', 'ep-001', 'v007', await json(root, 'production-blender.json', blenderSelection))
    if ((await missingStoryboardAssets(root, 'ep-001', 'v001', blenderSelection.shots, JSON.parse(run('asset-ledger.mjs', 'list', root)))).length) throw new Error('白模分镜仍被错误要求图片分镜')
    run('project-store.mjs', 'select-episode-document', root, 'production-plan', 'ep-001', 'v007')
    const blenderSkills = JSON.parse(run('skill-runs.mjs', 'required', root, 'media-production'))
    if (blenderSkills.includes('generate-storyboard-images') || !blenderSkills.includes('direct-blender-previz') || !blenderSkills.includes('generate-blender-previz')) throw new Error('全白模分镜未正确切换媒体 Skill')
    run('project-store.mjs', 'put-episode-document', root, 'production-plan', 'ep-001', 'v001', await json(root, 'production.json', production))
    run('project-store.mjs', 'select-episode-document', root, 'production-plan', 'ep-001', 'v001')
    if (!JSON.parse(run('skill-runs.mjs', 'required', root, 'media-production')).includes('generate-storyboard-images')) throw new Error('媒体阶段未强制要求分镜图 Skill')
    const videoPrompts = {
      episode_key: 'ep-001', source_versions: { production_plan: 'v001', storyboard: 'v001' }, unresolved: [], approved: true,
      shots: [videoPromptText, videoPromptText2].map((prompt, index) => ({ shot_number: index + 1, production_plan_version: 'v001', storyboard_version: 'v001', provider: 'starrouter', model_or_workflow: 'dreamina-seedance-2-0-260128', prompt_profile: 'seedance2', input_mode: 'first-last-frame', prompt, duration: 5, references: referenceManifest, continuity: {}, audio_policy: { mode: 'post-dub' }, errors: [] })),
    }
    run('project-store.mjs', 'put-episode-document', root, 'video-prompts', 'ep-001', 'v001', await json(root, 'video-prompts.json', videoPrompts))
    run('project-store.mjs', 'select-episode-document', root, 'video-prompts', 'ep-001', 'v001')
    await recordSkills(root, 'production-plan', 'episodes/ep-001/production-plan/v001.json')
    run('workflow.mjs', 'advance', root, 'media-production')
    const audioPlan = { episode_key: 'ep-001', source_versions: { script: 'v002', storyboard: 'v001', production_plan: 'v001' }, audio_strategy: { mode: 'native-first', provider_selection: 'prefer-native', fallback_allowed: true, fallback_reasons: ['provider-no-native-audio', 'voice-identity-drift', 'speech-intelligibility-failed', 'narration-performance-failed', 'audio-sync-failed', 'native-ambience-failed'] }, lines: [{ line_index: 1, speaker: 'A', line_type: 'dialogue', content: '别绕弯子。', emotion: '克制', emotion_strength: 0.2, pronunciation_notes: [], matched_shot: { shot_number: 1 }, delivery_mode: 'post_dub', presentation: 'visible-dialogue', fallback_mode: 'post-dub', source_audio: null, voice_binding: { voice_id: 'male-qn-qingse' }, native_audio_exception: { reason: 'provider-no-native-audio', evidence: '当前锁定视频模型不支持原生音频', range: { start_ms: 0, end_ms: 5000 }, mix_sources: ['post-dub-dialogue', 'native-ambience-action'] }, performance: null }], voice_bindings: [{ speaker: 'A', provider: 'starrouter', model: 'speech-2.8-hd', voice_id: 'male-qn-qingse' }], music_tracks: [{ key: 'op', purpose: 'op', title: '片头曲', source_mode: 'generated', prompt: '紧张悬疑电子乐', tags: 'cinematic,electronic', lyrics: '', make_instrumental: true, provider: 'starrouter', model: 'suno_music', matched_shots: [1] }], unresolved: [], approved: true }
    run('project-store.mjs', 'put-episode-document', root, 'audio-plan', 'ep-001', 'v001', await json(root, 'audio-plan.json', audioPlan))
    run('project-store.mjs', 'select-episode-document', root, 'audio-plan', 'ep-001', 'v001')
    const boundVideo = { provider: 'starrouter', model: 'dreamina-seedance-2-0-260128', prompt_profile: 'seedance2', input_mode: 'first-last-frame', prompt_version: 'v001', prompt: videoPrompts.shots[0].prompt, duration: 5, frame_url: uploadReceipt.url, reference_manifest: videoPrompts.shots[0].references, confirmed: true, project_root: root, target: 'shot-ep001-001', prompt_document: { episode_key: 'ep-001', version_id: 'v001', shot_number: 1 } }
    try { await callGeneration('submit_video', boundVideo); throw new Error('缺少分镜图时仍可提交视频') } catch (error) { if (!String(error.message).includes('图片分镜镜头的生成与选版')) throw error }
    for (const shotNumber of [1, 2]) {
      const key = `board-ep001-${String(shotNumber).padStart(3, '0')}`
      const promptDocument = { kind: 'storyboard', episode_key: 'ep-001', version_id: 'v001', shot_number: shotNumber }
      const promptName = shotNumber === 1 ? 'single_panel_image' : 'panel_grid_image'
      const template = resolve(plugin, 'skills/generate-storyboard-images/assets/prompts', `${promptName}.zh.txt`)
      const templateText = await readFile(template, 'utf8')
      const vars = Object.fromEntries([...templateText.matchAll(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g)].map((match) => [match[1], match[1] === 'panel_grid_size' ? 3 : match[1] === 'grid_layout' ? '三格横排' : '测试']))
      const promptPath = resolve(root, `${key}-prompt.txt`)
      run('render-prompt.mjs', '--template', template, '--vars', await json(root, `${key}-vars.json`, vars), '--output', promptPath, '--project-root', root)
      const request = await snapshot(`board-task-${shotNumber}`, key, 'image', 'starrouter', 'generate_image', { model: 'gpt-image-2', prompt: await readFile(promptPath, 'utf8'), reference_manifest: [] }, promptDocument)
      run('task-ledger.mjs', 'put', root, await json(root, `${key}-task.json`, { taskId: `board-task-${shotNumber}`, target: key, type: 'image', provider: 'starrouter', requestPath: request.requestPath, status: 'running' }))
      run('asset-ledger.mjs', 'put', root, await json(root, `${key}.json`, { key, type: 'storyboard', name: `第${shotNumber}镜分镜图` }))
      await writeFile(resolve(root, `${key}.png`), `storyboard-fixture-${shotNumber}`)
      const provenance = await json(root, `${key}-provenance.json`, { origin: 'generated', created_by: 'provider', provider: 'starrouter', model_or_workflow: 'gpt-image-2', task_id: `board-task-${shotNumber}`, prompt_document: promptDocument, source_assets: [], parameters: {} })
      run('asset-ledger.mjs', 'import', root, key, resolve(root, `${key}.png`), 'v001', '-', provenance)
      run('asset-ledger.mjs', 'select', root, key, 'v001')
      run('task-ledger.mjs', 'update', root, `board-task-${shotNumber}`, 'completed', 'v001')
    }
    try { await callGeneration('submit_video', boundVideo); throw new Error('缺少分镜图审计时仍可提交视频') } catch (error) { if (!String(error.message).includes('图片分镜镜头的多维审计')) throw error }
    const storyboardCriteria = ['空间关系与轴线', '时间与动作连续性', '物理与交互逻辑', '光线与色彩连续性', '人物身份与造型一致性', '场景与道具一致性', '构图与镜头语言', '叙事覆盖与阅读顺序']
    for (const shotNumber of [1, 2]) run('review-ledger.mjs', 'put', root, await json(root, `board-review-${shotNumber}.json`, { assetKey: `board-ep001-${String(shotNumber).padStart(3, '0')}`, versionId: 'v001', visual: 'passed', audio: 'not-applicable', transition: 'not-applicable', captions: 'not-applicable', issues: [], criteria: storyboardCriteria.map((criterion) => ({ criterion, status: 'passed', observation: `${criterion}已有可见证据` })) }))
    const missingPreviz = await missingPrevizAssets(root, 'ep-001', 'v001', [{ shot_number: 1, previz_strategy: { mode: 'blender' } }], JSON.parse(run('asset-ledger.mjs', 'list', root)))
    if (missingPreviz.length !== 1 || !missingPreviz[0].includes('Blender 白模分镜')) throw new Error('白模分镜缺失门禁未生效')
    try { await callGeneration('submit_video', { ...boundVideo, prompt: '被篡改的提示词' }); throw new Error('视频提示词绑定自检未触发') } catch (error) { if (!String(error.message).includes('prompt 不一致')) throw error }
    try { await callGeneration('submit_video', { ...boundVideo, fps: 25 }); throw new Error('Seedance 参数自检未触发') } catch (error) { if (!String(error.message).includes('fps 仅支持 24')) throw error }
    const batchConfirmations = (({ service, expires_in, usage_scope, confirmed, rights_confirmed, public_exposure_confirmed, usage_terms_confirmed }) => ({ service, expires_in, usage_scope, confirmed, rights_confirmed, public_exposure_confirmed, usage_terms_confirmed }))(publishInput)
    const episodeUrls = await callGeneration('ensure_reference_urls', { project_root: root, episode_key: 'ep-001', ...batchConfirmations })
    if (episodeUrls.published.length !== 1 || !episodeUrls.published[0].reused || episodeUrls.published[0].asset_key !== 'char-a') throw new Error('整集参考 URL 批量复用失败')
    const episodePlan = await callGeneration('submit_episode_videos', { project_root: root, episode_key: 'ep-001', confirmed: false })
    if (!episodePlan.ready || episodePlan.phase !== 'plan' || episodePlan.shot_count !== 2 || episodePlan.shots.some((shot) => shot.error) || episodePlan.shots[0].model !== 'dreamina-seedance-2-0-260128') throw new Error(`整集批量费用摘要无效：${JSON.stringify(episodePlan.shots)}`)
    // 多格分镜板整张输入：语义参考位 + 双声明允许；首帧像素位拒绝；缺分镜板条款拒绝。
    // 发布前有图片嗅探，给 board-ep001-002 追加一个真实 1x1 PNG 版本并完成选版/审计
    await writeFile(resolve(root, 'board-ep001-002-v002.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'))
    // 按完整生成任务链登记 v002（带 storyboard 文档绑定和 Skill 提示词留痕，否则证据链不认）
    const boardV002Template = resolve(plugin, 'skills/generate-storyboard-images/assets/prompts', 'panel_grid_image.zh.txt')
    const boardV002Vars = Object.fromEntries([...(await readFile(boardV002Template, 'utf8')).matchAll(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g)].map((match) => [match[1], match[1] === 'panel_grid_size' ? 3 : match[1] === 'grid_layout' ? '三格横排' : '测试']))
    const boardV002PromptPath = resolve(root, 'board-task-2b-prompt.txt')
    run('render-prompt.mjs', '--template', boardV002Template, '--vars', await json(root, 'board-task-2b-vars.json', boardV002Vars), '--output', boardV002PromptPath, '--project-root', root)
    const boardV002Request = await snapshot('board-task-2b', 'board-ep001-002', 'image', 'starrouter', 'generate_image', { model: 'gpt-image-2', prompt: await readFile(boardV002PromptPath, 'utf8'), reference_manifest: [] }, { kind: 'storyboard', episode_key: 'ep-001', version_id: 'v001', shot_number: 2 })
    run('task-ledger.mjs', 'put', root, await json(root, 'board-task-2b.json', { taskId: 'board-task-2b', target: 'board-ep001-002', type: 'image', provider: 'starrouter', requestPath: boardV002Request.requestPath, status: 'running' }))
    const boardV002Provenance = await json(root, 'board-ep001-002-v002-provenance.json', { origin: 'generated', created_by: 'provider', provider: 'starrouter', model_or_workflow: 'gpt-image-2', task_id: 'board-task-2b', prompt_document: { kind: 'storyboard', episode_key: 'ep-001', version_id: 'v001', shot_number: 2 }, source_assets: [], parameters: {} })
    run('asset-ledger.mjs', 'import', root, 'board-ep001-002', resolve(root, 'board-ep001-002-v002.png'), 'v002', '-', boardV002Provenance)
    run('task-ledger.mjs', 'update', root, 'board-task-2b', 'completed', 'v002')
    run('asset-ledger.mjs', 'select', root, 'board-ep001-002', 'v002')
    run('review-ledger.mjs', 'put', root, await json(root, 'board-review-ep001-002-v002.json', { assetKey: 'board-ep001-002', versionId: 'v002', visual: 'passed', audio: 'not-applicable', transition: 'not-applicable', captions: 'not-applicable', issues: [], criteria: storyboardCriteria.map((criterion) => ({ criterion, status: 'passed', observation: `${criterion}已有可见证据` })) }))
    await publishReferenceImage(root, { ...publishInput, asset_key: 'board-ep001-002', version_id: 'v002' }, async () => new Response('https://litter.catbox.moe/board.png', { status: 200 }))
    const boardRole = (role) => [{ type: 'image', order: 1, asset_key: 'board-ep001-002', version_id: 'v002', role }]
    const panelDoc = (version, inputMode, role, withClause) => ({ episode_key: 'ep-001', source_versions: { production_plan: version, storyboard: 'v001' }, unresolved: [], approved: true, shots: [{ ...videoPrompts.shots[0], production_plan_version: version }, { shot_number: 2, production_plan_version: version, storyboard_version: 'v001', provider: 'starrouter', model_or_workflow: 'dreamina-seedance-2-0-260128', prompt_profile: 'seedance2', input_mode: inputMode, prompt: `${ANTI_GRID_CLAIM_ZH}\n${withClause ? `${PANEL_BOARD_CLAIM_ZH}\n` : ''}人物走向门口。\n${ANTI_GRID_CLAIM_ZH}`, duration: 5, references: boardRole(role), continuity: {}, audio_policy: { mode: 'post-dub' }, errors: [] }] })
    const putPanelVersion = async (version, inputMode, role, withClause) => {
      const panelProduction = { ...production, shots: production.shots.map((shot, index) => index === 0 ? shot : { ...shot, input_mode: inputMode, reference_assets: boardRole(role).map(({ asset_key: key, version_id, role: referenceRole, order }) => ({ key, version_id, role: referenceRole, order })) }) }
      run('project-store.mjs', 'put-episode-document', root, 'production-plan', 'ep-001', version, await json(root, `production-panel-${version}.json`, panelProduction))
      run('project-store.mjs', 'select-episode-document', root, 'production-plan', 'ep-001', version)
      const boardState = JSON.parse(run('asset-ledger.mjs', 'list', root, 'board-ep001-002'))
      run('asset-ledger.mjs', boardState.staleVersionIds?.includes('v002') ? 'restore' : 'select', root, 'board-ep001-002', 'v002')
      run('review-ledger.mjs', 'put', root, await json(root, `board-review-ep001-002-${version}.json`, { assetKey: 'board-ep001-002', versionId: 'v002', visual: 'passed', audio: 'not-applicable', transition: 'not-applicable', captions: 'not-applicable', issues: [], criteria: storyboardCriteria.map((criterion) => ({ criterion, status: 'passed', observation: `${criterion}已有可见证据` })) }))
      const documentToStore = panelDoc(version, inputMode, role, withClause)
      run('project-store.mjs', 'put-episode-document', root, 'video-prompts', 'ep-001', version, await json(root, `video-prompts-${version}.json`, documentToStore))
      run('project-store.mjs', 'select-episode-document', root, 'video-prompts', 'ep-001', version)
    }
    await putPanelVersion('v099', 'full-reference', 'reference_image', true)
    const panelAllowedPlan = await callGeneration('submit_episode_videos', { project_root: root, episode_key: 'ep-001', shot_numbers: [2], confirmed: false })
    if (!panelAllowedPlan.ready || panelAllowedPlan.shots[0].error) throw new Error(`多格分镜板语义参考输入被误拒：${JSON.stringify(panelAllowedPlan.shots[0])}`)
    await putPanelVersion('v098', 'first-last-frame', 'first_frame', true)
    const panelFramedPlan = await callGeneration('submit_episode_videos', { project_root: root, episode_key: 'ep-001', shot_numbers: [2], confirmed: false })
    if (panelFramedPlan.ready || !panelFramedPlan.shots[0].error?.includes('首帧/尾帧')) throw new Error(`多格分镜板像素槽位未拦截：${JSON.stringify(panelFramedPlan.shots[0])}`)
    await putPanelVersion('v097', 'full-reference', 'reference_image', false)
    const panelNoClaimPlan = await callGeneration('submit_episode_videos', { project_root: root, episode_key: 'ep-001', shot_numbers: [2], confirmed: false })
    if (panelNoClaimPlan.ready || !panelNoClaimPlan.shots[0].error?.includes('分镜板时间顺序条款')) throw new Error(`缺分镜板条款的多格板输入未拦截：${JSON.stringify(panelNoClaimPlan.shots[0])}`)
    run('project-store.mjs', 'select-episode-document', root, 'video-prompts', 'ep-001', 'v001')
    run('project-store.mjs', 'select-episode-document', root, 'production-plan', 'ep-001', 'v001')
    run('asset-ledger.mjs', 'restore', root, 'board-ep001-002', 'v002')
    run('review-ledger.mjs', 'put', root, await json(root, 'board-review-ep001-002-restored.json', { assetKey: 'board-ep001-002', versionId: 'v002', visual: 'passed', audio: 'not-applicable', transition: 'not-applicable', captions: 'not-applicable', issues: [], criteria: storyboardCriteria.map((criterion) => ({ criterion, status: 'passed', observation: `${criterion}已有可见证据` })) }))
    const boundFailure = Object.values(JSON.parse(run('task-ledger.mjs', 'list', root)).tasks).find((task) => task.target === 'shot-ep001-001' && task.status === 'failed')
    if (!boundFailure) throw new Error('通过文档绑定校验后的失败视频请求未留档')
    try {
      await callGeneration('generate_audio', { provider: 'starrouter', model: 'speech-2.8-hd', input: '被篡改的台词', voice: 'male-qn-qingse', speed: 1, response_format: 'flac', confirmed: true, project_root: root, target: 'audio-ep001-a', prompt_document: audioPromptReference })
      throw new Error('与 audio-plan 不一致的台词未被拒绝')
    } catch (error) { if (!String(error.message).includes('台词不一致')) throw error }
    try {
      await callGeneration('generate_music', { provider: 'starrouter', model: 'suno_music', prompt: '紧张悬疑电子乐', title: '错误标题', tags: 'cinematic,electronic', lyrics: '', make_instrumental: true, confirmed: true, project_root: root, target: 'audio-ep001-op', prompt_document: { kind: 'audio-plan', episode_key: 'ep-001', version_id: 'v001', track_key: 'op' } })
      throw new Error('与 audio-plan 不一致的音乐参数未被拒绝')
    } catch (error) { if (!String(error.message).includes('title 不一致')) throw error }
    const auxiliaryAudioTemplate = resolve(plugin, 'skills/design-drama-audio/assets/prompts/character_voice_recommend.zh.txt')
    const auxiliaryAudioText = await readFile(auxiliaryAudioTemplate, 'utf8')
    const auxiliaryAudioVars = Object.fromEntries([...auxiliaryAudioText.matchAll(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g)].map((match) => [match[1], '测试']))
    run('render-prompt.mjs', '--template', auxiliaryAudioTemplate, '--vars', await json(root, 'auxiliary-audio-vars.json', auxiliaryAudioVars), '--codex-output', resolve(root, 'episodes/ep-001/audio-plan/v001.json'), '--project-root', root)
    const auxiliaryAsCompletion = spawnSync(process.execPath, [resolve(plugin, 'scripts/skill-runs.mjs'), 'record', root, 'media-production', 'design-drama-audio', 'episodes/ep-001/audio-plan/v001.json'], { encoding: 'utf8' })
    if (auxiliaryAsCompletion.status === 0 || !auxiliaryAsCompletion.stderr.includes('缺少 codex-contract')) throw new Error('辅助提示词被错误接受为 Skill 完成合同')

    for (const [shotNumber, taskId, promptDocument] of [[1, 'task-a', videoPromptReference], [2, 'task-d', videoPromptReference2]]) {
      const key = `shot-ep001-${String(shotNumber).padStart(3, '0')}`
      run('asset-ledger.mjs', 'put', root, await json(root, `${key}.json`, { key, type: 'video', name: `第${shotNumber}镜` }))
      await writeFile(resolve(root, `${key}.mp4`), `fixture-${shotNumber}`)
      const videoProvenance = await json(root, `${key}-provenance.json`, { origin: 'generated', created_by: 'provider', provider: 'starrouter', model_or_workflow: 'dreamina-seedance-2-0-260128', task_id: taskId, prompt_document: promptDocument, source_assets: [{ key: 'char-a', version_id: 'v001' }], parameters: { duration: 5 } })
      run('asset-ledger.mjs', 'import', root, key, resolve(root, `${key}.mp4`), 'v001', '-', videoProvenance)
      run('task-ledger.mjs', 'update', root, taskId, 'completed', 'v001')
    }
    run('asset-ledger.mjs', 'put', root, await json(root, 'audio.json', { key: 'audio-ep001-a', type: 'audio', name: 'A 配音' }))
    await writeFile(resolve(root, 'audio.b64'), `data:audio/flac;base64,${Buffer.from('audio fixture').toString('base64')}\n`)
    const audioProvenance = await json(root, 'audio-provenance.json', { origin: 'generated', created_by: 'provider', provider: 'starrouter', model_or_workflow: 'speech-2.8-hd', task_id: 'task-c', prompt_document: audioPromptReference, source_assets: [], parameters: { voice: 'male-qn-qingse', speed: 1, response_format: 'flac' } })
    run('asset-ledger.mjs', 'decode', root, 'audio-ep001-a', resolve(root, 'audio.b64'), 'v001', '-', audioProvenance)
    run('asset-ledger.mjs', 'select', root, 'audio-ep001-a', 'v001')
    run('task-ledger.mjs', 'update', root, 'task-c', 'completed', 'v001')

    for (const shotNumber of [1, 2]) {
      const continuity = Object.fromEntries(['identity', 'screen_direction', 'facing_and_gaze', 'entry_exit', 'end_state'].map((field) => [field, { status: 'passed', observation: `${field} 与前后镜合同一致` }]))
      const shotReview = { assetKey: `shot-ep001-${String(shotNumber).padStart(3, '0')}`, versionId: 'v001', watchedFull: true, watch_evidence: { duration_seconds: 5, start: '主体进入动作', middle: '动作连续', end: '尾帧状态稳定' }, continuity, visual: 'passed', audio: 'not-applicable', transition: 'passed', captions: 'not-applicable', issues: [], criteria: [{ criterion: 'visual', status: 'passed', observation: '主体与动作符合计划' }] }
      run('review-ledger.mjs', 'put', root, await json(root, `shot-review-${shotNumber}.json`, shotReview))
      const selectedAfterReview = JSON.parse(run('asset-ledger.mjs', 'list', root, shotReview.assetKey)).selectedVersionId
      if (selectedAfterReview !== shotReview.versionId) throw new Error('候选验收通过后未自动选版')
    }
    const mediaEvidence = run('snapshot-stage-evidence.mjs', root, 'media-production').trim()
    await recordSkills(root, 'media-production', mediaEvidence)
    run('workflow.mjs', 'advance', root, 'editing')

    const timeline = {
      episode_key: 'ep-001', fps: 24, width: 1080, height: 1920,
      segments: [
        { shot_key: 'shot-ep001-001', asset_key: 'shot-ep001-001', version_id: 'v001', source_in_ms: 0, source_out_ms: 1000, timeline_start_ms: 0, timeline_end_ms: 1000, dialogue_sync: 'offscreen', transition: { type: 'none', duration_frames: 0 } },
        { shot_key: 'shot-ep001-002', asset_key: 'shot-ep001-002', version_id: 'v001', source_in_ms: 0, source_out_ms: 1000, timeline_start_ms: 1000, timeline_end_ms: 2000, transition: { type: 'hard-cut', duration_frames: 0 } },
      ],
      audio_tracks: [{ asset_key: 'audio-ep001-a', version_id: 'v001', role: 'dialogue', source_in_ms: 0, source_out_ms: 1000, timeline_start_ms: 0, timeline_end_ms: 1000, volume_envelope: [{ time_ms: 0, gain_db: 0 }, { time_ms: 1000, gain_db: 0 }] }],
      subtitles: [{ text: '别绕弯子。', startMs: 0, endMs: 900, timestampMs: 0, confidence: 1, speaker: 'A' }],
      subtitle_source: { method: 'manual-transcription', reviewed: true, source_assets: [{ asset_key: 'audio-ep001-a', version_id: 'v001' }] },
      sound_design_exception: { confirmed: true, reason: '集成夹具仅验证对白合同' },
      duration_exception: { user_confirmed: true, reason: '集成夹具使用两秒时间线' },
      labels: [], mix: { target_lufs: -15, true_peak_dbtp: -1 },
    }
    run('editing-store.mjs', 'put-timeline', root, await json(root, 'timeline-incomplete.json', { ...timeline, segments: timeline.segments.slice(0, 1) }))
    const editReview = { episode_key: 'ep-001', watchedFull: true, narrative: 'passed', visual: 'passed', audio: 'passed', transitions: 'passed', captions: 'passed', technical: 'passed', observations: { narrative: '故事完整', visual: '画面清晰', audio: '对白清楚', transitions: '切点自然', captions: '字幕准确', technical: '参数合格' }, issues: [], approved: true, qc: { version: 1, passed: true, blockers: [], video_sha256: createHash('sha256').update('final').digest('hex'), duration_ms: 2000, video: { width: 1080, height: 1920 }, audio: true } }
    const failedEditReview = { ...editReview, audio: 'failed', issues: [{ severity: 'P1', message: '对白不可辨' }], approved: false }
    run('editing-store.mjs', 'put-review', root, 'ep-001', await json(root, 'editing-review-failed.json', failedEditReview))
    const rejectedManifest = spawnSync(process.execPath, [resolve(plugin, 'scripts/editing-store.mjs'), 'manifest', root, 'ep-001', 'delivery/ep-001/final.mp4', 'delivery/ep-001/final.srt', 'delivery/ep-001/final.ass'], { encoding: 'utf8' })
    if (rejectedManifest.status === 0 || !rejectedManifest.stderr.includes('审片未通过')) throw new Error('未通过完整审片仍生成了 manifest')
    run('editing-store.mjs', 'put-review', root, 'ep-001', await json(root, 'editing-review.json', editReview))
    await recordSkills(root, 'editing', 'editing/ep-001/timeline.json')
    const incompleteTimeline = spawnSync(process.execPath, [resolve(plugin, 'scripts/workflow.mjs'), 'advance', root, 'delivery'], { encoding: 'utf8' })
    if (incompleteTimeline.status === 0 || !incompleteTimeline.stderr.includes('未按制作计划完整覆盖镜头顺序')) throw new Error('不完整时间线通过了剪辑门禁')
    run('editing-store.mjs', 'put-timeline', root, await json(root, 'timeline-input.json', timeline))
    await recordSkills(root, 'editing', 'editing/ep-001/timeline.json')
    run('workflow.mjs', 'advance', root, 'delivery')
    await writeFile(resolve(root, 'delivery/ep-001/final.mp4'), 'final')
    await writeFile(resolve(root, 'delivery/ep-001/final.srt'), 'subtitle')
    await writeFile(resolve(root, 'delivery/ep-001/final.ass'), 'subtitle')
    run('editing-store.mjs', 'manifest', root, 'ep-001', 'delivery/ep-001/final.mp4', 'delivery/ep-001/final.srt', 'delivery/ep-001/final.ass')
    await recordSkills(root, 'delivery', 'delivery/ep-001/manifest.json')
    const completed = JSON.parse(run('workflow.mjs', 'complete', root))
    if (!completed.finishedAt || completed.completed.at(-1) !== 'delivery') throw new Error('工作流终态失败')
    run('validate-project.mjs', root)
    const assetsPath = resolve(root, '.short-drama/assets.json')
    const storedAssets = await readFile(assetsPath, 'utf8')
    const missingAudioReference = JSON.parse(storedAssets)
    missingAudioReference.assets['audio-ep001-a'].versions[0].provenance.prompt_document = null
    await writeFile(assetsPath, `${JSON.stringify(missingAudioReference, null, 2)}\n`)
    const rejectedAudioReference = spawnSync(process.execPath, [resolve(plugin, 'scripts/validate-project.mjs'), root], { encoding: 'utf8' })
    if (rejectedAudioReference.status === 0 || !rejectedAudioReference.stderr.includes('生成audio缺少匹配的制作文档来源')) throw new Error('离线校验未拒绝缺少 audio-plan 行引用的生成音频')
    await writeFile(assetsPath, storedAssets)
    const receiptPath = resolve(root, uploadReceipt.receipt_path)
    const storedReceipt = await readFile(receiptPath, 'utf8')
    await writeFile(receiptPath, `${JSON.stringify({ ...JSON.parse(storedReceipt), url: 'https://example.com/fake.png' }, null, 2)}\n`)
    const rejectedReceipt = spawnSync(process.execPath, [resolve(plugin, 'scripts/validate-project.mjs'), root], { encoding: 'utf8' })
    if (rejectedReceipt.status === 0 || !rejectedReceipt.stderr.includes('Litterbox URL 无效')) throw new Error('离线校验未拒绝伪造的临时上传 URL')
    await writeFile(receiptPath, storedReceipt)
    await writeFile(resolve(root, 'delivery/ep-001/final.mp4'), 'changed')
    const changedDelivery = spawnSync(process.execPath, [resolve(plugin, 'scripts/workflow.mjs'), 'complete', root], { encoding: 'utf8' })
    if (changedDelivery.status === 0 || !changedDelivery.stderr.includes('manifest')) throw new Error('完成后交付篡改未被拒绝')
    await writeFile(resolve(root, 'delivery/ep-001/final.mp4'), 'final')
    const storedTimeline = await readFile(resolve(root, 'editing/ep-001/timeline.json'), 'utf8')
    await writeFile(resolve(root, 'editing/ep-001/timeline.json'), `${storedTimeline.trim()} \n`)
    const changedInput = spawnSync(process.execPath, [resolve(plugin, 'scripts/workflow.mjs'), 'complete', root], { encoding: 'utf8' })
    if (changedInput.status === 0 || !changedInput.stderr.includes('交付输入 timeline 已变化')) throw new Error('交付输入篡改未被拒绝')
    await writeFile(resolve(root, 'editing/ep-001/timeline.json'), storedTimeline)
    const promptsV2 = { ...videoPrompts, shots: videoPrompts.shots.map((shot) => shot.shot_number === 2 ? { ...shot, prompt: `${shot.prompt}\n镜尾停住。`, production_plan_version: 'v001', storyboard_version: 'v001' } : { ...shot, production_plan_version: 'v001', storyboard_version: 'v001' }) }
    run('project-store.mjs', 'put-episode-document', root, 'video-prompts', 'ep-001', 'v002', await json(root, 'video-prompts-v002.json', promptsV2))
    run('project-store.mjs', 'select-episode-document', root, 'video-prompts', 'ep-001', 'v002')
    const shotAssetsAfterPromptChange = JSON.parse(run('asset-ledger.mjs', 'list', root)).assets
    if (shotAssetsAfterPromptChange['shot-ep001-001'].selectedVersionId !== 'v001' || shotAssetsAfterPromptChange['shot-ep001-002'].selectedVersionId !== null || JSON.parse(run('workflow.mjs', 'status', root)).stage !== 'delivery') throw new Error('按镜头失效错误影响了未修改镜头或全局阶段')
    const changedStyle = { ...currentStyle, id: 'custom-test', name: '测试新画风', prompt: `${currentStyle.prompt} New style.` }
    run('project-store.mjs', 'update-project', root, await json(root, 'style-update.json', { creative: { art_style: changedStyle } }))
    if (JSON.parse(run('workflow.mjs', 'status', root)).stage !== 'asset-analysis') throw new Error('画风变更后未回退资产分析阶段')
    const staleSelection = spawnSync(process.execPath, [resolve(plugin, 'scripts/asset-ledger.mjs'), 'select', root, 'char-a', 'v001'], { encoding: 'utf8' })
    if (staleSelection.status === 0 || !staleSelection.stderr.includes('上游变更失效')) throw new Error('旧画风资产仍可被选中')

    run('project-store.mjs', 'put-episode', root, await json(root, 'episode-2.json', { key: 'ep-002', title: '第二集', order: 2 }))
    if (JSON.parse(run('workflow.mjs', 'status', root)).stage !== 'script') throw new Error('新增分集后未自动回退到剧本阶段')
    run('asset-ledger.mjs', 'put', root, await json(root, 'shot-2.json', { key: 'shot-ep002-001', type: 'video', name: '第二集第一镜' }))
    await writeFile(resolve(root, 'shot-2.mp4'), 'fixture-2')
    const shot2Provenance = await json(root, 'shot-2-provenance.json', { origin: 'imported', created_by: 'user', provider: null, model_or_workflow: null, task_id: null, prompt_document: { episode_key: 'ep-002', version_id: 'v001', shot_number: 1 }, source_assets: [], parameters: {} })
    run('asset-ledger.mjs', 'import', root, 'shot-ep002-001', resolve(root, 'shot-2.mp4'), 'v001', '-', shot2Provenance)
    run('asset-ledger.mjs', 'select', root, 'shot-ep002-001', 'v001')
    run('review-ledger.mjs', 'put', root, await json(root, 'shot-2-review.json', { assetKey: 'shot-ep002-001', versionId: 'v001', visual: 'passed', audio: 'not-applicable', transition: 'passed', captions: 'not-applicable', issues: [], criteria: [{ criterion: 'visual', status: 'passed', observation: '主体与动作符合计划' }] }))
    const timeline2 = { episode_key: 'ep-002', fps: 24, width: 1080, height: 1920, duration_exception: { user_confirmed: true, reason: '集成夹具使用一秒时间线' }, segments: [{ shot_key: 'shot-ep002-001', asset_key: 'shot-ep002-001', version_id: 'v001', source_in_ms: 0, source_out_ms: 1000, timeline_start_ms: 0, timeline_end_ms: 1000, transition: { type: 'none', duration_frames: 0 } }], audio_tracks: [], subtitles: [], labels: [], mix: null }
    run('editing-store.mjs', 'put-timeline', root, await json(root, 'timeline-2.json', timeline2))
    const editReview2 = { ...editReview, episode_key: 'ep-002', qc: { ...editReview.qc, video_sha256: createHash('sha256').update('final-2').digest('hex'), duration_ms: 1000 } }
    run('editing-store.mjs', 'put-review', root, 'ep-002', await json(root, 'editing-review-2.json', editReview2))
    for (const [name, content] of [['final.mp4', 'final-2'], ['final.srt', 'subtitle-2'], ['final.ass', 'subtitle-2']]) await writeFile(resolve(root, 'delivery/ep-002', name), content)
    run('editing-store.mjs', 'manifest', root, 'ep-002', 'delivery/ep-002/final.mp4', 'delivery/ep-002/final.srt', 'delivery/ep-002/final.ass')
    await Promise.all(['ep-001', 'ep-002'].map((episode) => readFile(resolve(root, 'delivery', episode, 'manifest.json'))))
    console.log('ok')
  } finally { await rm(root, { recursive: true, force: true }) }
}

main().catch((error) => { console.error(error.message); process.exitCode = 1 })
