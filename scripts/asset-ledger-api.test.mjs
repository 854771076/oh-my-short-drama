import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { addAssetVersion, invalidateDerivedAssets, putAsset, selectAssetVersion, selectedAssetVersion } from './asset-ledger.mjs'

async function makeFile(root, localPath, contents) {
  const target = resolve(root, localPath)
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, contents)
  return localPath
}

const provenance = (origin, sources = []) => ({
  origin,
  created_by: 'codex',
  provider: null,
  model_or_workflow: origin === 'transformed' ? 'ffmpeg-extract-frame' : null,
  task_id: null,
  prompt_document: null,
  source_assets: sources,
  parameters: {},
})

test('编程接口登记、选版并校验本地文件身份', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'short-drama-assets-api-'))
  try {
    await putAsset(root, { key: 'shot-ep001-001', type: 'video', name: '镜头 1' })
    const localPath = await makeFile(root, 'assets/videos/shot-ep001-001/v001.mp4', 'source-video')
    const asset = await addAssetVersion(root, 'shot-ep001-001', { id: 'v001', localPath, provenance: provenance('imported') })
    assert.equal(asset.versions.length, 1)
    await selectAssetVersion(root, 'shot-ep001-001', 'v001')
    const selected = await selectedAssetVersion(root, 'shot-ep001-001')
    assert.equal(selected.version.id, 'v001')
    assert.equal(selected.path, resolve(root, localPath))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('来源版本失效会传递到尾帧和下游视频并清除选版', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'short-drama-assets-stale-'))
  try {
    await putAsset(root, { key: 'shot-ep001-001', type: 'video', name: '镜头 1' })
    await addAssetVersion(root, 'shot-ep001-001', { id: 'v001', localPath: await makeFile(root, 'assets/videos/shot-ep001-001/v001.mp4', 'source-video'), provenance: provenance('imported') })
    await selectAssetVersion(root, 'shot-ep001-001', 'v001')

    await putAsset(root, { key: 'other-transition-ep001-002', type: 'other', name: '镜头 2 首帧' })
    await addAssetVersion(root, 'other-transition-ep001-002', { id: 'v001', localPath: await makeFile(root, 'assets/other/other-transition-ep001-002/v001.png', 'tail-frame'), provenance: provenance('transformed', [{ key: 'shot-ep001-001', version_id: 'v001' }]) })
    await selectAssetVersion(root, 'other-transition-ep001-002', 'v001')

    await putAsset(root, { key: 'shot-ep001-002', type: 'video', name: '镜头 2' })
    await addAssetVersion(root, 'shot-ep001-002', { id: 'v001', localPath: await makeFile(root, 'assets/videos/shot-ep001-002/v001.mp4', 'derived-video'), provenance: provenance('transformed', [{ key: 'other-transition-ep001-002', version_id: 'v001' }]) })
    await selectAssetVersion(root, 'shot-ep001-002', 'v001')

    assert.deepEqual(await invalidateDerivedAssets(root, { key: 'shot-ep001-001', version_id: 'v001' }), ['other-transition-ep001-002@v001', 'shot-ep001-002@v001'])
    await assert.rejects(selectedAssetVersion(root, 'other-transition-ep001-002'), /没有 selected|失效/)
    await assert.rejects(selectedAssetVersion(root, 'shot-ep001-002'), /没有 selected|失效/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('选中版本文件被篡改时拒绝返回', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'short-drama-assets-hash-'))
  try {
    const localPath = await makeFile(root, 'assets/videos/shot-ep001-001/v001.mp4', 'before')
    await putAsset(root, { key: 'shot-ep001-001', type: 'video', name: '镜头 1' })
    await addAssetVersion(root, 'shot-ep001-001', { id: 'v001', localPath, provenance: provenance('imported') })
    await selectAssetVersion(root, 'shot-ep001-001', 'v001')
    await writeFile(resolve(root, localPath), 'after')
    await assert.rejects(selectedAssetVersion(root, 'shot-ep001-001'), /哈希或大小不一致/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
