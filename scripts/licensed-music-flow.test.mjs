import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { validateAudioPlan } from './audio-plan-contract.mjs'
import { addAssetVersion, putAsset, selectAssetVersion } from './asset-ledger.mjs'
import { validateTimeline } from './editing-store.mjs'
import { putMusicLicense } from './music-license-ledger.mjs'

const reasons = ['provider-no-native-audio', 'voice-identity-drift', 'speech-intelligibility-failed', 'narration-performance-failed', 'audio-sync-failed', 'native-ambience-failed']
const use = { commercial: true, paid_ad: true, client_project: false, broadcast: false, platform: 'douyin' }
const catalogTrack = { key: 'bgm-tension', purpose: 'bgm', title: 'Tension', source_mode: 'catalog', source_asset: { asset_key: 'audio-ep001-bgm-001', version_id: 'v001' }, license_receipt: 'music-license-pixabay-flow-1', intended_use: use, matched_shots: [1] }
const planWith = (track) => ({ episode_key: 'ep-001', audio_strategy: { mode: 'native-first', provider_selection: 'prefer-native', fallback_allowed: true, fallback_reasons: reasons }, lines: [], music_tracks: [track], unresolved: [], approved: true })

test('catalog 曲目必须绑定资产和许可证', () => {
  assert.throws(() => validateAudioPlan(planWith({ ...catalogTrack, source_asset: null, license_receipt: null }), 'ep-001'), /许可证|资产/)
})

function media(path, type) {
  const input = type === 'video'
    ? ['-f', 'lavfi', '-i', 'color=c=black:s=320x180:r=24:d=1', '-c:v', 'mpeg4', '-pix_fmt', 'yuv420p']
    : ['-f', 'lavfi', '-i', 'sine=frequency=220:duration=1', '-c:a', 'pcm_s16le']
  const result = spawnSync('ffmpeg', ['-nostdin', '-loglevel', 'error', ...input, '-y', path], { encoding: 'utf8' })
  if (result.error || result.status !== 0) throw new Error(result.stderr || '媒体夹具生成失败')
}

test('许可证不覆盖项目用途时拒绝时间线', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'short-drama-licensed-timeline-'))
  try {
    await mkdir(resolve(root, '.short-drama'), { recursive: true })
    await writeFile(resolve(root, '.short-drama/project.json'), '{}\n')
    await writeFile(resolve(root, '.short-drama/shot-reviews.json'), `${JSON.stringify({ version: 1, reviews: { 'shot-ep001-001@v001': { approved: true } } })}\n`)
    await mkdir(resolve(root, 'episodes/ep-001/audio-plan'), { recursive: true })
    await writeFile(resolve(root, 'episodes/ep-001/episode.json'), '{}\n')
    await writeFile(resolve(root, 'episodes/ep-001/audio-plan/v001.json'), `${JSON.stringify(planWith(catalogTrack), null, 2)}\n`)
    await writeFile(resolve(root, 'episodes/ep-001/audio-plan/selected.json'), `${JSON.stringify({ versionId: 'v001', path: 'episodes/ep-001/audio-plan/v001.json' })}\n`)
    const video = resolve(root, 'assets/videos/shot-ep001-001/v001.mp4'), audio = resolve(root, 'assets/audio/audio-ep001-bgm-001/v001.wav')
    await mkdir(dirname(video), { recursive: true }); await mkdir(dirname(audio), { recursive: true })
    media(video, 'video'); media(audio, 'audio')
    await putAsset(root, { key: 'shot-ep001-001', type: 'video', name: '镜头 1' })
    await addAssetVersion(root, 'shot-ep001-001', { id: 'v001', localPath: 'assets/videos/shot-ep001-001/v001.mp4', provenance: { origin: 'generated', created_by: 'provider', provider: 'test', model_or_workflow: 'video', task_id: 'video-1', prompt_document: { episode_key: 'ep-001', version_id: 'v001', shot_number: 1 }, source_assets: [], parameters: {} } })
    await selectAssetVersion(root, 'shot-ep001-001', 'v001')
    await putAsset(root, { key: 'audio-ep001-bgm-001', type: 'audio', name: '配乐' })
    await addAssetVersion(root, 'audio-ep001-bgm-001', { id: 'v001', localPath: 'assets/audio/audio-ep001-bgm-001/v001.wav', provenance: { origin: 'imported', created_by: 'user', provider: null, model_or_workflow: null, task_id: null, prompt_document: null, source_assets: [], parameters: { music_license_receipt: catalogTrack.license_receipt, usage_scope: 'commercial-authorized', rights_confirmed: true } } })
    await selectAssetVersion(root, 'audio-ep001-bgm-001', 'v001')
    await putMusicLicense(root, { receipt_key: catalogTrack.license_receipt, catalog: 'pixabay', track_id: 'flow-1', title: 'Tension', creator: 'Example', source_url: 'https://pixabay.com/music/example/', license_name: 'Pixabay Content License', license_url: 'https://pixabay.com/service/license-summary/', downloaded_at: '2026-09-16T08:00:00.000Z', attribution_required: false, attribution_text: '', content_id_risk: true, allowed_uses: ['online-video'], proof_path: null })
    const timeline = { episode_key: 'ep-001', fps: 24, width: 320, height: 180, segments: [{ shot_key: 'shot-ep001-001', asset_key: 'shot-ep001-001', version_id: 'v001', source_in_ms: 0, source_out_ms: 1000, timeline_start_ms: 0, timeline_end_ms: 1000, transition: { type: 'hard-cut', duration_frames: 0 } }], subtitles: [], audio_tracks: [{ asset_key: 'audio-ep001-bgm-001', version_id: 'v001', role: 'bgm', source_in_ms: 0, source_out_ms: 1000, timeline_start_ms: 0, timeline_end_ms: 1000, volume_envelope: [], audio_plan: { episode_key: 'ep-001', version_id: 'v001', track_key: 'bgm-tension' } }], labels: [], graphics: [], mix: { target_lufs: -16, true_peak_dbtp: -1 } }
    await assert.rejects(validateTimeline(root, timeline), /许可证用途/)
  } finally { await rm(root, { recursive: true, force: true }) }
})
