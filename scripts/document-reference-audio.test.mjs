import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { addAssetVersion, putAsset, selectAssetVersion } from './asset-ledger.mjs'
import { validateGenerationDocumentReference } from './document-reference.mjs'

const provenance = { origin: 'imported', created_by: 'user', provider: null, model_or_workflow: null, task_id: null, prompt_document: null, source_assets: [], parameters: {} }

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`)
}

async function registerSource(root, key, bytes) {
  const path = resolve(root, `assets/audio/${key}/v001.wav`)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, bytes)
  await putAsset(root, { key, type: 'audio', name: key })
  await addAssetVersion(root, key, { id: 'v001', localPath: `assets/audio/${key}/v001.wav`, provenance })
  await selectAssetVersion(root, key, 'v001')
  return { asset_key: key, version_id: 'v001', sha256: createHash('sha256').update(bytes).digest('hex') }
}

function timing(sourceAsset) {
  return {
    episode_key: 'ep-001', source_asset: sourceAsset, method: 'manual-direction', reviewed: true, language: 'zh-CN',
    lines: [{ line_index: 1, speaker: '林晚', text: '别回头', start_ms: 0, end_ms: 900, pauses: [{ start_ms: 350, end_ms: 420 }], review_evidence: { speaker_checked: true, text_checked: true, visible_mouth_checked: true, notes: '人工核对源音轨与口型' }, words: [{ text: '别', start_ms: 0, end_ms: 350 }, { text: '回头', start_ms: 420, end_ms: 800 }], evidence: '人工核对源音轨起止与停顿' }],
  }
}

test('音频文档引用按合同来源读取逐来源 timing，不受另一来源覆盖剧集全局槽影响', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'document-reference-audio-'))
  try {
    const firstSource = await registerSource(root, 'audio-ep001-source-a', 'source-a')
    const secondSource = await registerSource(root, 'audio-ep001-source-b', 'source-b')
    const timingRoot = resolve(root, 'episodes/ep-001/speech-timing')
    await writeJson(resolve(timingRoot, 'v001.json'), timing(firstSource))
    await writeJson(resolve(timingRoot, 'v002.json'), timing(secondSource))
    await writeJson(resolve(timingRoot, 'selected-sources/audio-ep001-source-a/v001/selected.json'), { versionId: 'v001', source_asset_sha256: firstSource.sha256, reviewed_by: 'codex' })
    await writeJson(resolve(timingRoot, 'selected-sources/audio-ep001-source-b/v001/selected.json'), { versionId: 'v002', source_asset_sha256: secondSource.sha256, reviewed_by: 'codex' })
    await writeJson(resolve(timingRoot, 'selected.json'), { versionId: 'v002', path: 'episodes/ep-001/speech-timing/v002.json', source_asset_sha256: secondSource.sha256, reviewed_by: 'codex' })

    const performance = {
      intent: '阻止对方看见危险', subtext: '不能让对方察觉', emotion_arc: [{ at: 0, emotion: '警觉', intensity: 0.6 }],
      pace: '短促', emphasis: ['别'], pause_plan: [{ after: '别', duration_ms: 70 }], breath: '轻吸气', distance_and_space: '近距离',
    }
    const line = {
      line_index: 1, speaker: '林晚', line_type: 'dialogue', content: '别回头。', emotion: '警觉', emotion_strength: 0.6,
      pronunciation_notes: [], matched_shot: { shot_number: 1 }, delivery_mode: 'post_dub', presentation: 'visible-dialogue', fallback_mode: 'post-dub',
      source_audio: null, voice_binding: { voice_id: 'linwan' }, native_audio_exception: null, performance: null,
      dubbing_contract: {
        mode: 'generated', timing_source: { episode_key: 'ep-001', version_id: 'v001', line_index: 1, source_asset: firstSource },
        target_range: { start_ms: 0, end_ms: 900 }, target_speech_ms: 800, original_text: '别回头。', adapted_text: '别回头。', adaptation: null,
        performance, fit_policy: { max_paid_generations: 3, provider_speed_min: 0.85, provider_speed_max: 1.15, max_post_tempo_percent: 3, text_adaptation_allowed: true },
      },
    }
    const plan = {
      episode_key: 'ep-001', audio_strategy: { mode: 'native-first', provider_selection: 'prefer-native', fallback_allowed: true, fallback_reasons: ['provider-no-native-audio', 'voice-identity-drift', 'speech-intelligibility-failed', 'narration-performance-failed', 'audio-sync-failed', 'native-ambience-failed'] },
      lines: [line], voice_bindings: [{ speaker: '林晚', provider: 'bailian', model: 'cosyvoice-v3.5-plus', voice_id: 'linwan' }], unresolved: [], approved: true,
    }
    const planRoot = resolve(root, 'episodes/ep-001/audio-plan')
    await writeJson(resolve(planRoot, 'v003.json'), plan)
    await writeJson(resolve(planRoot, 'selected.json'), { versionId: 'v003', path: 'episodes/ep-001/audio-plan/v003.json' })

    const result = await validateGenerationDocumentReference(
      root, 'audio', 'audio-ep001-line-001', { kind: 'audio-plan', episode_key: 'ep-001', version_id: 'v003', line_index: 1 },
      { input: '别回头。', voice: 'linwan' }, 'bailian', 'cosyvoice-v3.5-plus'
    )
    assert.equal(result.line.dubbing_contract.timing_source.source_asset.asset_key, firstSource.asset_key)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
