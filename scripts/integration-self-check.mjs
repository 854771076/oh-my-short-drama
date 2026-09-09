#!/usr/bin/env node
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { call as callGeneration } from './generation/mcp.mjs'
import { listReferenceUploads, publishReferenceImage, validateTemporaryReferenceUrl } from './media-hosting/publish.mjs'
import { validateVideoReferenceBindings } from './reference-bindings.mjs'

const plugin = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const skillMap = JSON.parse(await readFile(resolve(plugin, 'references/skill-map.json'), 'utf8'))
const providerPrompts = new Set(skillMap.provider_prompts || [])
function run(script, ...args) {
  const result = spawnSync(process.execPath, [resolve(plugin, 'scripts', script), ...args], { encoding: 'utf8' })
  if (result.status !== 0) throw new Error(`${script} 失败：${result.stderr || result.stdout}`)
  return result.stdout
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

async function main() {
  if (!process.argv.includes('--self-check')) throw new Error('仅支持 --self-check')
  await checkMultiEpisodeEvidence()
  const root = await mkdtemp(resolve(tmpdir(), 'short-drama-integration-'))
  try {
    const initialProject = await json(root, 'initial-project.json', { key: 'integration-drama', title: '集成测试短剧', providers: { image: { provider: 'starrouter', model_or_workflow: 'gpt-image-2', prompt_profile: null }, video: { provider: 'starrouter', model_or_workflow: 'dreamina-seedance-2-0-260128', prompt_profile: 'seedance2' }, audio: { provider: 'starrouter', model_or_workflow: 'speech-2.8-hd', prompt_profile: null } } })
    run('project-store.mjs', 'init', root, initialProject)
    const initialized = JSON.parse(run('project-store.mjs', 'project', root))
    if (initialized.schema_version !== 1 || !('format' in initialized) || !('providers' in initialized) || initialized.creative?.art_style?.id !== 'system-realistic') throw new Error('项目规范 v1 初始化失败')
    const mediaHosts = await callGeneration('list_media_hosts')
    if (!mediaHosts.litterbox?.free || mediaHosts.litterbox?.permanent || mediaHosts.litterbox?.expiries?.join(',') !== '1h,12h,24h,72h') throw new Error('Litterbox MCP 能力目录无效')
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
    const referenceManifest = [{ type: 'image', order: 1, asset_key: 'char-a', version_id: 'v001', role: 'first_frame' }]
    try { await validateTemporaryReferenceUrl(root, uploadReceipt.url, { asset_key: 'char-a', version_id: 'v001' }, Date.parse(uploadReceipt.expires_at)); throw new Error('到期收据仍被接受') } catch (error) { if (!String(error.message).includes('校验时间点有效')) throw error }
    const repeatedManifest = [1, 2].map((order) => ({ type: 'image', order, asset_key: 'char-a', version_id: 'v001', role: 'reference_image' }))
    await validateVideoReferenceBindings(root, 'starrouter', { prompt_profile: 'seedance2', reference_image_urls: [uploadReceipt.url, uploadReceipt.url] }, repeatedManifest)
    const selectedPath = resolve(root, JSON.parse(await readFile(resolve(root, '.short-drama/assets.json'), 'utf8')).assets['char-a'].versions[0].localPath)
    await validateVideoReferenceBindings(root, 'runninghub', { model: 'minimax-h3-reference-to-video', reference_image_paths: [selectedPath] }, [referenceManifest[0]])
    try { await validateVideoReferenceBindings(root, 'runninghub', { model: 'minimax-h3-reference-to-video', reference_image_paths: [media] }, [referenceManifest[0]]); throw new Error('错误本地参考路径仍被接受') } catch (error) { if (!String(error.message).includes('本地参考路径与资产版本不一致')) throw error }
    try { await validateTemporaryReferenceUrl(root, 'https://litter.catbox.moe/untracked.png', { asset_key: 'char-a', version_id: 'v001' }); throw new Error('无收据 Litterbox URL 被接受') } catch (error) { if (!String(error.message).includes('本地上传收据')) throw error }
    const snapshot = async (name, target, type, provider, tool, args, promptDocument = null) => JSON.parse(run('task-ledger.mjs', 'snapshot', root, await json(root, `${name}-request.json`, { tool, target, type, provider, modelOrWorkflow: args.model || args.workflow_id, promptDocument, arguments: { ...args, confirmed: true } })))
    const videoPromptText = '@图片1 作为首帧，人物抬头后停在结束姿态。'
    const videoPromptText2 = '@图片1 作为首帧，人物转身走向门口后停住。'
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
    const source = { source_scope: {}, adaptation_mode: 'original', facts: [], timeline: [], characters: [], locations: [], props: [], conflicts: [], themes: [], visual_challenges: [], content_constraints: [], user_requirements: [], contradictions: [], open_questions: [], coverage: { complete: true, ranges: [] } }
    const brief = { title: '测试', logline: '', adaptation_mode: 'original', genre: '', audience: '', platform: '', tone: '', core_conflict: '', output_language: 'zh-CN', spoken_language: 'zh-CN', subtitle_language: 'zh-CN', aspect_ratio: '9:16', episode_count: 1, episode_duration_seconds: 30, rating: '', existing_materials: [], required_deliverables: [], prohibited_content: [], ending_type: '', creative_constraints: [], open_questions: [], approved: true }
    const bible = { premise: '', genre: '', tone: '', themes: [], world_rules: [], ending: {}, characters: [], relationships: [], three_act: {}, conflict_ladder: [], promises_and_payoffs: [], foreshadowing: [], continuity_rules: [], adaptation_constraints: [], open_questions: [] }
    const outline = { episodes: [{ key: 'ep-001', order: 1 }], coverage_check: { complete: true, gaps: [], overlaps: [] }, continuity_check: { valid: true, issues: [] } }
    for (const [kind, value] of Object.entries({ 'source-analysis': source, brief, bible, outline })) run('project-store.mjs', 'put-document', root, kind, await json(root, `${kind}.json`, value))
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

    const assetPlan = { episode_key: 'ep-001', characters: [{ key: 'char-a', type: 'character', name: 'A', evidence: [{}], versions: [{}], status: 'ready', selected_version: 'v001' }], scenes: [], props: [], unresolved: [] }
    run('project-store.mjs', 'put-episode-document', root, 'asset-plan', 'ep-001', 'v001', await json(root, 'asset-plan.json', assetPlan))
    run('project-store.mjs', 'select-episode-document', root, 'asset-plan', 'ep-001', 'v001')
    const currentStyle = JSON.parse(run('project-store.mjs', 'project', root)).creative.art_style
    run('project-store.mjs', 'put-document', root, 'art-style', await json(root, 'art-style.json', { mode: 'confirmed-default', style: currentStyle, decision_reason: '确认使用项目默认真人风格', approved: true }))
    const planAsProfile = spawnSync(process.execPath, [resolve(plugin, 'scripts/skill-runs.mjs'), 'record', root, 'asset-analysis', 'generate-character-profiles', 'episodes/ep-001/asset-plan/v001.json'], { encoding: 'utf8' })
    if (planAsProfile.status === 0 || !planAsProfile.stderr.includes('证据类型无效')) throw new Error('资产计划被错误接受为人物档案证据')
    const characterProfile = { new_characters: [{ name: 'A', aliases: [], introduction: '测试人物', gender: 'unknown', age_range: '成年', role_level: 'A', archetype: '推动者', personality_tags: ['克制', '果断'], era_period: '现代', social_class: '普通', occupation: '测试职业', costume_tier: 2, suggested_colors: ['黑', '灰'], primary_identifier: '利落短发', visual_keywords: ['克制'], performance_bible: { center_of_gravity: '稳定', gait: '利落', habitual_actions: [], eyeline_behavior: '直视', blink_rhythm: '平稳', stress_response: '停顿', forbidden_performance: [] }, voice_identity: { pitch: '中', timbre: '清晰', accent: '普通话', pace: '中速', delivery: '克制' }, expected_appearances: [{ id: 1, change_reason: '基础造型' }] }], updated_characters: [] }
    run('character-profiles.mjs', 'apply', root, await json(root, 'character-profile.json', characterProfile))
    await recordSkills(root, 'asset-analysis', 'episodes/ep-001/asset-plan/v001.json')
    run('workflow.mjs', 'advance', root, 'asset-generation')
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
    const productionShot = { dependencies: [], image_strategy: { mode: 'selected', board_type: 'shot-board', overflow_strategy: 'compose-assets' }, video_strategy: { mode: 'generate' }, audio_strategy: { mode: 'post-dub' }, provider: 'starrouter', model_or_workflow: 'dreamina-seedance-2-0-260128', prompt_profile: 'seedance2', input_mode: 'first-last-frame', duration_seconds: 5, resolution: '1080x1920', aspect_ratio: '9:16', candidate_count: 1, reference_assets: [{ key: 'char-a', version_id: 'v001', role: 'first_frame', order: 1 }], estimated_paid_calls: 1, fallback: {}, review_checks: ['visual'], status: 'ready' }
    const production = { episode_key: 'ep-001', source_versions: {}, shots: [1, 2].map((shot_number) => ({ shot_number, ...productionShot })), totals: {}, unresolved: [], approved: true }
    run('project-store.mjs', 'put-episode-document', root, 'production-plan', 'ep-001', 'v001', await json(root, 'production.json', production))
    run('project-store.mjs', 'select-episode-document', root, 'production-plan', 'ep-001', 'v001')
    const generatedStoryboardPlan = { ...production, shots: production.shots.map((shot) => ({ ...shot, image_strategy: { mode: 'generate', board_type: 'storyboard', overflow_strategy: 'reject' } })) }
    run('project-store.mjs', 'put-episode-document', root, 'production-plan', 'ep-001', 'v002', await json(root, 'production-storyboard.json', generatedStoryboardPlan))
    run('project-store.mjs', 'select-episode-document', root, 'production-plan', 'ep-001', 'v002')
    if (!JSON.parse(run('skill-runs.mjs', 'required', root, 'media-production')).includes('generate-storyboard-images')) throw new Error('生成分镜图策略未动态要求对应 Skill')
    run('project-store.mjs', 'select-episode-document', root, 'production-plan', 'ep-001', 'v001')
    if (JSON.parse(run('skill-runs.mjs', 'required', root, 'media-production')).includes('generate-storyboard-images')) throw new Error('复用分镜图策略仍错误要求生成 Skill')
    const videoPrompts = {
      episode_key: 'ep-001', source_versions: { production_plan: 'v001', storyboard: 'v001' }, unresolved: [], approved: true,
      shots: [videoPromptText, videoPromptText2].map((prompt, index) => ({ shot_number: index + 1, production_plan_version: 'v001', storyboard_version: 'v001', provider: 'starrouter', model_or_workflow: 'dreamina-seedance-2-0-260128', prompt_profile: 'seedance2', input_mode: 'first-last-frame', prompt, duration: 5, references: referenceManifest, continuity: {}, audio_policy: { mode: 'post-dub' }, errors: [] })),
    }
    run('project-store.mjs', 'put-episode-document', root, 'video-prompts', 'ep-001', 'v001', await json(root, 'video-prompts.json', videoPrompts))
    run('project-store.mjs', 'select-episode-document', root, 'video-prompts', 'ep-001', 'v001')
    const boundVideo = { provider: 'starrouter', model: 'dreamina-seedance-2-0-260128', prompt_profile: 'seedance2', input_mode: 'first-last-frame', prompt_version: 'v001', prompt: videoPrompts.shots[0].prompt, duration: 5, frame_url: uploadReceipt.url, reference_manifest: videoPrompts.shots[0].references, confirmed: true, project_root: root, target: 'shot-ep001-001', prompt_document: { episode_key: 'ep-001', version_id: 'v001', shot_number: 1 } }
    try { await callGeneration('submit_video', { ...boundVideo, prompt: '被篡改的提示词' }); throw new Error('视频提示词绑定自检未触发') } catch (error) { if (!String(error.message).includes('prompt 不一致')) throw error }
    try { await callGeneration('submit_video', { ...boundVideo, fps: 25 }); throw new Error('Seedance 参数自检未触发') } catch (error) { if (!String(error.message).includes('fps 仅支持 24')) throw error }
    const boundFailure = Object.values(JSON.parse(run('task-ledger.mjs', 'list', root)).tasks).find((task) => task.target === 'shot-ep001-001' && task.status === 'failed')
    if (!boundFailure) throw new Error('通过文档绑定校验后的失败视频请求未留档')
    await recordSkills(root, 'production-plan', 'episodes/ep-001/production-plan/v001.json')
    run('workflow.mjs', 'advance', root, 'media-production')

    const audioPlan = { episode_key: 'ep-001', source_versions: { script: 'v002', storyboard: 'v001', production_plan: 'v001' }, lines: [{ line_index: 1, speaker: 'A', line_type: 'dialogue', content: '别绕弯子。', emotion: '克制', emotion_strength: 0.2, pronunciation_notes: [], matched_shot: { shot_number: 1 } }], voice_bindings: [{ speaker: 'A', provider: 'starrouter', model: 'speech-2.8-hd', voice_id: 'male-qn-qingse' }], unresolved: [], approved: true }
    run('project-store.mjs', 'put-episode-document', root, 'audio-plan', 'ep-001', 'v001', await json(root, 'audio-plan.json', audioPlan))
    run('project-store.mjs', 'select-episode-document', root, 'audio-plan', 'ep-001', 'v001')
    try {
      await callGeneration('generate_audio', { provider: 'starrouter', model: 'speech-2.8-hd', input: '被篡改的台词', voice: 'male-qn-qingse', speed: 1, response_format: 'flac', confirmed: true, project_root: root, target: 'audio-ep001-a', prompt_document: audioPromptReference })
      throw new Error('与 audio-plan 不一致的台词未被拒绝')
    } catch (error) { if (!String(error.message).includes('台词不一致')) throw error }
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
      run('asset-ledger.mjs', 'select', root, key, 'v001')
      run('task-ledger.mjs', 'update', root, taskId, 'completed', 'v001')
    }
    run('asset-ledger.mjs', 'put', root, await json(root, 'audio.json', { key: 'audio-ep001-a', type: 'audio', name: 'A 配音' }))
    await writeFile(resolve(root, 'audio.b64'), `data:audio/flac;base64,${Buffer.from('audio fixture').toString('base64')}\n`)
    const audioProvenance = await json(root, 'audio-provenance.json', { origin: 'generated', created_by: 'provider', provider: 'starrouter', model_or_workflow: 'speech-2.8-hd', task_id: 'task-c', prompt_document: audioPromptReference, source_assets: [], parameters: { voice: 'male-qn-qingse', speed: 1, response_format: 'flac' } })
    run('asset-ledger.mjs', 'decode', root, 'audio-ep001-a', resolve(root, 'audio.b64'), 'v001', '-', audioProvenance)
    run('asset-ledger.mjs', 'select', root, 'audio-ep001-a', 'v001')
    run('task-ledger.mjs', 'update', root, 'task-c', 'completed', 'v001')

    for (const shotNumber of [1, 2]) {
      const shotReview = { assetKey: `shot-ep001-${String(shotNumber).padStart(3, '0')}`, versionId: 'v001', visual: 'passed', audio: 'not-applicable', transition: 'passed', captions: 'not-applicable', issues: [], criteria: [{ criterion: 'visual', status: 'passed', observation: '主体与动作符合计划' }] }
      run('review-ledger.mjs', 'put', root, await json(root, `shot-review-${shotNumber}.json`, shotReview))
    }
    const mediaEvidence = run('snapshot-stage-evidence.mjs', root, 'media-production').trim()
    await recordSkills(root, 'media-production', mediaEvidence)
    run('workflow.mjs', 'advance', root, 'editing')

    const timeline = {
      episode_key: 'ep-001', fps: 24, width: 1080, height: 1920,
      segments: [
        { shot_key: 'shot-ep001-001', asset_key: 'shot-ep001-001', version_id: 'v001', source_in_ms: 0, source_out_ms: 1000, timeline_start_ms: 0, timeline_end_ms: 1000, transition: { type: 'none', duration_frames: 0 } },
        { shot_key: 'shot-ep001-002', asset_key: 'shot-ep001-002', version_id: 'v001', source_in_ms: 0, source_out_ms: 1000, timeline_start_ms: 1000, timeline_end_ms: 2000, transition: { type: 'hard-cut', duration_frames: 0 } },
      ],
      audio_tracks: [{ asset_key: 'audio-ep001-a', version_id: 'v001', role: 'dialogue', source_in_ms: 0, source_out_ms: 1000, timeline_start_ms: 0, timeline_end_ms: 1000, volume_envelope: [{ time_ms: 0, gain_db: 0 }, { time_ms: 1000, gain_db: 0 }] }],
      subtitles: [{ text: '别绕弯子。', startMs: 0, endMs: 900, timestampMs: 0, confidence: 1, speaker: 'A' }],
      labels: [], mix: { target_lufs: -15, true_peak_dbtp: -1 },
    }
    run('editing-store.mjs', 'put-timeline', root, await json(root, 'timeline-incomplete.json', { ...timeline, segments: timeline.segments.slice(0, 1) }))
    const editReview = { episode_key: 'ep-001', watchedFull: true, narrative: 'passed', visual: 'passed', audio: 'passed', transitions: 'passed', captions: 'passed', technical: 'passed', observations: { narrative: '故事完整', visual: '画面清晰', audio: '对白清楚', transitions: '切点自然', captions: '字幕准确', technical: '参数合格' }, issues: [], approved: true }
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
    const timeline2 = { episode_key: 'ep-002', fps: 24, width: 1080, height: 1920, segments: [{ shot_key: 'shot-ep002-001', asset_key: 'shot-ep002-001', version_id: 'v001', source_in_ms: 0, source_out_ms: 1000, timeline_start_ms: 0, timeline_end_ms: 1000, transition: { type: 'none', duration_frames: 0 } }], audio_tracks: [], subtitles: [], labels: [], mix: null }
    run('editing-store.mjs', 'put-timeline', root, await json(root, 'timeline-2.json', timeline2))
    const editReview2 = { ...editReview, episode_key: 'ep-002' }
    run('editing-store.mjs', 'put-review', root, 'ep-002', await json(root, 'editing-review-2.json', editReview2))
    for (const [name, content] of [['final.mp4', 'final-2'], ['final.srt', 'subtitle-2'], ['final.ass', 'subtitle-2']]) await writeFile(resolve(root, 'delivery/ep-002', name), content)
    run('editing-store.mjs', 'manifest', root, 'ep-002', 'delivery/ep-002/final.mp4', 'delivery/ep-002/final.srt', 'delivery/ep-002/final.ass')
    await Promise.all(['ep-001', 'ep-002'].map((episode) => readFile(resolve(root, 'delivery', episode, 'manifest.json'))))
    console.log('ok')
  } finally { await rm(root, { recursive: true, force: true }) }
}

main().catch((error) => { console.error(error.message); process.exitCode = 1 })
