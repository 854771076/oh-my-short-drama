import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { access, mkdtemp, mkdir, readFile, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { validateProject } from './project-store.mjs'
import { validateRecreationConsumerBinding, validateRecreationEvidence, validateRecreationWorkflow, validateReferenceVideoAnalysis } from './recreation-workflow.mjs'
import { requiredSkills } from './skill-runs.mjs'
import { inspectStage } from './workflow-gates.mjs'

const scripts = dirname(fileURLToPath(import.meta.url))

function projectFixture() {
  return {
    schema_version: 1,
    key: 'video-remake',
    title: '视频复刻',
    automation_mode: true,
    paid_automation_authorized: false,
    description: null,
    format: { aspect_ratio: null, resolution: null, fps: null, episode_count: null, episode_duration_seconds: null },
    languages: { output: null, spoken: null, subtitle: null },
    creative: { adaptation_mode: null, genre: null, tone: null, rating: null, art_style: null },
    storyboard: { type: 'shot-board', default_panel_grid_size: 4, preferred_medium: 'blender' },
    providers: {
      image: { provider: null, model_or_workflow: null, prompt_profile: null, parameters: {} },
      video: { provider: null, model_or_workflow: null, prompt_profile: null, parameters: {} },
      audio: { provider: null, model_or_workflow: null, prompt_profile: null, parameters: {} },
      music: { provider: null, model_or_workflow: null, prompt_profile: null, parameters: {} },
    },
    createdAt: '2026-09-16T00:00:00.000Z',
    updatedAt: '2026-09-16T00:00:00.000Z',
  }
}

function runProjectStore(...args) {
  return spawnSync(process.execPath, [resolve(scripts, 'project-store.mjs'), ...args], { encoding: 'utf8' })
}

test('旧项目读取时补齐 standard workflow，未知 profile 被拒绝', () => {
  const legacy = projectFixture()
  const validated = validateProject(legacy)
  assert.deepEqual(validated.workflow, { type: 'standard', version: 1 })

  const invalid = projectFixture()
  invalid.workflow = { type: 'unknown', version: 1 }
  assert.throws(() => validateProject(invalid), /workflow\.type/)
})

test('put-source 将本地视频登记为 reference-video 来源', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'recreation-source-'))
  await mkdir(resolve(root, 'source'), { recursive: true })
  await writeFile(resolve(root, 'source/manifest.json'), '{"version":1,"sources":{}}\n')
  const input = resolve(root, 'reference.mp4')
  await writeFile(input, Buffer.from('not-a-real-video'))

  const result = runProjectStore('put-source', root, 'src-reference-video', 'v001', input)
  assert.equal(result.status, 0, result.stderr)
  const manifest = JSON.parse(await readFile(resolve(root, 'source/manifest.json'), 'utf8'))
  assert.equal(manifest.sources['src-reference-video'].kind, 'reference-video')
  assert.match(manifest.sources['src-reference-video'].versions[0].localPath, /\.mp4$/)
})

function analysisFixture() {
  return {
    schema_version: 1,
    source_ref: { key: 'src-reference-video', version_id: 'v001', sha256: 'a'.repeat(64) },
    prepared_ref: { path: '.short-drama/reference-video/prepared.json', sha256: 'b'.repeat(64) },
    rights: { status: 'owned', allowed_uses: ['analysis', 'authorized-close-recreation'], restrictions: [], confirmed_at: '2026-09-16T00:00:00.000Z' },
    technical: { duration_ms: 2000, width: 320, height: 240, fps: 10, has_audio: true },
    evidence: [{ id: 'evidence-001', start_ms: 0, end_ms: 2000, frame_refs: ['.short-drama/reference-video/src-reference-video/v001/frames/shot-001.png'], transcript: '开场台词', on_screen_text: ['标题'], observations: ['人物正对镜头'] }],
    structure: { hook: ['evidence-001'], beats: ['evidence-001'], turns: [], payoff: [], cta: [] },
    visual_grammar: { shot_scale: ['近景'], camera: ['固定'], motion: [], cut_rhythm: '快速', caption: '逐词高亮', audio: '人声主导' },
    replication: { preserve_mechanisms: [{ mechanism: '三秒钩子', evidence_ids: ['evidence-001'] }], transform_elements: ['人物和商品'], forbidden_elements: ['原片水印'] },
    confidence: 'high',
    limitations: ['自动镜头检测需人工核对'],
    coverage: { complete: true, analyzed_ms: 2000 },
    open_questions: [],
  }
}

function workflowFixture() {
  return {
    schema_version: 1,
    episode_key: 'ep-001',
    analysis_ref: { path: '.short-drama/reference-video-analysis.json', sha256: 'c'.repeat(64) },
    source_ref: { key: 'src-reference-video', version_id: 'v001', sha256: 'a'.repeat(64) },
    rights_mode: 'structure-only', rights_basis: null, rights_scope: [],
    slots: [{ id: 'product', type: 'text', required: true, default: null }],
    script: { segments: [{ id: 'hook', speaker: '旁白', text: '这款产品解决了问题', words: [] }] },
    media_tracks: [{ id: 'product-shot', kind: 'image', slot: 'product', trigger: { segment_id: 'hook', start_word: '这款', end_word: '产品' }, purpose: '产品露出' }],
    captions: { mode: 'word-aligned', style: 'karaoke', anchor: 'script' },
    speech: { mode: 'post-dub', alignment: 'word' },
    film: { aspect_ratio: '9:16', resolution: '1080x1920', fps: 24, layout: 'single' },
    unresolved: [], approved: true,
  }
}

test('参考分析要求时间码证据、权利边界和完整覆盖', () => {
  assert.equal(validateReferenceVideoAnalysis(analysisFixture()).coverage.complete, true)
  const invalid = analysisFixture()
  invalid.evidence[0].end_ms = 0
  assert.throws(() => validateReferenceVideoAnalysis(invalid), /时间范围/)

  const incomplete = analysisFixture()
  incomplete.evidence[0].end_ms = 100
  assert.throws(() => validateReferenceVideoAnalysis(incomplete), /覆盖|coverage/)

  const naturalLanguageRestriction = analysisFixture()
  naturalLanguageRestriction.rights.restrictions = ['不得复用声音']
  assert.throws(() => validateReferenceVideoAnalysis(naturalLanguageRestriction), /restrictions|受控/)
})

test('声明式工作流使用 segment 和 word 锚点并验证引用', () => {
  assert.equal(validateRecreationWorkflow(workflowFixture(), 'ep-001').approved, true)
  const unknownSegment = workflowFixture()
  unknownSegment.media_tracks[0].trigger.segment_id = 'missing'
  assert.throws(() => validateRecreationWorkflow(unknownSegment, 'ep-001'), /segment/)

  const fixedSeconds = workflowFixture()
  fixedSeconds.media_tracks[0].trigger.start_ms = 100
  assert.throws(() => validateRecreationWorkflow(fixedSeconds, 'ep-001'), /trigger/)

  const reverse = workflowFixture()
  reverse.script.segments[0].text = '先产品后这款'
  assert.throws(() => validateRecreationWorkflow(reverse, 'ep-001'), /顺序|锚点/)
})

test('近似复刻必须有权利依据，批准工作流不得保留未决项', () => {
  const close = workflowFixture()
  close.rights_mode = 'authorized-close-recreation'
  assert.throws(() => validateRecreationWorkflow(close, 'ep-001'), /rights_basis/)

  const unresolved = workflowFixture()
  unresolved.unresolved.push({ id: 'question-1', question: '商品是什么', affects: ['product'] })
  assert.throws(() => validateRecreationWorkflow(unresolved, 'ep-001'), /approved/)
})

test('project-store 接受参考分析和版本化复刻工作流文档', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'recreation-documents-'))
  await mkdir(resolve(root, '.short-drama'), { recursive: true })
  await mkdir(resolve(root, 'episodes/ep-001'), { recursive: true })
  await writeFile(resolve(root, '.short-drama/state.json'), '{"version":1,"stage":"analysis","completed":[],"invalidatedAt":{},"updatedAt":"2026-09-16T00:00:00.000Z"}\n')
  await writeFile(resolve(root, '.short-drama/skill-runs.json'), '{"version":1,"runs":{}}\n')
  await writeFile(resolve(root, 'episodes/ep-001/episode.json'), '{"key":"ep-001","order":1,"title":"测试","logline":null,"target_duration_seconds":null,"status":"draft","createdAt":"2026-09-16T00:00:00.000Z","updatedAt":"2026-09-16T00:00:00.000Z"}\n')
  const analysisPath = resolve(root, 'analysis.json')
  const workflowPath = resolve(root, 'workflow.json')
  await writeFile(analysisPath, `${JSON.stringify(analysisFixture())}\n`)
  await writeFile(workflowPath, `${JSON.stringify(workflowFixture())}\n`)

  const analysisResult = runProjectStore('put-document', root, 'reference-video-analysis', analysisPath)
  assert.equal(analysisResult.status, 0, analysisResult.stderr)
  const savedAnalysis = await readFile(resolve(root, '.short-drama/reference-video-analysis.json'), 'utf8')
  const workflow = workflowFixture()
  workflow.analysis_ref.sha256 = createHash('sha256').update(savedAnalysis).digest('hex')
  await writeFile(workflowPath, `${JSON.stringify(workflow)}\n`)
  const workflowResult = runProjectStore('validate-episode-document', root, 'recreation-workflow', 'ep-001', workflowPath)
  assert.equal(workflowResult.status, 0, workflowResult.stderr)
  const selectedResult = runProjectStore('put-episode-document', root, 'recreation-workflow', 'ep-001', 'v001', workflowPath, '--select')
  assert.equal(selectedResult.status, 0, selectedResult.stderr)
  const compiled = JSON.parse(await readFile(resolve(root, '.short-drama/recreation-compiled/ep-001/v001.json'), 'utf8'))
  assert.equal(compiled.workflow_ref.version_id, 'v001')
  assert.deepEqual(compiled.reference_constraints, analysisFixture().replication)

  const invalidWorkflow = workflowFixture()
  invalidWorkflow.analysis_ref.sha256 = 'f'.repeat(64)
  await writeFile(workflowPath, `${JSON.stringify(invalidWorkflow)}\n`)
  const stored = runProjectStore('put-episode-document', root, 'recreation-workflow', 'ep-001', 'v002', workflowPath)
  assert.equal(stored.status, 0, stored.stderr)
  const failedSelection = runProjectStore('select-episode-document', root, 'recreation-workflow', 'ep-001', 'v002')
  assert.notEqual(failedSelection.status, 0)
  const selected = JSON.parse(await readFile(resolve(root, 'episodes/ep-001/recreation-workflow/selected.json'), 'utf8'))
  assert.equal(selected.versionId, 'v001')
  const compiledAfterFailure = JSON.parse(await readFile(resolve(root, '.short-drama/recreation-compiled/ep-001/v001.json'), 'utf8'))
  assert.equal(compiledAfterFailure.workflow_ref.version_id, 'v001')
})

test('viral 下游文档必须绑定当前 selected 复刻工作流版本', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'recreation-consumer-'))
  await mkdir(resolve(root, '.short-drama'), { recursive: true })
  await mkdir(resolve(root, 'episodes/ep-001/recreation-workflow'), { recursive: true })
  await writeFile(resolve(root, '.short-drama/project.json'), '{"workflow":{"type":"viral-recreation","version":1}}\n')
  await writeFile(resolve(root, 'episodes/ep-001/recreation-workflow/selected.json'), '{"versionId":"v003","path":"episodes/ep-001/recreation-workflow/v003.json"}\n')
  const audioPath = resolve(root, 'audio.json')
  const audio = { episode_key: 'ep-001', source_versions: {}, audio_strategy: { mode: 'native-first', provider_selection: 'prefer-native', fallback_allowed: true, fallback_reasons: ['provider-no-native-audio', 'voice-identity-drift', 'speech-intelligibility-failed', 'narration-performance-failed', 'audio-sync-failed', 'native-ambience-failed'] }, lines: [], voice_bindings: [], unresolved: [], approved: true }
  await writeFile(audioPath, `${JSON.stringify(audio)}\n`)

  const missing = runProjectStore('validate-episode-document', root, 'audio-plan', 'ep-001', audioPath)
  assert.notEqual(missing.status, 0)
  assert.match(missing.stderr, /recreation_workflow/)

  audio.source_versions.recreation_workflow = 'v003'
  await writeFile(audioPath, `${JSON.stringify(audio)}\n`)
  const valid = runProjectStore('validate-episode-document', root, 'audio-plan', 'ep-001', audioPath)
  assert.equal(valid.status, 0, valid.stderr)
})

test('brief、剧本、导演本和时间线必须机器绑定当前复刻工作流', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'recreation-all-consumers-'))
  await mkdir(resolve(root, '.short-drama'), { recursive: true })
  await mkdir(resolve(root, 'episodes/ep-001/recreation-workflow'), { recursive: true })
  await writeFile(resolve(root, '.short-drama/project.json'), '{"workflow":{"type":"viral-recreation","version":1}}\n')
  await writeFile(resolve(root, 'episodes/ep-001/recreation-workflow/selected.json'), '{"versionId":"v003","path":"episodes/ep-001/recreation-workflow/v003.json"}\n')

  await assert.rejects(validateRecreationConsumerBinding(root, 'brief', null, { recreation_workflows: {} }), /ep-001/)
  await validateRecreationConsumerBinding(root, 'brief', null, { recreation_workflows: { 'ep-001': 'v003' } })
  for (const [kind, missing, bound] of [
    ['script', {}, { recreationWorkflowVersion: 'v003' }],
    ['director-book', {}, { recreation_workflow_version: 'v003' }],
    ['timeline', { source_versions: {} }, { source_versions: { recreation_workflow: 'v003' } }],
  ]) {
    await assert.rejects(validateRecreationConsumerBinding(root, kind, 'ep-001', missing), /v003/)
    await validateRecreationConsumerBinding(root, kind, 'ep-001', bound)
  }
})

async function skillProjectFixture(type) {
  const root = await mkdtemp(resolve(tmpdir(), `recreation-skills-${type}-`))
  await mkdir(resolve(root, '.short-drama'), { recursive: true })
  await mkdir(resolve(root, 'episodes'), { recursive: true })
  await writeFile(resolve(root, '.short-drama/project.json'), `${JSON.stringify({ workflow: { type, version: 1 } })}\n`)
  await writeFile(resolve(root, '.short-drama/state.json'), '{"version":1,"stage":"analysis","completed":[],"invalidatedAt":{},"updatedAt":"2026-09-16T00:00:00.000Z"}\n')
  await writeFile(resolve(root, '.short-drama/skill-runs.json'), '{"version":1,"runs":{}}\n')
  return root
}

test('viral-recreation 只在 analysis 动态增加两个复刻 Skill', async () => {
  const standard = await skillProjectFixture('standard')
  const viral = await skillProjectFixture('viral-recreation')
  assert.equal((await requiredSkills(standard, 'analysis')).includes('analyze-reference-video'), false)
  assert.deepEqual((await requiredSkills(viral, 'analysis')).filter((name) => ['analyze-reference-video', 'design-video-recreation'].includes(name)), ['analyze-reference-video', 'design-video-recreation'])
})

test('viral-recreation analysis 门禁报告准备清单、分析和工作流缺口', async () => {
  const root = await skillProjectFixture('viral-recreation')
  const result = await inspectStage(root, 'analysis')
  assert.equal(result.ready, false)
  assert.ok(result.missing.includes('参考视频准备清单'))
  assert.ok(result.missing.includes('参考视频分析'))
  assert.ok(result.missing.includes('至少一个 selected 复刻工作流'))
})

test('复刻证据链绑定 selected 来源、prepared、分析和工作流哈希', async () => {
  const root = await skillProjectFixture('viral-recreation')
  const digest = (value) => createHash('sha256').update(value).digest('hex')
  const sourceContent = Buffer.from('reference-video')
  const sourceHash = digest(sourceContent)
  await mkdir(resolve(root, 'source/src-reference-video'), { recursive: true })
  await writeFile(resolve(root, 'source/src-reference-video/v001.mp4'), sourceContent)
  await writeFile(resolve(root, 'source/manifest.json'), `${JSON.stringify({ version: 1, sources: { 'src-reference-video': { key: 'src-reference-video', kind: 'reference-video', selectedVersionId: 'v001', versions: [{ id: 'v001', localPath: 'source/src-reference-video/v001.mp4', sha256: sourceHash, sizeBytes: sourceContent.length, createdAt: '2026-09-16T00:00:00.000Z' }] } } })}\n`)
  const frameContent = Buffer.from('keyframe')
  const framePath = '.short-drama/reference-video/src-reference-video/v001/frames/shot-001.png'
  await mkdir(dirname(resolve(root, framePath)), { recursive: true })
  await writeFile(resolve(root, framePath), frameContent)
  const prepared = { schema_version: 1, source_ref: { key: 'src-reference-video', version_id: 'v001', local_path: 'source/src-reference-video/v001.mp4', sha256: sourceHash }, technical: { duration_ms: 2000, width: 320, height: 240, fps: 10, has_audio: false }, detection: { scene_threshold: 0.32, max_shots: 200, detected_cut_count: 0 }, shots: [{ shot_number: 1, start_ms: 0, end_ms: 2000, keyframe: { at_ms: 1000, local_path: framePath, sha256: digest(frameContent) } }], audio: null, failures: [], limitations: [], prepared_at: '2026-09-16T00:00:00.000Z' }
  const preparedText = `${JSON.stringify(prepared)}\n`
  await mkdir(resolve(root, '.short-drama/reference-video'), { recursive: true })
  await writeFile(resolve(root, '.short-drama/reference-video/prepared.json'), preparedText)
  const analysis = analysisFixture()
  analysis.source_ref.sha256 = sourceHash
  analysis.prepared_ref.sha256 = digest(preparedText)
  analysis.technical.has_audio = false
  const analysisText = `${JSON.stringify(analysis)}\n`
  await writeFile(resolve(root, '.short-drama/reference-video-analysis.json'), analysisText)
  const workflow = workflowFixture()
  workflow.source_ref.sha256 = sourceHash
  workflow.analysis_ref.sha256 = digest(analysisText)
  await mkdir(resolve(root, 'episodes/ep-001/recreation-workflow'), { recursive: true })
  await writeFile(resolve(root, 'episodes/ep-001/recreation-workflow/v001.json'), `${JSON.stringify(workflow)}\n`)
  await writeFile(resolve(root, 'episodes/ep-001/recreation-workflow/selected.json'), '{"versionId":"v001","path":"episodes/ep-001/recreation-workflow/v001.json"}\n')

  const compileResult = spawnSync(process.execPath, [resolve(scripts, 'recreation-workflow.mjs'), 'compile', root, 'ep-001'], { encoding: 'utf8' })
  assert.equal(compileResult.status, 0, compileResult.stderr)
  const compiledPath = resolve(root, '.short-drama/recreation-compiled/ep-001/v001.json')
  const compiled = JSON.parse(await readFile(compiledPath, 'utf8'))
  assert.equal(compiled.workflow_ref.version_id, 'v001')
  assert.deepEqual(compiled.reference_constraints, analysis.replication)
  assert.deepEqual(compiled.script, workflow.script)
  assert.deepEqual(compiled.media_tracks, workflow.media_tracks)

  assert.deepEqual(await validateRecreationEvidence(root), ['ep-001'])

  analysis.technical = { fps: 10, height: 240, width: 320, has_audio: false, duration_ms: 2000 }
  await writeFile(resolve(root, '.short-drama/reference-video-analysis.json'), `${JSON.stringify(analysis)}\n`)
  workflow.analysis_ref.sha256 = digest(`${JSON.stringify(analysis)}\n`)
  await writeFile(resolve(root, 'episodes/ep-001/recreation-workflow/v001.json'), `${JSON.stringify(workflow)}\n`)
  const reorderedCompile = spawnSync(process.execPath, [resolve(scripts, 'recreation-workflow.mjs'), 'compile', root, 'ep-001'], { encoding: 'utf8' })
  assert.equal(reorderedCompile.status, 0, reorderedCompile.stderr)
  assert.deepEqual(await validateRecreationEvidence(root), ['ep-001'])

  analysis.technical.duration_ms = 3000
  analysis.coverage.complete = false
  analysis.coverage.analyzed_ms = 2000
  await writeFile(resolve(root, '.short-drama/reference-video-analysis.json'), `${JSON.stringify(analysis)}\n`)
  workflow.analysis_ref.sha256 = digest(`${JSON.stringify(analysis)}\n`)
  await writeFile(resolve(root, 'episodes/ep-001/recreation-workflow/v001.json'), `${JSON.stringify(workflow)}\n`)
  await assert.rejects(validateRecreationEvidence(root), /technical.*prepared|技术信息.*准备清单/)

  analysis.technical.duration_ms = 2000
  analysis.coverage.complete = true
  analysis.coverage.analyzed_ms = 2000
  analysis.evidence[0].frame_refs = ['.short-drama/reference-video/missing.png']
  await writeFile(resolve(root, '.short-drama/reference-video-analysis.json'), `${JSON.stringify(analysis)}\n`)
  workflow.analysis_ref.sha256 = digest(`${JSON.stringify(analysis)}\n`)
  await writeFile(resolve(root, 'episodes/ep-001/recreation-workflow/v001.json'), `${JSON.stringify(workflow)}\n`)
  await assert.rejects(validateRecreationEvidence(root), /frame_refs|关键帧/)

  analysis.evidence[0].frame_refs = [framePath]
  analysis.rights.status = 'reference-only'
  await writeFile(resolve(root, '.short-drama/reference-video-analysis.json'), `${JSON.stringify(analysis)}\n`)
  workflow.analysis_ref.sha256 = digest(`${JSON.stringify(analysis)}\n`)
  workflow.rights_mode = 'authorized-close-recreation'
  workflow.rights_basis = '用户声明拥有原片'
  workflow.rights_scope = ['voice']
  await writeFile(resolve(root, 'episodes/ep-001/recreation-workflow/v001.json'), `${JSON.stringify(workflow)}\n`)
  await assert.rejects(validateRecreationEvidence(root), /reference-only|权利状态/)

  analysis.rights.status = 'owned'
  analysis.rights.restrictions = ['voice']
  await writeFile(resolve(root, '.short-drama/reference-video-analysis.json'), `${JSON.stringify(analysis)}\n`)
  workflow.analysis_ref.sha256 = digest(`${JSON.stringify(analysis)}\n`)
  await writeFile(resolve(root, 'episodes/ep-001/recreation-workflow/v001.json'), `${JSON.stringify(workflow)}\n`)
  await assert.rejects(validateRecreationEvidence(root), /rights_scope|限制/)

  analysis.rights.restrictions = []
  analysis.rights.allowed_uses.push('voice')
  await writeFile(resolve(root, '.short-drama/reference-video-analysis.json'), `${JSON.stringify(analysis)}\n`)
  workflow.analysis_ref.sha256 = digest(`${JSON.stringify(analysis)}\n`)
  await writeFile(resolve(root, 'episodes/ep-001/recreation-workflow/v001.json'), `${JSON.stringify(workflow)}\n`)
  const refreshedCompile = spawnSync(process.execPath, [resolve(scripts, 'recreation-workflow.mjs'), 'compile', root, 'ep-001'], { encoding: 'utf8' })
  assert.equal(refreshedCompile.status, 0, refreshedCompile.stderr)
  assert.deepEqual(await validateRecreationEvidence(root), ['ep-001'])

  compiled.workflow_ref.sha256 = 'e'.repeat(64)
  await writeFile(compiledPath, `${JSON.stringify(compiled)}\n`)
  await assert.rejects(validateRecreationEvidence(root), /编译产物.*哈希|workflow_ref/)
  const recompileResult = spawnSync(process.execPath, [resolve(scripts, 'recreation-workflow.mjs'), 'compile', root, 'ep-001'], { encoding: 'utf8' })
  assert.equal(recompileResult.status, 0, recompileResult.stderr)

  workflow.analysis_ref.sha256 = 'f'.repeat(64)
  await writeFile(resolve(root, 'episodes/ep-001/recreation-workflow/v001.json'), `${JSON.stringify(workflow)}\n`)
  await assert.rejects(validateRecreationEvidence(root), /分析哈希/)
})

test('编译产物拒绝通过符号链接目录写到项目外', async () => {
  const root = await skillProjectFixture('viral-recreation')
  const outside = await mkdtemp(resolve(tmpdir(), 'recreation-compiled-outside-'))
  const analysis = analysisFixture()
  const analysisText = `${JSON.stringify(analysis)}\n`
  await writeFile(resolve(root, '.short-drama/reference-video-analysis.json'), analysisText)
  const workflow = workflowFixture()
  workflow.analysis_ref.sha256 = createHash('sha256').update(analysisText).digest('hex')
  await mkdir(resolve(root, 'episodes/ep-001/recreation-workflow'), { recursive: true })
  await writeFile(resolve(root, 'episodes/ep-001/recreation-workflow/v001.json'), `${JSON.stringify(workflow)}\n`)
  await writeFile(resolve(root, 'episodes/ep-001/recreation-workflow/selected.json'), '{"versionId":"v001","path":"episodes/ep-001/recreation-workflow/v001.json"}\n')
  await symlink(outside, resolve(root, '.short-drama/recreation-compiled'))

  const result = spawnSync(process.execPath, [resolve(scripts, 'recreation-workflow.mjs'), 'compile', root, 'ep-001'], { encoding: 'utf8' })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /符号链接|项目目录/)
  await assert.rejects(access(resolve(outside, 'ep-001.json')))
})
