import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { addAssetVersion, putAsset, selectAssetVersion } from './asset-ledger.mjs'

const projectStore = fileURLToPath(new URL('./project-store.mjs', import.meta.url))
const sourceBytes = 'source-video'
const sourceAsset = { asset_key: 'shot-ep001-001', version_id: 'v001', sha256: createHash('sha256').update(sourceBytes).digest('hex') }
const provenance = { origin: 'imported', created_by: 'user', provider: null, model_or_workflow: null, task_id: null, prompt_document: null, source_assets: [], parameters: {} }
const strategy = { mode: 'native-first', provider_selection: 'prefer-native', fallback_allowed: true, fallback_reasons: ['provider-no-native-audio', 'voice-identity-drift', 'speech-intelligibility-failed', 'narration-performance-failed', 'audio-sync-failed', 'native-ambience-failed'] }
const performance = { intent: '阻止对方看见危险', subtext: '不让对方察觉恐惧', emotion_arc: [{ at: 0, emotion: '警觉', intensity: 0.4 }, { at: 1, emotion: '急迫', intensity: 0.7 }], pace: '短促', emphasis: ['别'], pause_plan: [{ after: '别', duration_ms: 70 }], breath: '轻吸气', distance_and_space: '近距离低声' }

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`)
}

function audioPlan(overrides = {}) {
  const contract = { mode: 'generated', timing_source: { episode_key: 'ep-001', version_id: 'v001', line_index: 1, source_asset: sourceAsset }, target_range: { start_ms: 0, end_ms: 500 }, target_speech_ms: 400, original_text: '别回头。', adapted_text: '别回头。', adaptation: null, performance, fit_policy: { max_paid_generations: 3, provider_speed_min: 0.85, provider_speed_max: 1.15, max_post_tempo_percent: 3, text_adaptation_allowed: true } }
  return { episode_key: 'ep-001', source_versions: {}, audio_strategy: strategy, lines: [{ line_index: 1, speaker: '林晚', line_type: 'dialogue', content: '别回头。', emotion: '紧张', emotion_strength: 0.3, pronunciation_notes: [], matched_shot: { shot_number: 1 }, delivery_mode: 'post_dub', presentation: 'visible-dialogue', fallback_mode: 'post-dub', source_audio: null, voice_binding: { voice_id: 'linwan' }, native_audio_exception: null, performance: null, dubbing_contract: contract }], voice_bindings: [{ voice_id: 'linwan' }], unresolved: [], approved: true, ...overrides }
}

function audioPlanWithTiming(timingSource) {
  const plan = audioPlan()
  plan.lines[0].dubbing_contract = { ...plan.lines[0].dubbing_contract, timing_source: timingSource }
  return plan
}

function audioPlanWithRange(targetRange) {
  const plan = audioPlan()
  plan.lines[0].dubbing_contract = { ...plan.lines[0].dubbing_contract, target_range: targetRange }
  return plan
}

async function fixture(timing = {}, selected = true) {
  const root = await mkdtemp(resolve(tmpdir(), 'project-store-audio-plan-'))
  const sourcePath = resolve(root, 'assets/videos/shot-ep001-001/v001.mp4')
  await mkdir(dirname(sourcePath), { recursive: true })
  await writeFile(sourcePath, sourceBytes)
  await putAsset(root, { key: sourceAsset.asset_key, type: 'video', name: '源镜头' })
  await addAssetVersion(root, sourceAsset.asset_key, { id: 'v001', localPath: 'assets/videos/shot-ep001-001/v001.mp4', provenance })
  await selectAssetVersion(root, sourceAsset.asset_key, 'v001')
  const document = { episode_key: 'ep-001', source_asset: sourceAsset, method: 'asr-forced-alignment', reviewed: true, language: 'zh-CN', lines: [{ line_index: 1, start_ms: 0, end_ms: 500, confidence: 0.95, confidence_source: 'asr', words: [{ text: '别', start_ms: 0, end_ms: 160, confidence: 0.95, confidence_source: 'asr' }] }], ...timing }
  await writeJson(resolve(root, 'episodes/ep-001/speech-timing/v001.json'), document)
  if (selected) {
    await writeJson(resolve(root, 'episodes/ep-001/speech-timing/selected.json'), { versionId: 'v001', path: 'episodes/ep-001/speech-timing/v001.json', source_asset_sha256: sourceAsset.sha256, reviewed_by: 'codex' })
    await writeJson(resolve(root, 'episodes/ep-001/speech-timing/selected-sources/shot-ep001-001/v001/selected.json'), { versionId: 'v001', source_asset_sha256: sourceAsset.sha256, reviewed_by: 'codex' })
  }
  return root
}

async function validate(root, document) {
  const input = resolve(root, 'audio-plan.json')
  await writeJson(input, document)
  return spawnSync(process.execPath, [projectStore, 'validate-episode-document', root, 'audio-plan', 'ep-001', input], { encoding: 'utf8' })
}

test('project-store 接受与当前 speech-timing 行完全一致的目标区间', async () => {
  const root = await fixture()
  try {
    const result = await validate(root, audioPlan())
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stdout.trim(), 'ok')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('project-store 拒绝非当前、未复核、低置信和哈希不匹配的时间证据', async () => {
  const cases = [
    { name: 'v999', plan: audioPlanWithTiming({ episode_key: 'ep-001', version_id: 'v999', line_index: 1, source_asset: sourceAsset }) },
    { name: 'sha', plan: audioPlanWithTiming({ episode_key: 'ep-001', version_id: 'v001', line_index: 1, source_asset: { ...sourceAsset, sha256: 'b'.repeat(64) } }) },
    { name: 'unselected', selected: false, plan: audioPlan() },
    { name: 'unreviewed', timing: { reviewed: false }, plan: audioPlan() },
    { name: 'low-confidence', timing: { lines: [{ line_index: 1, start_ms: 0, end_ms: 500, confidence: 0.89, confidence_source: 'asr', words: [{ text: '别', start_ms: 0, end_ms: 160, confidence: 0.95, confidence_source: 'asr' }] }] }, plan: audioPlan() },
    { name: 'low-word-confidence', timing: { lines: [{ line_index: 1, start_ms: 0, end_ms: 500, confidence: 0.95, confidence_source: 'asr', words: [{ text: '别', start_ms: 0, end_ms: 160, confidence: 0.79, confidence_source: 'asr' }] }] }, plan: audioPlan() },
    { name: 'range-mismatch', plan: audioPlanWithRange({ start_ms: 1, end_ms: 500 }) },
  ]
  for (const item of cases) {
    const root = await fixture(item.timing, item.selected)
    try {
      const result = await validate(root, item.plan)
      assert.notEqual(result.status, 0, `${item.name} 不应通过`)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }
})
