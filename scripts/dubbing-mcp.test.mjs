import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { addAssetVersion, putAsset, selectAssetVersion } from './asset-ledger.mjs'
import { listTasks } from './task-ledger.mjs'
import { call, compileGeneratedAudioArguments, tools } from './generation/mcp.mjs'

const contract = {
  mode: 'generated',
  timing_source: { episode_key: 'ep-001', version_id: 'v002', line_index: 1, source_asset: { asset_key: 'shot-ep001-001', version_id: 'v001', sha256: 'a'.repeat(64) } },
  target_range: { start_ms: 0, end_ms: 900 }, target_speech_ms: 770,
  original_text: '别回头。', adapted_text: '别回头。', adaptation: null,
  performance: { intent: '阻止对方看见危险', subtext: '不能让对方察觉', emotion_arc: [{ at: 0, emotion: '警觉', intensity: 0.1234 }], pace: '短促', emphasis: ['别'], pause_plan: [{ after: '别', duration_ms: 70 }], breath: '轻吸气', distance_and_space: '近距离' },
  fit_policy: { max_paid_generations: 3, provider_speed_min: 0.85, provider_speed_max: 1.15, max_post_tempo_percent: 3, text_adaptation_allowed: true },
}

test('生成入口从当前 audio-plan 派生合同版本、voice binding 和授权列表', () => {
  const line = { line_index: 1, voice_binding: { voice_id: 'linwan' }, dubbing_contract: contract }
  const audioPlan = { voice_bindings: [{ voice_id: 'linwan' }] }
  const result = compileGeneratedAudioArguments({
    providerArgs: { provider: 'bailian', model: 'cosyvoice-v3.5-plus', voice: 'linwan', input: '别回头。', confirmed: true, dubbing_attempt: 2, measured_speech_ms: 700 },
    line, audioPlan, audioPlanVersion: 'v003',
  })
  assert.equal(result.compiled.snapshot.contract_version, 'v003')
  assert.equal(result.arguments.instruction.includes('0|警觉|0.1234'), true)
  assert.equal('dubbing_attempt' in result.arguments, false)
  assert.equal('measured_speech_ms' in result.arguments, false)
})

test('普通生成入口拒绝 native-preserve 合同', () => {
  const nativeLine = {
    line_index: 1,
    voice_binding: { voice_id: 'linwan' },
    dubbing_contract: {
      mode: 'native-preserve',
      timing_source: contract.timing_source,
      target_range: contract.target_range,
      performance_reference: contract.performance,
    },
  }
  assert.throws(() => compileGeneratedAudioArguments({
    providerArgs: { provider: 'bailian', model: 'cosyvoice-v3.5-plus', voice: 'linwan', input: '伪造直接配音', speed: 2 },
    line: nativeLine,
    audioPlan: { voice_bindings: [{ voice_id: 'linwan' }] },
    audioPlanVersion: 'v003',
  }), /native-preserve|原声保留|兜底/)
})

async function fixture() {
  const root = await mkdtemp(resolve(tmpdir(), 'dubbing-mcp-'))
  const audioPath = resolve(root, 'assets/audio/audio-ep001-source/v001.wav')
  await mkdir(dirname(audioPath), { recursive: true })
  await writeFile(audioPath, 'source-audio')
  await putAsset(root, { key: 'audio-ep001-source', type: 'audio', name: '来源音频' })
  await addAssetVersion(root, 'audio-ep001-source', { id: 'v001', localPath: 'assets/audio/audio-ep001-source/v001.wav', provenance: { origin: 'imported', created_by: 'user', provider: null, model_or_workflow: null, task_id: null, prompt_document: null, source_assets: [], parameters: {} } })
  await selectAssetVersion(root, 'audio-ep001-source', 'v001')
  const planDir = resolve(root, 'episodes/ep-001/audio-plan')
  await mkdir(planDir, { recursive: true })
  const line = { line_index: 1, speaker: '林晚', delivery_mode: 'post_dub', presentation: 'visible-dialogue', voice_binding: { voice_id: 'linwan' }, dubbing_contract: contract }
  const plan = { episode_key: 'ep-001', approved: true, unresolved: [], voice_bindings: [{ voice_id: 'linwan' }], lines: [line] }
  await writeFile(resolve(planDir, 'v003.json'), `${JSON.stringify(plan)}\n`)
  await writeFile(resolve(planDir, 'selected.json'), `${JSON.stringify({ versionId: 'v003', path: 'episodes/ep-001/audio-plan/v003.json' })}\n`)
  return root
}

test('分析和编译工具不创建付费任务且已注册', async () => {
  const root = await fixture()
  try {
    const analyzed = await call('analyze_speech_timing', { project_root: root, source: { asset_key: 'audio-ep001-source', version_id: 'v001' }, timing: { episode_key: 'ep-001', method: 'manual-direction', language: 'zh-CN', lines: [{ line_index: 1, start_ms: 0, end_ms: 900, words: [{ text: '别回头', start_ms: 0, end_ms: 900 }], evidence: '人工核对源音轨' }] } })
    assert.equal(analyzed.version_id, 'v001')
    const compiled = await call('compile_dubbing_request', { project_root: root, episode_key: 'ep-001', audio_plan_version: 'v003', line_index: 1, provider: 'bailian', model: 'cosyvoice-v3.5-plus', voice: 'linwan', attempt: 1 })
    assert.equal(compiled.supported, true)
    assert.deepEqual(await listTasks(root), [])
    for (const name of ['analyze_speech_timing', 'review_speech_timing', 'compile_dubbing_request', 'review_dubbing_performance', 'build_subtitles_from_audio']) assert.equal(tools.some((tool) => tool.name === name), true)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('编译工具拒绝第四轮付费生成', async () => {
  const root = await fixture()
  try {
    await assert.rejects(() => call('compile_dubbing_request', { project_root: root, episode_key: 'ep-001', audio_plan_version: 'v003', line_index: 1, provider: 'bailian', model: 'cosyvoice-v3.5-plus', voice: 'linwan', attempt: 4 }), /最多 3 次|attempt|轮次|能力不匹配/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('字幕 MCP 拒绝调用者伪造资产、SHA 和 timing 证据', async () => {
  await assert.rejects(() => call('build_subtitles_from_audio', {
    input: {
      audio: { asset_key: 'audio-does-not-exist', version_id: 'v999', sha256: 'f'.repeat(64) },
      timing: { version_id: 'v999', lines: [{ line_index: 1, start_ms: 0, end_ms: 900, words: [] }] },
      contracts: [{ line_index: 1, content: '伪造字幕', dubbing_contract_version: 'v999', dubbing_contract: { target_range: { start_ms: 0, end_ms: 900 } } }],
      fps: 24,
      timeline_end_ms: 1000,
    },
  }), /项目|project_root|selected|资产/)
})

test('native-preserve 字幕直接绑定合同来源视频的原生声轨', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'native-subtitle-mcp-'))
  try {
    const videoPath = resolve(root, 'assets/videos/shot-ep001-001/v001.mp4')
    await mkdir(dirname(videoPath), { recursive: true })
    await writeFile(videoPath, 'native-video-with-audio-evidence')
    await putAsset(root, { key: 'shot-ep001-001', type: 'video', name: '原生对白镜头' })
    await addAssetVersion(root, 'shot-ep001-001', { id: 'v001', localPath: 'assets/videos/shot-ep001-001/v001.mp4', provenance: { origin: 'imported', created_by: 'user', provider: null, model_or_workflow: null, task_id: null, prompt_document: null, source_assets: [], parameters: {} } })
    await selectAssetVersion(root, 'shot-ep001-001', 'v001')
    const ledger = JSON.parse(await readFile(resolve(root, '.short-drama/assets.json'), 'utf8'))
    const source = { asset_key: 'shot-ep001-001', version_id: 'v001', sha256: ledger.assets['shot-ep001-001'].versions[0].sha256 }
    const timingDir = resolve(root, 'episodes/ep-001/speech-timing')
    await mkdir(resolve(timingDir, 'selected-sources/shot-ep001-001/v001'), { recursive: true })
    await writeFile(resolve(timingDir, 'v001.json'), `${JSON.stringify({ episode_key: 'ep-001', source_asset: source, method: 'manual-direction', reviewed: true, language: 'zh-CN', lines: [{ line_index: 1, start_ms: 100, end_ms: 900, words: [{ text: '别回头', start_ms: 100, end_ms: 900 }], evidence: '人工核对原声' }] })}\n`)
    await writeFile(resolve(timingDir, 'selected-sources/shot-ep001-001/v001/selected.json'), `${JSON.stringify({ versionId: 'v001', source_asset_sha256: source.sha256 })}\n`)
    const planDir = resolve(root, 'episodes/ep-001/audio-plan')
    await mkdir(planDir, { recursive: true })
    const nativeContract = { mode: 'native-preserve', timing_source: { episode_key: 'ep-001', version_id: 'v001', line_index: 1, source_asset: source }, target_range: { start_ms: 100, end_ms: 900 }, performance_reference: contract.performance }
    await writeFile(resolve(planDir, 'v001.json'), `${JSON.stringify({ episode_key: 'ep-001', approved: true, unresolved: [], lines: [{ line_index: 1, content: '别回头', speaker: '林晚', dubbing_contract: nativeContract }] })}\n`)
    await writeFile(resolve(planDir, 'selected.json'), `${JSON.stringify({ versionId: 'v001', path: 'episodes/ep-001/audio-plan/v001.json' })}\n`)

    const [subtitle] = await call('build_subtitles_from_audio', { project_root: root, episode_key: 'ep-001', line_index: 1, fps: 24, timeline_end_ms: 1000 })
    assert.deepEqual({ asset_key: subtitle.audio_binding.asset_key, version_id: subtitle.audio_binding.version_id, speech_timing_version: subtitle.audio_binding.speech_timing_version }, { asset_key: 'shot-ep001-001', version_id: 'v001', speech_timing_version: 'v001' })
  } finally { await rm(root, { recursive: true, force: true }) }
})
