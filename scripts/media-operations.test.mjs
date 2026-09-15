import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { addAssetVersion, putAsset, selectAssetVersion } from './asset-ledger.mjs'
import { executeLocalMediaOperation } from './media-operations.mjs'

function ffmpeg(args) {
  const result = spawnSync('ffmpeg', ['-nostdin', '-loglevel', 'error', ...args], { encoding: 'utf8' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(result.stderr || 'FFmpeg 测试素材生成失败')
}

const imported = { origin: 'imported', created_by: 'user', provider: null, model_or_workflow: null, task_id: null, prompt_document: null, source_assets: [], parameters: {} }

test('本地裁剪、替换音轨与局部范围门禁', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'short-drama-media-operations-'))
  try {
    const sourcePath = resolve(root, 'assets/videos/shot-ep001-001/v001.mp4')
    await mkdir(dirname(sourcePath), { recursive: true })
    ffmpeg(['-f', 'lavfi', '-i', 'color=c=blue:s=640x360:r=24:d=2', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=2', '-shortest', '-c:v', 'mpeg4', '-c:a', 'aac', '-pix_fmt', 'yuv420p', '-y', sourcePath])
    await putAsset(root, { key: 'shot-ep001-001', type: 'video', name: '镜头 1' })
    await addAssetVersion(root, 'shot-ep001-001', { id: 'v001', localPath: 'assets/videos/shot-ep001-001/v001.mp4', provenance: imported })
    await selectAssetVersion(root, 'shot-ep001-001', 'v001')

    const audioPath = resolve(root, 'assets/audio/audio-ep001-replacement/v001.wav')
    await mkdir(dirname(audioPath), { recursive: true })
    ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=880:sample_rate=48000:duration=2', '-c:a', 'pcm_s16le', '-y', audioPath])
    await putAsset(root, { key: 'audio-ep001-replacement', type: 'audio', name: '替换音轨' })
    await addAssetVersion(root, 'audio-ep001-replacement', { id: 'v001', localPath: 'assets/audio/audio-ep001-replacement/v001.wav', provenance: imported })
    await selectAssetVersion(root, 'audio-ep001-replacement', 'v001')

    const maskPath = resolve(root, 'assets/other/other-mask-ep001-001/v001.png')
    await mkdir(dirname(maskPath), { recursive: true })
    ffmpeg(['-f', 'lavfi', '-i', 'color=c=white:s=640x360:d=0.1', '-frames:v', '1', '-y', maskPath])
    await putAsset(root, { key: 'other-mask-ep001-001', type: 'other', name: '局部遮罩' })
    await addAssetVersion(root, 'other-mask-ep001-001', { id: 'v001', localPath: 'assets/other/other-mask-ep001-001/v001.png', provenance: imported })
    await selectAssetVersion(root, 'other-mask-ep001-001', 'v001')

    const trimmed = await executeLocalMediaOperation(root, { operation: 'trim', source: { asset_key: 'shot-ep001-001', version_id: 'v001' }, range: { start_ms: 250, end_ms: 1250 }, parameters: {} })
    assert.ok(Math.abs(trimmed.probe.duration_ms - 1000) <= 80)
    assert.notEqual(resolve(trimmed.output_path), sourcePath)

    const replaced = await executeLocalMediaOperation(root, { operation: 'replace-audio', source: { asset_key: 'shot-ep001-001', version_id: 'v001' }, audio: { asset_key: 'audio-ep001-replacement', version_id: 'v001' }, range: { start_ms: 500, end_ms: 1500 }, parameters: {} })
    assert.equal(replaced.probe.has_video, true)
    assert.equal(replaced.probe.has_audio, true)
    assert.ok(Math.abs(replaced.probe.duration_ms - 2000) <= 80)

    const blurred = await executeLocalMediaOperation(root, { operation: 'mask-blur', source: { asset_key: 'shot-ep001-001', version_id: 'v001' }, mask: { asset_key: 'other-mask-ep001-001', version_id: 'v001' }, range: { start_ms: 500, end_ms: 1500 }, parameters: { radius: 8 } })
    assert.equal(blurred.probe.has_video, true)
    assert.ok(Math.abs(blurred.probe.duration_ms - 2000) <= 80)

    await assert.rejects(executeLocalMediaOperation(root, { operation: 'mask-blur', source: { asset_key: 'shot-ep001-001', version_id: 'v001' }, mask: { asset_key: 'other-mask-ep001-001', version_id: 'v001' }, range: { start_ms: 0, end_ms: 2500 }, parameters: {} }), /超过来源时长/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
