import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { addAssetVersion, putAsset, selectAssetVersion } from './asset-ledger.mjs'
import { validateTimeline } from './editing-store.mjs'
import { putFinalSpeechAlignment } from './speech-timing.mjs'

const { call } = await import('./generation/mcp.mjs')
const reasons = ['provider-no-native-audio', 'voice-identity-drift', 'speech-intelligibility-failed', 'narration-performance-failed', 'audio-sync-failed', 'native-ambience-failed']

function media(path, type) {
  const input = type === 'video'
    ? ['-f', 'lavfi', '-i', 'color=c=gray:s=320x180:r=24:d=2', '-c:v', 'mpeg4', '-pix_fmt', 'yuv420p']
    : ['-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:a', 'pcm_s16le']
  const result = spawnSync('ffmpeg', ['-nostdin', '-loglevel', 'error', ...input, '-y', path], { encoding: 'utf8' })
  if (result.error || result.status !== 0) throw new Error(result.stderr || '媒体夹具生成失败')
}

async function fixture({ presentation = 'visible-dialogue', delivery = 'post_dub', alignmentSourceVersion = 'v001' } = {}) {
  const root = await mkdtemp(resolve(tmpdir(), 'short-drama-lip-sync-'))
  await mkdir(resolve(root, '.short-drama'), { recursive: true })
  await writeFile(resolve(root, '.short-drama/project.json'), '{}\n')
  await writeFile(resolve(root, '.short-drama/state.json'), `${JSON.stringify({ stage: 'editing', completed: [] })}\n`)
  const video = resolve(root, 'assets/videos/shot-ep001-001/v001.mp4'), audio = resolve(root, 'assets/audio/audio-ep001-dialogue-001/v001.wav')
  await mkdir(dirname(video), { recursive: true }); await mkdir(dirname(audio), { recursive: true })
  media(video, 'video'); media(audio, 'audio')
  await putAsset(root, { key: 'shot-ep001-001', type: 'video', name: '镜头 1' })
  await addAssetVersion(root, 'shot-ep001-001', { id: 'v001', localPath: 'assets/videos/shot-ep001-001/v001.mp4', provenance: { origin: 'generated', created_by: 'provider', provider: 'test', model_or_workflow: 'video', task_id: 'video-1', prompt_document: { episode_key: 'ep-001', version_id: 'v001', shot_number: 1 }, source_assets: [], parameters: {} } })
  await selectAssetVersion(root, 'shot-ep001-001', 'v001')
  const sourceVideoSha = JSON.parse(await readFile(resolve(root, '.short-drama/assets.json'), 'utf8')).assets['shot-ep001-001'].versions[0].sha256
  await putAsset(root, { key: 'audio-ep001-dialogue-001', type: 'audio', name: '对白 1' })
  await addAssetVersion(root, 'audio-ep001-dialogue-001', { id: 'v001', localPath: 'assets/audio/audio-ep001-dialogue-001/v001.wav', provenance: { origin: 'imported', created_by: 'user', provider: null, model_or_workflow: null, task_id: null, prompt_document: null, source_assets: [], parameters: {} } })
  await selectAssetVersion(root, 'audio-ep001-dialogue-001', 'v001')
  const directory = resolve(root, 'episodes/ep-001/audio-plan')
  await mkdir(directory, { recursive: true })
  const sourceAudio = delivery === 'native' ? null : { asset_key: 'audio-ep001-dialogue-001', version_id: 'v001' }
  const line = { line_index: 1, speaker: '林晚', line_type: 'dialogue', content: '别回头。', emotion: '紧张', emotion_strength: 0.3, pronunciation_notes: [], matched_shot: { shot_number: 1 }, range: { start_ms: 0, end_ms: 1000 }, delivery_mode: delivery, presentation, fallback_mode: 'post-dub', source_audio: sourceAudio, voice_binding: { voice_id: 'linwan' }, native_audio_exception: null, performance: null, dubbing_contract: { mode: delivery === 'native' ? 'native-preserve' : 'generated', timing_source: { episode_key: 'ep-001', version_id: 'v001', line_index: 1, source_asset: { asset_key: 'shot-ep001-001', version_id: 'v001', sha256: sourceVideoSha } }, target_range: { start_ms: 0, end_ms: 1000 } } }
  const plan = { episode_key: 'ep-001', audio_strategy: { mode: 'native-first', provider_selection: 'prefer-native', fallback_allowed: true, fallback_reasons: reasons }, lines: [line], unresolved: [], approved: true }
  await writeFile(resolve(directory, 'v001.json'), `${JSON.stringify(plan, null, 2)}\n`)
  await writeFile(resolve(directory, 'selected.json'), `${JSON.stringify({ versionId: 'v001', path: 'episodes/ep-001/audio-plan/v001.json' }, null, 2)}\n`)
  const assets = JSON.parse(await readFile(resolve(root, '.short-drama/assets.json'), 'utf8'))
  const audioSha = assets.assets['audio-ep001-dialogue-001'].versions[0].sha256
  await putFinalSpeechAlignment(root, {
    episode_key: 'ep-001', line_index: 1,
    audio_asset: { asset_key: 'audio-ep001-dialogue-001', version_id: 'v001', sha256: audioSha },
    audio_plan_version: 'v001',
    source_timing: { version_id: alignmentSourceVersion, line_index: 1, source_asset: line.dubbing_contract.timing_source.source_asset },
    text: '别回头。', words: [{ text: '别回头。', start_ms: 0, end_ms: 1000 }],
    timeline_mapping: { audio_in_ms: 0, timeline_at_ms: 0 }, timeline_fps: 24, reviewed: true,
  })
  return root
}

const request = (root, parameters = {}) => {
  const ledger = JSON.parse(readFileSync(resolve(root, '.short-drama/assets.json'), 'utf8'))
  const audioSha = ledger.assets['audio-ep001-dialogue-001'].versions[0].sha256
  return ({
  project_root: root, target: 'shot-ep001-001', operation: 'lip-sync', provider: 'musetalk',
  source: { asset_key: 'shot-ep001-001', version_id: 'v001' }, audio: { asset_key: 'audio-ep001-dialogue-001', version_id: 'v001' },
  range: { start_ms: 0, end_ms: 1000 }, parameters: { audio_plan: { episode_key: 'ep-001', version_id: 'v001', line_index: 1 }, audio_binding: { asset_key: 'audio-ep001-dialogue-001', version_id: 'v001', sha256: audioSha, line_index: 1, speech_timing_version: 'v001', dubbing_contract_version: 'v001' }, face_selector: { mode: 'single-visible-face', character_key: 'char-linwan' }, ...parameters }, confirmed: false,
  })
}

test('旁白、画外音、合格原生对白和多人脸禁止口型操作', async () => {
  for (const presentation of ['narration', 'offscreen-dialogue']) {
    const root = await fixture({ presentation })
    try { await assert.rejects(call('submit_media_operation', request(root)), /不得执行对口型/) } finally { await rm(root, { recursive: true, force: true }) }
  }
  const nativeRoot = await fixture({ delivery: 'native' })
  try { await assert.rejects(call('submit_media_operation', request(nativeRoot)), /原生对白不得执行对口型/) } finally { await rm(nativeRoot, { recursive: true, force: true }) }
  const faceRoot = await fixture()
  try { await assert.rejects(call('submit_media_operation', request(faceRoot, { face_selector: { mode: 'multiple' } })), /唯一可见人脸/) } finally { await rm(faceRoot, { recursive: true, force: true }) }
})

test('口型入口拒绝伪造最终对齐版本', async () => {
  const root = await fixture()
  try {
    await assert.rejects(call('submit_media_operation', request(root, { audio_binding: { ...request(root).parameters.audio_binding, speech_timing_version: 'v002' } })), /最终词级对齐版本/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('口型入口拒绝最终对齐绑定错误的源 timing', async () => {
  const root = await fixture({ alignmentSourceVersion: 'v002' })
  try {
    await assert.rejects(call('submit_media_operation', request(root)), /最终对齐.*源 timing/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('MuseTalk 输出经请求快照登记为未选中的变换候选', async () => {
  const root = await fixture(), previous = { root: process.env.MUSETALK_ROOT, python: process.env.MUSETALK_PYTHON, entry: process.env.MUSETALK_ENTRYPOINT }
  try {
    const local = resolve(root, 'musetalk')
    await mkdir(local)
    await writeFile(resolve(local, 'fake.mjs'), `import { copyFile } from 'node:fs/promises'\nconst value=(name)=>process.argv[process.argv.indexOf(name)+1]\nawait copyFile(value('--video'),value('--output'))\n`)
    await chmod(resolve(local, 'fake.mjs'), 0o755)
    process.env.MUSETALK_ROOT = local; process.env.MUSETALK_PYTHON = process.execPath; process.env.MUSETALK_ENTRYPOINT = 'fake.mjs'
    const result = await call('submit_media_operation', { ...request(root), confirmed: true })
    assert.deepEqual(result.output_version_ids, ['v002'])
    const ledger = JSON.parse(await readFile(resolve(root, '.short-drama/assets.json'), 'utf8'))
    const candidate = ledger.assets['shot-ep001-001'].versions.find((item) => item.id === 'v002')
    assert.equal(ledger.assets['shot-ep001-001'].selectedVersionId, 'v001')
    assert.equal(candidate.provenance.origin, 'transformed')
    assert.deepEqual(candidate.provenance.source_assets, [{ key: 'shot-ep001-001', version_id: 'v001' }, { key: 'audio-ep001-dialogue-001', version_id: 'v001' }])
  } finally {
    if (previous.root === undefined) delete process.env.MUSETALK_ROOT; else process.env.MUSETALK_ROOT = previous.root
    if (previous.python === undefined) delete process.env.MUSETALK_PYTHON; else process.env.MUSETALK_PYTHON = previous.python
    if (previous.entry === undefined) delete process.env.MUSETALK_ENTRYPOINT; else process.env.MUSETALK_ENTRYPOINT = previous.entry
    await rm(root, { recursive: true, force: true })
  }
})

test('未通过当前版本口型专项审核不能进入时间线', async () => {
  const root = await fixture()
  try {
    await mkdir(resolve(root, 'episodes/ep-001'), { recursive: true })
    await writeFile(resolve(root, 'episodes/ep-001/episode.json'), '{}\n')
    await copyFile(resolve(root, 'assets/videos/shot-ep001-001/v001.mp4'), resolve(root, 'assets/videos/shot-ep001-001/v002.mp4'))
    const ledger = JSON.parse(await readFile(resolve(root, '.short-drama/assets.json'), 'utf8'))
    const source = ledger.assets['shot-ep001-001'].versions[0]
    const audioSha = ledger.assets['audio-ep001-dialogue-001'].versions[0].sha256
    const audioBinding = { asset_key: 'audio-ep001-dialogue-001', version_id: 'v001', sha256: audioSha, line_index: 1, speech_timing_version: 'v001', dubbing_contract_version: 'v001' }
    await addAssetVersion(root, 'shot-ep001-001', { id: 'v002', localPath: 'assets/videos/shot-ep001-001/v002.mp4', provenance: { origin: 'transformed', created_by: 'provider', provider: 'musetalk', model_or_workflow: 'musetalk-1.5', task_id: 'lip-1', prompt_document: null, source_assets: [{ key: 'shot-ep001-001', version_id: 'v001' }, { key: 'audio-ep001-dialogue-001', version_id: 'v001' }], parameters: { operation: 'lip-sync', range: { start_ms: 0, end_ms: 1000 }, parameters: { audio_plan: { episode_key: 'ep-001', version_id: 'v001', line_index: 1 }, audio_binding: audioBinding }, source_sha256: source.sha256 } } })
    await selectAssetVersion(root, 'shot-ep001-001', 'v002')
    const timeline = { episode_key: 'ep-001', fps: 24, width: 320, height: 180, segments: [{ shot_key: 'shot-ep001-001', asset_key: 'shot-ep001-001', version_id: 'v002', source_in_ms: 0, source_out_ms: 1000, timeline_start_ms: 0, timeline_end_ms: 1000, transition: { type: 'hard-cut', duration_frames: 0 }, dialogue_sync: 'lip-synced' }], subtitles: [{ text: '别回头', startMs: 0, endMs: 1000, timestampMs: 0, confidence: 1, speaker: '林晚', audio_binding: audioBinding }], subtitle_source: { method: 'manual-transcription', reviewed: true, source_assets: [{ asset_key: 'audio-ep001-dialogue-001', version_id: 'v001' }], audio_bindings: [audioBinding] }, audio_tracks: [{ asset_key: 'audio-ep001-dialogue-001', version_id: 'v001', role: 'dialogue', source_in_ms: 0, source_out_ms: 1000, timeline_start_ms: 0, timeline_end_ms: 1000, volume_envelope: [], audio_binding: audioBinding }], labels: [], graphics: [], mix: { target_lufs: -16, true_peak_dbtp: -1 }, sound_design_exception: { confirmed: true, reason: '测试夹具只验证对白同源性' } }
    await writeFile(resolve(root, '.short-drama/shot-reviews.json'), `${JSON.stringify({ version: 1, reviews: { 'shot-ep001-001@v002': { approved: true } } }, null, 2)}\n`)
    await assert.rejects(validateTimeline(root, timeline), /口型专项审核/)
    await writeFile(resolve(root, '.short-drama/shot-reviews.json'), `${JSON.stringify({ version: 1, reviews: { 'shot-ep001-001@v002': { approved: true, review_type: 'media-operation', operation: 'lip-sync' } } }, null, 2)}\n`)
    await assert.rejects(validateTimeline(root, timeline), /speech-timing/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('保留原生声轨的字幕可绑定 selected 视频及当前 timing', async () => {
  const root = await fixture({ delivery: 'native' })
  try {
    await mkdir(resolve(root, 'episodes/ep-001/speech-timing'), { recursive: true })
    await writeFile(resolve(root, 'episodes/ep-001/episode.json'), '{}\n')
    const ledger = JSON.parse(await readFile(resolve(root, '.short-drama/assets.json'), 'utf8'))
    const video = ledger.assets['shot-ep001-001'].versions[0]
    const timing = { episode_key: 'ep-001', source_asset: { asset_key: 'shot-ep001-001', version_id: 'v001', sha256: video.sha256 }, method: 'manual-direction', reviewed: true, language: 'zh-CN', lines: [{ line_index: 1, start_ms: 0, end_ms: 1000, words: [{ text: '别回头', start_ms: 100, end_ms: 900 }], evidence: '人工核对原生声轨' }] }
    await writeFile(resolve(root, 'episodes/ep-001/speech-timing/v001.json'), `${JSON.stringify(timing)}\n`)
    await writeFile(resolve(root, 'episodes/ep-001/speech-timing/selected.json'), `${JSON.stringify({ versionId: 'v001', path: 'episodes/ep-001/speech-timing/v001.json', source_asset_sha256: video.sha256, reviewed_by: 'codex' })}\n`)
    await writeFile(resolve(root, '.short-drama/shot-reviews.json'), `${JSON.stringify({ version: 1, reviews: { 'shot-ep001-001@v001': { approved: true } } })}\n`)
    const binding = { asset_key: 'shot-ep001-001', version_id: 'v001', sha256: video.sha256, line_index: 1, speech_timing_version: 'v001', dubbing_contract_version: 'v001' }
    const timeline = { episode_key: 'ep-001', fps: 24, width: 320, height: 180, segments: [{ shot_key: 'shot-ep001-001', asset_key: 'shot-ep001-001', version_id: 'v001', source_in_ms: 0, source_out_ms: 1000, timeline_start_ms: 0, timeline_end_ms: 1000, transition: { type: 'hard-cut', duration_frames: 0 }, dialogue_sync: 'native' }], subtitles: [{ text: '别回头', startMs: 0, endMs: 1000, timestampMs: 100, confidence: 1, speaker: '林晚', audio_binding: binding }], subtitle_source: { method: 'manual-transcription', reviewed: true, source_assets: [{ asset_key: 'shot-ep001-001', version_id: 'v001' }], audio_bindings: [binding] }, audio_tracks: [{ asset_key: 'shot-ep001-001', version_id: 'v001', role: 'dialogue', source_in_ms: 0, source_out_ms: 1000, timeline_start_ms: 0, timeline_end_ms: 1000, volume_envelope: [], audio_binding: binding }], labels: [], graphics: [], mix: { target_lufs: -16, true_peak_dbtp: -1 }, sound_design_exception: { confirmed: true, reason: '保留原生环境声' } }
    await assert.doesNotReject(validateTimeline(root, timeline))
  } finally { await rm(root, { recursive: true, force: true }) }
})
