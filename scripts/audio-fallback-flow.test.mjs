import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { addAssetVersion, putAsset } from './asset-ledger.mjs'

const { call, persistDerivedFallbackContract, tools } = await import('./generation/mcp.mjs')

async function rootFixture() {
  const root = await mkdtemp(resolve(tmpdir(), 'short-drama-audio-fallback-'))
  await mkdir(resolve(root, '.short-drama'), { recursive: true })
  await writeFile(resolve(root, '.short-drama/project.json'), '{}')
  await writeFile(resolve(root, '.short-drama/state.json'), `${JSON.stringify({ stage: 'media-production', completed: [] })}\n`)
  return root
}

test('外部音频必须有使用权确认和真实音频流', async () => {
  const root = await rootFixture()
  try {
    const textFile = resolve(root, 'not-audio.txt')
    await writeFile(textFile, 'not audio')
    await assert.rejects(call('import_external_audio', { project_root: root, target: 'audio-ep001-external', local_file: textFile, usage_scope: 'commercial-authorized', rights_confirmed: true, confirmed: true }), /音频流/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('有效外部音频登记为未选候选且保留权利范围', async () => {
  const root = await rootFixture()
  try {
    const audio = resolve(root, 'licensed.wav')
    const generated = spawnSync('ffmpeg', ['-nostdin', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:a', 'pcm_s16le', '-y', audio], { encoding: 'utf8' })
    if (generated.error || generated.status !== 0) throw new Error(generated.stderr || '测试音频生成失败')
    const imported = await call('import_external_audio', { project_root: root, target: 'audio-ep001-external', local_file: audio, name: '已授权测试音频', usage_scope: 'commercial-authorized', rights_confirmed: true, confirmed: true })
    assert.equal(imported.selected, false)
    assert.equal(imported.provenance.parameters.usage_scope, 'commercial-authorized')
    const ledger = JSON.parse(await readFile(resolve(root, '.short-drama/assets.json'), 'utf8'))
    assert.equal(ledger.assets['audio-ep001-external'].selectedVersionId ?? null, null)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('旁白兜底必须绑定 narrator 和电影感档案', async () => {
  await assert.rejects(call('generate_audio_fallback', { presentation: 'narration', voice_binding: { voice_role: 'character', voice_id: 'character-a' } }), /narrator/)
})

test('兜底预检保存异常、区间和混音来源且不产生付费任务', async () => {
  const root = await rootFixture()
  const key = 'shot-ep001-001'
  try {
    const videoPath = resolve(root, `assets/videos/${key}/v001.mp4`)
    await mkdir(dirname(videoPath), { recursive: true })
    await writeFile(videoPath, 'candidate-video')
    await putAsset(root, { key, type: 'video', name: '镜头 1' })
    await addAssetVersion(root, key, { id: 'v001', localPath: `assets/videos/${key}/v001.mp4`, provenance: { origin: 'generated', created_by: 'provider', provider: 'starrouter', model_or_workflow: 'video', task_id: 'video-task', prompt_document: { episode_key: 'ep-001', version_id: 'v001', shot_number: 1 }, source_assets: [], parameters: {} } })
    const performanceReference = { intent: '预示风暴逼近', subtext: '压住恐惧提醒观众', emotion_arc: [{ at: 0, emotion: '平静', intensity: 0.3 }, { at: 1, emotion: '警觉', intensity: 0.7 }], emphasis: ['风暴'], pause_plan: [{ after: '风暴', duration_ms: 100 }], breath: '转折前轻吸气' }
    const plan = { episode_key: 'ep-001', approved: true, unresolved: [], lines: [{ line_index: 1, speaker: 'narrator', content: '风暴终于来了。', matched_shot: { shot_number: 1 }, delivery_mode: 'native', presentation: 'narration', fallback_mode: 'cinematic-tts', performance: { tone_arc: '平静转警觉', emotion_beats: ['低声', '停顿', '收束'], pace: '中慢', breath_and_pause: '转折停半拍', distance_and_space: '近讲' }, dubbing_contract: { mode: 'native-preserve', timing_source: { episode_key: 'ep-001', version_id: 'v001', line_index: 1, source_asset: { asset_key: key, version_id: 'v001', sha256: createHash('sha256').update('candidate-video').digest('hex') } }, target_range: { start_ms: 1000, end_ms: 2500 }, performance_reference: performanceReference } }], voice_bindings: [{ speaker: 'narrator', provider: 'bailian', model: 'cosyvoice-v3.5-plus', voice_id: 'narrator-voice' }] }
    const planDir = resolve(root, 'episodes/ep-001/audio-plan')
    await mkdir(planDir, { recursive: true })
    await writeFile(resolve(planDir, 'v001.json'), `${JSON.stringify(plan)}\n`)
    await writeFile(resolve(planDir, 'selected.json'), `${JSON.stringify({ versionId: 'v001', path: 'episodes/ep-001/audio-plan/v001.json' })}\n`)
    const dimensions = Object.fromEntries(['speech_intelligibility', 'speaker_identity', 'ambience_action_sync', 'lip_sync', 'technical_audio', 'undeclared_music'].map((name) => [name, { passed: true, observation: `${name} 通过` }]))
    dimensions.narration_performance = { passed: false, observation: '情绪节拍平直', ranges: [{ start_ms: 1000, end_ms: 2500 }] }
    const auditDir = resolve(root, '.short-drama/audio-audits')
    await mkdir(auditDir, { recursive: true })
    await writeFile(resolve(auditDir, `${key}@v001.json`), `${JSON.stringify({ episode_key: 'ep-001', shot_number: 1, asset_key: key, version_id: 'v001', sha256: createHash('sha256').update('candidate-video').digest('hex'), approved: false, watched_full: true, full_range: { start_ms: 0, end_ms: 5000 }, dimensions })}\n`)
    const preview = await call('generate_audio_fallback', { project_root: root, episode_key: 'ep-001', audio_plan_version: 'v001', line_index: 1, source_video: { asset_key: key, version_id: 'v001' }, target: 'audio-ep001-narrator-fallback', provider: 'bailian', model: 'cosyvoice-v3.5-plus', voice: 'narrator-voice', voice_binding: { voice_role: 'narrator', provider: 'bailian', model: 'cosyvoice-v3.5-plus', voice_id: 'narrator-voice', cinematic_profile: plan.lines[0].performance }, reason: 'narration-performance-failed', range: { start_ms: 1000, end_ms: 2500 }, mix_sources: ['native-ambience-action', 'cinematic-tts'], confirmed: false })
    assert.equal(preview.requires_confirmation, true)
    assert.equal(preview.provenance.native_audio_exception.reason, 'narration-performance-failed')
    assert.deepEqual(preview.provenance.replaced_ranges, [{ start_ms: 1000, end_ms: 2500 }])
    assert.ok(tools.some((tool) => tool.name === 'generate_audio_fallback'))
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('兜底生成合同必须连同原声失败证据持久化', async () => {
  const root = await rootFixture()
  try {
    const record = {
      version: 1, episode_key: 'ep-001', line_index: 1, audio_plan_version: 'v001',
      source_video: { asset_key: 'shot-ep001-001', version_id: 'v001' },
      native_audio_exception: { reason: 'speech-intelligibility-failed', evidence: '原声含混', range: { start_ms: 0, end_ms: 900 } },
      generated_contract: { mode: 'generated', target_range: { start_ms: 0, end_ms: 900 } },
    }
    const saved = await persistDerivedFallbackContract(root, record)
    assert.match(saved.path, /^episodes\/ep-001\/audio-plan\/fallback-contracts\/line-001-/)
    assert.deepEqual(JSON.parse(await readFile(resolve(root, saved.path), 'utf8')), record)
    await assert.rejects(() => persistDerivedFallbackContract(root, { ...record, native_audio_exception: null }), /失败证据/)
  } finally { await rm(root, { recursive: true, force: true }) }
})
