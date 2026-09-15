#!/usr/bin/env node
import { access, readdir, readFile } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { injectPromptSystemVars, systemVariableNames } from './prompt-system-vars.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const map = JSON.parse(await readFile(resolve(root, 'references/skill-map.json'), 'utf8'))
const failures = []

for (const path of ['.DS_Store', '.playwright-mcp']) {
  try {
    await access(resolve(root, path))
    // 发布包由 git archive 生成；被 Git 明确忽略的本地缓存不会进入插件包，不应造成审计误报。
    if (spawnSync('git', ['-C', root, 'check-ignore', '-q', '--', path]).status !== 0) failures.push(`插件包包含未忽略的本地临时文件：${path}`)
  } catch {}
}

for (const path of ['README.md', 'LICENSE', '.codex-plugin/plugin.json', '.claude-plugin/plugin.json', '.claude-plugin/marketplace.json', '.claude-plugin/mcp.json', '.github/workflows/ci.yml', '.github/workflows/release.yml', '.github/workflows/upstream-sync.yml', 'references/project-spec-v1.md', 'references/codex-contracts.md', 'scripts/check-update.mjs', 'scripts/validate-project.mjs', 'scripts/skill-runs.mjs', 'scripts/preflight.mjs', 'scripts/blender-previz.py', 'scripts/previz-contract.mjs', 'scripts/previz-self-check.mjs', 'scripts/generation/live-smoke-test.mjs', 'scripts/document-reference.mjs', 'scripts/reference-bindings.mjs', 'scripts/media-hosting/litterbox.mjs', 'scripts/media-hosting/publish.mjs']) {
  try { await access(resolve(root, path)) } catch { failures.push(`缺少项目规范组件：${path}`) }
}

for (const path of ['skills/plan-shot-continuity/SKILL.md', 'skills/plan-shot-continuity/agents/openai.yaml', 'skills/plan-shot-continuity/assets/prompts/continuity_plan.zh.txt', 'skills/plan-shot-continuity/assets/prompts/continuity_plan.en.txt']) {
  try { await access(resolve(root, path)) } catch { failures.push(`跨镜连续性能力缺少：${path}`) }
}

const codexManifest = JSON.parse(await readFile(resolve(root, '.codex-plugin/plugin.json'), 'utf8'))
const claudeManifest = JSON.parse(await readFile(resolve(root, '.claude-plugin/plugin.json'), 'utf8'))
const claudeMarketplace = JSON.parse(await readFile(resolve(root, '.claude-plugin/marketplace.json'), 'utf8'))
const claudeMcp = JSON.parse(await readFile(resolve(root, '.claude-plugin/mcp.json'), 'utf8'))
if (codexManifest.version !== claudeManifest.version || codexManifest.version !== claudeMarketplace.plugins?.[0]?.version) failures.push('Codex、Claude 与 marketplace 版本不一致')
for (const manifest of [codexManifest, claudeManifest]) if (manifest.license !== 'MIT' || manifest.repository !== 'https://github.com/854771076/oh-my-short-drama') failures.push('插件清单缺少许可证或仓库地址')
if (claudeMarketplace.plugins?.[0]?.source !== './') failures.push('Claude marketplace 必须从仓库根目录加载插件')
if (claudeManifest.mcpServers !== './.claude-plugin/mcp.json') failures.push('Claude 插件未绑定专用 MCP 配置')
if (!claudeMcp.mcpServers?.['drama-generation']?.args?.[0]?.startsWith('${CLAUDE_PLUGIN_ROOT}/')) failures.push('Claude MCP 未使用 CLAUDE_PLUGIN_ROOT 定位脚本')
const hooks = JSON.parse(await readFile(resolve(root, 'hooks/hooks.json'), 'utf8'))
if (!JSON.stringify(hooks).includes('/scripts/check-update.mjs')) failures.push('SessionStart 未启用内部版本检查')

async function files(directory) {
  const output = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) output.push(...await files(path))
    else output.push(path)
  }
  return output
}

const skillNames = (await readdir(resolve(root, 'skills'), { withFileTypes: true }))
  .filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()
const declaredSkills = [...map.workflow, ...map.support].sort()
if (new Set(declaredSkills).size !== declaredSkills.length) failures.push('workflow/support 存在重复 Skill')
for (const name of skillNames.filter((name) => !declaredSkills.includes(name))) failures.push(`未声明 Skill：${name}`)
for (const name of declaredSkills.filter((name) => !skillNames.includes(name))) failures.push(`缺少 Skill：${name}`)
for (const [stage, names] of Object.entries(map.stages || {})) {
  if (!Array.isArray(names) || names.length === 0) failures.push(`阶段缺少 Skill：${stage}`)
  for (const name of names || []) if (!skillNames.includes(name)) failures.push(`阶段映射到不存在的 Skill：${stage} -> ${name}`)
}
for (const name of skillNames) {
  try { await access(resolve(root, 'skills', name, 'SKILL.md')) } catch { failures.push(`缺少 SKILL.md：${name}`) }
  try { await access(resolve(root, 'skills', name, 'agents/openai.yaml')) } catch { failures.push(`缺少 agents/openai.yaml：${name}`) }
  try {
    const skill = await readFile(resolve(root, 'skills', name, 'SKILL.md'), 'utf8')
    if (!/^---\s*\n[\s\S]*?^name:\s*\S+[\s\S]*?^description:\s*\S+/m.test(skill)) failures.push(`Skill 缺少 Hermes 兼容的 name/description：${name}`)
    if (/node scripts\/[A-Za-z0-9_./-]+\.mjs/.test(skill)) failures.push(`Skill 脚本路径未兼容插件安装目录：${name}`)
  } catch {}
  try {
    const metadata = await readFile(resolve(root, 'skills', name, 'agents/openai.yaml'), 'utf8')
    if (/Help with .* tasks/.test(metadata)) failures.push(`Skill UI 元数据仍是占位内容：${name}`)
  } catch {}
}

const expectedPrompts = Object.entries(map.prompts).flatMap(([name, skill]) => ['zh', 'en'].map((locale) => `${skill}/assets/prompts/${name}.${locale}.txt`)).sort()
const actualPrompts = (await files(resolve(root, 'skills')))
  .filter((path) => path.includes(`${resolve(root, 'skills')}/`) && path.includes('/assets/prompts/'))
  .map((path) => relative(resolve(root, 'skills'), path)).sort()
for (const path of actualPrompts.filter((path) => !expectedPrompts.includes(path))) failures.push(`未映射提示词：${path}`)
for (const path of expectedPrompts.filter((path) => !actualPrompts.includes(path))) failures.push(`缺少提示词：${path}`)
const promptVariables = (content) => [...new Set([...content.matchAll(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g)].map((match) => match[1]))].sort()
const unsupportedProfessionalRule = /(?:特写镜头必须使用固定镜头|特写镜头中使用任何镜头运动|对话镜头必须使用浅景深|极浅景深，背景完全虚化|1[–-]2\s*帧短促微震|至少\s*80%\s*镜头|约\s*70%\s*镜头|close-ups use a static camera|dialogue shots? must use (?:a )?shallow depth of field|background completely (?:blurred|separated)|brief\s+1[–-]2 frame micro-shake|at least\s*80%\s*of shots|roughly\s*70%\s*(?:of )?shots)/i
if (!unsupportedProfessionalRule.test('特写镜头必须使用固定镜头') || !unsupportedProfessionalRule.test('brief 1–2 frame micro-shake') || unsupportedProfessionalRule.test('特写默认固定，但可为动作跟随而移动')) failures.push('摄影硬规则审计器自检失败')
for (const [prompt, skill] of Object.entries(map.prompts)) {
  if (!skillNames.includes(skill)) failures.push(`提示词映射到不存在的 Skill：${prompt} -> ${skill}`)
  else {
    const entrypoint = await readFile(resolve(root, 'skills', skill, 'SKILL.md'), 'utf8')
    if (!entrypoint.includes(prompt)) failures.push(`Skill 未引用自己的提示词：${skill} -> ${prompt}`)
    const zh = await readFile(resolve(root, 'skills', skill, 'assets/prompts', `${prompt}.zh.txt`), 'utf8')
    const en = await readFile(resolve(root, 'skills', skill, 'assets/prompts', `${prompt}.en.txt`), 'utf8')
    if (JSON.stringify(promptVariables(zh)) !== JSON.stringify(promptVariables(en))) failures.push(`中英文提示词变量不一致：${prompt}`)
    for (const [locale, content] of [['zh', zh], ['en', en]]) {
      const injected = injectPromptSystemVars(content, locale)
      const unresolvedSystem = promptVariables(injected).filter((name) => systemVariableNames.has(name))
      if (unresolvedSystem.length) failures.push(`系统变量未注入：${prompt}.${locale} -> ${unresolvedSystem.join(', ')}`)
      const dynamicVars = Object.fromEntries(promptVariables(injected).map((name) => [name, 'AUDIT_VALUE']))
      const rendered = injected.replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, name) => dynamicVars[name])
      if (promptVariables(rendered).length) failures.push(`提示词仍有悬空变量：${prompt}.${locale}`)
    }
    if (/(?:director[-_ ]desk|director_shot|active_camera|projectGuidance|assetNodeRefs|sourceNodeId|characterNodeIds|locationNodeId|propNodeIds|storyboardId|src\/app\/api|novel-promotion|OmniVoice|CosyVoice|系统自动添加|风格由系统|target 10[–-]14 shots|整集目标 10[–-]14 镜)/i.test(`${zh}\n${en}`)) {
      failures.push(`提示词残留系统耦合：${prompt}`)
    }
    if (unsupportedProfessionalRule.test(`${zh}\n${en}`)) {
      failures.push(`提示词残留无普适依据的摄影硬规则：${prompt}`)
    }
  }
}

for (const locale of ['zh', 'en']) {
  const bible = await readFile(resolve(root, `skills/design-drama-bible/assets/prompts/ai_story_expand.${locale}.txt`), 'utf8')
  if (!bible.includes('hidden_fact') || /\bfear,\s*secret,\s*arc_start\b/.test(bible)) failures.push(`故事圣经人物合同与密钥校验冲突：${locale}`)
}

const videoPromptRoot = resolve(root, 'skills/write-drama-video-prompts/assets/prompts')
const videoPromptSkill = await readFile(resolve(root, 'skills/write-drama-video-prompts/SKILL.md'), 'utf8')
for (const token of ['errors', 'episode_key,source_versions,shots,unresolved,approved', 'production_plan_version', 'storyboard_version', '禁止省略']) if (!videoPromptSkill.replace(/[`{}\s]/g, '').includes(token.replace(/[`{}\s]/g, ''))) failures.push(`视频提示词 Skill 缺少落盘合同：${token}`)
for (const locale of ['zh', 'en']) {
  const seedance = await readFile(resolve(videoPromptRoot, `seedance2_video.${locale}.txt`), 'utf8')
  for (const token of ['seedance2', 'first-last-frame', 'full-reference', '@图片1', '@视频1', '@音频1', '4–15', '12']) {
    if (!seedance.includes(token)) failures.push(`Seedance 2.0 提示词缺少合同：${locale} -> ${token}`)
  }
  const h3 = await readFile(resolve(videoPromptRoot, `h3_video.${locale}.txt`), 'utf8')
  for (const token of ['T2VA', 'I2VA', 'FL2VA', 'L2VA', 'Ref2VA', 'subject_definitions', 'retention_analysis', 'detailed_description', 'overall_soundscape', 'non_diegetic_music', '<d>[Language]', 'source medium']) {
    if (!h3.includes(token)) failures.push(`H3 提示词缺少合同：${locale} -> ${token}`)
  }
  if (h3.includes('@图片1')) failures.push(`H3 提示词混入 Seedance 引用语法：${locale}`)
}

for (const locale of ['zh', 'en']) {
  const board = await readFile(resolve(root, `skills/generate-storyboard-images/assets/prompts/panel_storyboard_image.${locale}.txt`), 'utf8')
  const token = locale === 'zh' ? '成片目标媒介' : 'target delivery medium'
  if (!board.includes(token)) failures.push(`分镜板主画面未绑定项目成片媒介：${locale}`)
}

const promptIndexLines = (await readFile(resolve(root, 'references/prompt-skill-index.md'), 'utf8')).split(/\r?\n/)
for (const [prompt, skill] of Object.entries(map.prompts)) {
  const basename = prompt.split('/').at(-1)
  if (!promptIndexLines.some((line) => line.includes(`\`${basename}\``) && line.includes(`\`${skill}\``))) {
    failures.push(`提示词索引不一致：${prompt} -> ${skill}`)
  }
}

const docs = [...await files(resolve(root, 'skills')), ...await files(resolve(root, 'references'))]
  .filter((path) => path.endsWith('.md'))
for (const path of docs) {
  const content = await readFile(path, 'utf8')
  for (const match of content.matchAll(/`(scripts\/[A-Za-z0-9_./-]+)`/g)) {
    try { await access(resolve(root, match[1])) } catch { failures.push(`失效脚本引用：${relative(root, path)} -> ${match[1]}`) }
  }
  if (/(?:src\/app\/api|src\/lib\/|novel-promotion|director-desk|operate-drama-canvas|produce-meme-drama|generate-drama-covers|generate-drama-images)/i.test(content)) {
    failures.push(`残留系统耦合：${relative(root, path)}`)
  }
}

const projectStore = await readFile(resolve(root, 'scripts/project-store.mjs'), 'utf8')
const promptRenderer = await readFile(resolve(root, 'scripts/render-prompt.mjs'), 'utf8')
const workflowGates = await readFile(resolve(root, 'scripts/workflow-gates.mjs'), 'utf8')
const workflow = await readFile(resolve(root, 'scripts/workflow.mjs'), 'utf8')
const editingStore = await readFile(resolve(root, 'scripts/editing-store.mjs'), 'utf8')
const assetLedger = await readFile(resolve(root, 'scripts/asset-ledger.mjs'), 'utf8')
const reviewLedger = await readFile(resolve(root, 'scripts/review-ledger.mjs'), 'utf8')
const starrouter = await readFile(resolve(root, 'scripts/generation/starrouter.mjs'), 'utf8')
const runninghub = await readFile(resolve(root, 'scripts/generation/runninghub.mjs'), 'utf8')
const comfly = await readFile(resolve(root, 'scripts/generation/comfly.mjs'), 'utf8')
for (const token of ['schema_version', 'validate-project-config', 'put-source', 'select-source', 'hidden_fact', 'v001']) if (!projectStore.includes(token)) failures.push(`项目规范实现缺少：${token}`)
for (const token of ['environment.json', 'RESUME.md', 'prompt-runs', "'art-style'", 'staleVersionIds', 'migrate-project-layout']) if (!projectStore.includes(token)) failures.push(`项目恢复/预检实现缺少：${token}`)
for (const token of ['assets.json', 'tasks.json', 'shot-reviews.json', 'normalizeModelParameters', '必须与 format.aspect_ratio 一致']) if (!projectStore.includes(token)) failures.push(`项目初始化或配置门禁缺少：${token}`)
for (const token of ["new Set(['single', 'storyboard', 'shot-board'])", "storyboard: { type: 'shot-board', default_panel_grid_size: 4, preferred_medium: 'blender' }"]) if (!projectStore.includes(token)) failures.push(`分镜类型或初始化默认值缺少：${token}`)
for (const token of ['storyboard_strategy.mode 必须为 image 或 blender', '图片分镜必须生成 image_strategy', '白模分镜必须跳过图片并启用 Blender', 'panel_grid_size 与分镜类型不匹配', 'previz_strategy Blender 参数无效']) if (!projectStore.includes(token)) failures.push(`分镜或白模预演合同缺少：${token}`)
for (const token of ['prompt-runs', 'templateSha256', 'resolvedContractOrPrompt', 'codexOutputSha256', 'variables', '--project-root', '--codex-output', 'providerPrompts', 'existingInside']) if (!promptRenderer.includes(token)) failures.push(`提示词留痕实现缺少：${token}`)
for (const token of ['selectedDocumentRecord', 'storyboardMedium', 'missingStoryboardReviews', 'missingPrevizAssets', 'missingPrevizReviews', 'selected Blender 白模分镜及导演合同', 'Blender 白模分镜导演验收', '分镜图八维审计', '制作计划与分镜镜号不一致', '视频提示词来源不是当前镜头内容', "stage === 'delivery'", "editing', episode", "delivery', episode", 'evidenceSha256', 'invalidatedAt', 'art-style.json', 'staleVersionIds']) if (!workflowGates.includes(token)) failures.push(`工作流硬门禁缺少：${token}`)
for (const token of ["command === 'complete'", 'finishedAt']) if (!workflow.includes(token)) failures.push(`工作流终态缺少：${token}`)
for (const token of ['audio_tracks', 'volume_envelope', 'target_lufs', 'true_peak_dbtp', 'timestampMs', 'confidence', 'labels']) if (!editingStore.includes(token)) failures.push(`剪辑合同缺少：${token}`)
const providerPrompts = new Set(map.provider_prompts || [])
for (const prompt of providerPrompts) if (!(prompt in map.prompts)) failures.push(`Provider 提示词未登记：${prompt}`)
for (const [skill, prompts] of Object.entries(map.completion_prompts || {})) {
  if (!Array.isArray(prompts) || prompts.length === 0) failures.push(`完成合同列表为空：${skill}`)
  for (const prompt of prompts || []) if (map.prompts[prompt] !== skill || providerPrompts.has(prompt)) failures.push(`完成合同归属或模式无效：${skill} -> ${prompt}`)
}
for (const [prompt, skill] of Object.entries(map.prompts)) {
  if (providerPrompts.has(prompt)) continue
  for (const locale of ['zh', 'en']) {
    const content = await readFile(resolve(root, 'skills', skill, 'assets/prompts', `${prompt}.${locale}.txt`), 'utf8')
    if (!content.startsWith('# Codex ')) failures.push(`文本合同未固化为 Codex 形式：${prompt}.${locale}`)
  }
}
for (const token of ['TYPE_PREFIXES', 'provenance', 'prompt_document', 'source_assets']) if (!assetLedger.includes(token)) failures.push(`资产规范实现缺少：${token}`)
for (const token of ['STORYBOARD_REVIEW_CRITERIA', 'PREVIZ_REVIEW_CRITERIA', '空间关系与轴线', '时间与动作连续性', '物理与交互逻辑', '光线与色彩连续性', '分镜图 criteria[] 必须按八维审计合同', '白模分镜通过时必须总分至少 85', 'hard_gates[] 必须按导演合同原顺序逐项覆盖', 'validatePrevizMedia(actualMedia']) if (!reviewLedger.includes(token)) failures.push(`分镜多维审计合同缺少：${token}`)
const taskLedger = await readFile(resolve(root, 'scripts/task-ledger.mjs'), 'utf8')
for (const token of ['createRequestSnapshot', 'reserveTask', 'settleReservedTask', 'submitting', 'requestSha256', 'inputFingerprint', '.short-drama']) if (!taskLedger.includes(token)) failures.push(`生成请求留档缺少：${token}`)
const skillRuns = await readFile(resolve(root, 'scripts/skill-runs.mjs'), 'utf8')
if (!skillRuns.includes("version.provenance?.created_by !== 'provider'")) failures.push('Provider 变换资产可能绕过生成 Skill')
for (const token of ['direct-blender-previz', 'episodes\\/ep-', 'generate-blender-previz']) if (!skillRuns.includes(token)) failures.push(`白模编导 Skill 门禁缺少：${token}`)
const blenderPreviz = await readFile(resolve(root, 'scripts/blender-previz.py'), 'utf8')
for (const token of ['animate_walk', 'arm_keyframes', 'head_keyframes', 'bone_keyframes', 'hand_pose_keyframes', 'contact_checks', 'plant_checks', 'validate_action_physics', 'RIG_BASE_ROTATIONS', 'FINGER_BASE_ROTATIONS', 'WEAPON_TYPES', 'EFFECT_TYPES', 'attach_weapon', 'evaluated_endpoint', 'FOG_GLOW', 'color 必须是三个 0–1 数字', 'camera_cuts 必须按帧号严格递增', 'marker.camera = cameras', 'keyframe.get("target", target)', 'ue-mannequin-retopology.glb']) if (!blenderPreviz.includes(token)) failures.push(`专业白模生成能力缺少：${token}`)
const previzContract = await readFile(resolve(root, 'scripts/previz-contract.mjs'), 'utf8')
const previzIntegrityImplementation = `${previzContract}\n${assetLedger}\n${workflowGates}`
for (const token of ['validatePrevizContract', 'probePrevizMedia', 'validatePrevizMedia', 'direction_contract_sha256', '不得在接触帧', 'supportsPrevizMotionReference', 'validateMotionReferenceBinding', 'PREVIZ_REQUIRED_HARD_GATES', '倒序或过度重叠']) if (!previzIntegrityImplementation.includes(token)) failures.push(`白模完整性门禁缺少：${token}`)
try { await access(resolve(root, 'public/models/ue-mannequin-retopology.glb')) } catch { failures.push('默认 UE Mannequin 模型缺失') }
const previzDirector = await readFile(resolve(root, 'skills/direct-blender-previz/SKILL.md'), 'utf8')
for (const token of ['剧情因果', '相机动机', '正打', '反打', 'camera_cuts', '85/100', 'direction-contract.md', 'action-previz.md', 'test_only']) if (!previzDirector.includes(token)) failures.push(`白模编导合同缺少：${token}`)
const previzGenerator = await readFile(resolve(root, 'skills/generate-blender-previz/SKILL.md'), 'utf8')
for (const token of ['MP4 生成成功不等于白模完成', '七项', 'P0/P1/P2', 'test_only', '不得判断“符合剧情”', '不得以“完成”“可用”或“已通过”交付']) if (!previzGenerator.includes(token)) failures.push(`白模生成后审计缺少：${token}`)
const actionPreviz = await readFile(resolve(root, 'skills/direct-blender-previz/references/action-previz.md'), 'utf8')
for (const token of ['预备—发力—接触—受力—回收', '肩—肘—腕', '髋—膝—踝', '支撑脚', '重心路径', '错开关键帧', '接触前加速', '相机运动必须早于接触点停稳', '建立空间—跟随启动—接触锁机—结果释放', '不得始终瞄准双人中点', '动作重定向', 'bone_keyframes', 'contact_checks', 'plant_checks', '兵器必须绑定持握手骨', '术法必须具有']) if (!actionPreviz.includes(token)) failures.push(`动作白模门禁缺少：${token}`)
const weaponsVfx = await readFile(resolve(root, 'skills/direct-blender-previz/references/weapons-vfx.md'), 'utf8')
for (const token of ['sword', 'dao', 'spear', 'staff', 'shield', 'orb', 'beam', 'ring', 'burst', 'attach_to', '双手 IK', '完整渲染和审计耗时']) if (!weaponsVfx.includes(token)) failures.push(`武器或术法白模门禁缺少：${token}`)
for (const token of ['STARROUTER_AUDIO_MODELS', 'STARROUTER_ASR_MODELS', '/v1/audio/speech', '/v1/audio/transcriptions', '/v1/audio/translations', 'speech-2.8-hd', 'qwen3-asr-flash', 'audioPayload', 'audioResult', 'MiniMax-H3', 'MiniMax-H3-Max', '/v1/videos', 'h3Payload']) if (!starrouter.includes(token)) failures.push(`StarRouter 实现缺少：${token}`)
for (const token of ['最多两张', '图片 9、视频 3、音频 3 或总数 12']) if (!starrouter.includes(token)) failures.push(`StarRouter 素材上限校验缺少：${token}`)
const generationMcp = await readFile(resolve(root, 'scripts/generation/mcp.mjs'), 'utf8')
for (const token of ['assetRoot', 'enforceGenerationStage', 'inspectStage', 'missingStoryboardAssets', 'missingStoryboardReviews', 'missingPrevizAssets', 'missingPrevizReviews', 'validateMotionReferenceBinding', '视频生成前必须先完成图片分镜镜头的生成与选版', '视频生成前必须先通过图片分镜镜头的多维审计', '视频生成前必须先完成已启用的 Blender 白模分镜', '视频生成前必须先通过 Blender 白模分镜导演验收', 'validateVideoPrompts', '视频生成必须引用有效的 episode/version/shot', 'selected 提示词版本', '实际视频参数与提示词文档', 'project.json 已确认配置一致', 'imageWorkflow', 'referenceManifestItem', "required: ['type', 'order', 'asset_key', 'version_id', 'role']", 'maxItems: 12', 'transcribe_audio', 'translate_audio', 'list_media_hosts', 'list_reference_uploads', 'publish_reference_image', 'ensure_reference_urls', 'submit_episode_videos', 'await_episode_tasks', '整集校验未通过', 'submitVideoOnce', 'reserveTask']) if (!generationMcp.includes(token)) failures.push(`生成入口边界校验缺少：${token}`)
for (const token of ['prepare_previous_tail', 'preparePreviousTail', 'validatePreviousTailBinding']) if (!generationMcp.includes(token)) failures.push(`上一镜尾帧 MCP 缺少：${token}`)
const continuityPlanScript = await readFile(resolve(root, 'scripts/continuity-plan.mjs'), 'utf8')
for (const token of ['camera_setup_id', 'start_state', 'end_state', 'previous-tail', 'recommendTailLink']) if (!continuityPlanScript.includes(token)) failures.push(`连续性计划实现缺少：${token}`)
try {
  const continuitySkill = await readFile(resolve(root, 'skills/plan-shot-continuity/SKILL.md'), 'utf8')
  for (const token of ['recommendTailLink', 'unresolved', 'project-store.mjs', 'select-episode-document', '语义位置', 'Blender', '不得推断']) if (!continuitySkill.includes(token)) failures.push(`跨镜连续性 Skill 缺少：${token}`)
} catch {}
const continuityIndex = map.workflow.indexOf('plan-shot-continuity')
if (continuityIndex <= map.workflow.indexOf('plan-drama-production') || continuityIndex >= map.workflow.indexOf('write-drama-video-prompts') || !map.stages?.['production-plan']?.includes('plan-shot-continuity')) failures.push('plan-shot-continuity 必须位于制作计划与视频提示词之间并登记到 production-plan 阶段')
const pipelineGuide = await readFile(resolve(root, 'references/pipeline.md'), 'utf8')
if (pipelineGuide.indexOf('plan-shot-continuity') < pipelineGuide.indexOf('production-plan') || pipelineGuide.indexOf('plan-shot-continuity') > pipelineGuide.indexOf('video prompts')) failures.push('流水线文档必须把 plan-shot-continuity 放在制作计划与视频提示词之间')
const nativeAudioAudit = await readFile(resolve(root, 'scripts/native-audio-audit.mjs'), 'utf8')
for (const token of ['audit-episode', 'auditVersion', '已审计']) if (!nativeAudioAudit.includes(token)) failures.push(`原生音频批量审计缺少：${token}`)
const litterbox = await readFile(resolve(root, 'scripts/media-hosting/litterbox.mjs'), 'utf8')
const mediaPublish = await readFile(resolve(root, 'scripts/media-hosting/publish.mjs'), 'utf8')
for (const token of ['https://litterbox.catbox.moe/resources/internals/api.php', "'1h', '12h', '24h', '72h'", 'litter.catbox.moe', 'redirect: \'error\'']) if (!litterbox.includes(token)) failures.push(`Litterbox 适配器合同缺少：${token}`)
for (const token of ['rights_confirmed', 'public_exposure_confirmed', 'usage_terms_confirmed', 'commercial-authorized', 'force_reupload', 'listReferenceUploads', 'withFileLock', '.short-drama/uploads', 'selectedVersionId', 'version.sha256']) if (!mediaPublish.includes(token)) failures.push(`临时上传安全门禁缺少：${token}`)
const referenceBindings = await readFile(resolve(root, 'scripts/reference-bindings.mjs'), 'utf8')
for (const token of ['validateVideoReferenceBindings', 'reference_image_paths', 'reference_video_paths', 'validateTemporaryReferenceUrl', '本地参考路径与资产版本不一致']) if (!referenceBindings.includes(token)) failures.push(`视频参考绑定缺少：${token}`)
for (const token of ['minimax-h3-reference-to-video', 'minimax-h3-workflow.json', '2086743729407733762', 'reference_image_paths', 'reference_video_paths', 'reference_audio_paths', 'MiniMaxH3ReferenceToVideo', 'validateH3References', 'confirm(input)']) if (!runninghub.includes(token) && token !== 'MiniMaxH3ReferenceToVideo') failures.push(`RunningHub H3 实现缺少：${token}`)
const h3Workflow = await readFile(resolve(root, 'scripts/generation/minimax-h3-workflow.json'), 'utf8')
if (!h3Workflow.includes('MiniMaxH3ReferenceToVideo')) failures.push('RunningHub H3 内置 workflow 无效')
for (const token of ['COMFLY_TOKEN', 'minimax-h3', '1518', '1521', '1542', '/internal/comfly/tasks', 'input_mode=Ref2VA', 'reference_manifest 与实际素材数量不一致']) if (!comfly.includes(token)) failures.push(`Comfly 实现缺少：${token}`)
for (const skill of ['use-short-drama-studio', 'orchestrate-short-drama', 'drama-generation-service']) {
  const content = await readFile(resolve(root, 'skills', skill, 'SKILL.md'), 'utf8')
  if (!/占位|placeholder/i.test(content) || !/MCP|工具列表|工具/.test(content)) failures.push(`媒体工具缺失门禁未写入：${skill}`)
}

const scriptStage = map.stages?.script || []
for (const skill of ['short-drama', 'write-drama-episode', 'humanizer', 'review-drama-script']) if (!scriptStage.includes(skill)) failures.push(`剧本阶段缺少：${skill}`)
for (const skill of ['remotion-best-practices', 'edit-drama-timeline']) if (!map.stages?.editing?.includes(skill)) failures.push(`剪辑阶段缺少：${skill}`)
const editingGuide = await readFile(resolve(root, 'references/editing-workflow.md'), 'utf8')
for (const token of ['selected', 'J/L-cut', '6–12 帧', '-14 至 -16 LUFS', '-1 dBTP', 'SRT', 'ASS', 'freeze-edit-candidate.mjs', 'export-edit-subtitles.mjs']) if (!editingGuide.includes(token)) failures.push(`剪辑规范缺少：${token}`)
const reviewSkill = await readFile(resolve(root, 'skills/review-drama-script/SKILL.md'), 'utf8')
if (!reviewSkill.includes('../../references/writing/compliance-checklist.md')) failures.push('合规清单未接入剧本复核')
const voiceDescriptionPrompt = await readFile(resolve(root, 'skills/design-drama-audio/assets/prompts/character_voice_description.zh.txt'), 'utf8')
for (const token of ['50', '性别', '年龄段', '2–4', '人物名', '地名', '剧情', '台词', '声音描述：']) if (!voiceDescriptionPrompt.includes(token)) failures.push(`CosyVoice 声音描述合同缺少：${token}`)
const voiceDescriptionContract = await readFile(resolve(root, 'scripts/generation/voice-description.mjs'), 'utf8')
for (const token of ['weightedLength', '性别和年龄段', '2–4', '人物名', '剧情', '台词', 'voice_traits']) if (!voiceDescriptionContract.includes(token)) failures.push(`CosyVoice 声音描述校验缺少：${token}`)
if (!map.stages?.['asset-analysis']?.includes('generate-drama-art-style')) failures.push('资产分析阶段缺少画风生成 Skill')
for (const [prompt, tokens] of Object.entries({
  character_asset_sheet: ['脸部特写', '90 度侧面', '服装', '表情'],
  scene_asset_sheet: ['09 动线与纵深透视', '平面布局', '轴测透视', '材质'],
  prop_generate: ['主视图特写', '严格侧面', '结构', '纯白背景'],
})) {
  const skill = map.prompts[prompt]
  const content = await readFile(resolve(root, 'skills', skill, 'assets/prompts', `${prompt}.zh.txt`), 'utf8')
  for (const token of tokens) if (!content.includes(token)) failures.push(`${prompt} 未吸收完整设定板规则：${token}`)
}
for (const skill of ['generate-character-images', 'generate-scene-assets', 'generate-prop-assets']) {
  for (const path of actualPrompts.filter((item) => item.startsWith(`${skill}/`))) {
    const content = await readFile(resolve(root, 'skills', path), 'utf8')
    if (/引号.*替换为「|quotation marks.*corner brackets/i.test(content)) failures.push(`资产提示词残留伪 JSON 引号规则：${path}`)
  }
}

const parameterSkills = {
  'drama-generation-service': ['gpt-image-2', '1K,2K,4K', 'first-last-frame,full-reference', 'MiniMax-H3,MiniMax-H3-Max', 'speech-2.8-hd,speech-2.8-turbo', 'minimax-h3-reference-to-video', 'minimax-h3'],
  'generate-drama-videos': ['dreamina-seedance-2-0-fast-260128', 'doubao-seedance-1-5-pro-251215', '480p,720p,1080p', 'MiniMax-H3', 'MiniMax-H3-Max', '480P', '768P', '2K'],
  'design-drama-audio': ['happy,sad,angry', '8000,16000,22050,24000,32000,44100', 'Chinese,Yue'],
}
for (const [skill, tokens] of Object.entries(parameterSkills)) {
  const content = (await readFile(resolve(root, 'skills', skill, 'SKILL.md'), 'utf8')).replace(/[`{}\s]/g, '')
  for (const token of tokens) if (!content.includes(token)) failures.push(`${skill} 缺少模型参数枚举：${token}`)
}

if (skillNames.some((name) => name.includes('vvicat'))) failures.push('Skill 名称不得包含 vvicat')
if (failures.length) {
  console.error(failures.join('\n'))
  process.exitCode = 1
} else {
  console.log(JSON.stringify({ skills: skillNames.length, workflowSkills: map.workflow.length, supportSkills: map.support.length, prompts: Object.keys(map.prompts).length, codexContracts: Object.keys(map.prompts).length - providerPrompts.size, providerPrompts: providerPrompts.size, promptFiles: actualPrompts.length, mode: 'standalone-local', status: 'covered' }))
}
