import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { addAssetVersion, putAsset, selectAssetVersion } from './asset-ledger.mjs'
import { validatePreviousTailBinding } from './reference-bindings.mjs'
import { validateVideoPrompts } from './project-store.mjs'

async function makeFile(root, localPath, contents) {
  const target = resolve(root, localPath)
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, contents)
  return localPath
}

const provenance = (origin, sources = [], parameters = {}) => ({
  origin,
  created_by: origin === 'imported' ? 'user' : 'codex',
  provider: null,
  model_or_workflow: origin === 'transformed' ? 'ffmpeg-extract-frame' : null,
  task_id: null,
  prompt_document: origin === 'transformed' ? { kind: 'continuity-plan', episode_key: 'ep-001', version_id: 'v001', shot_number: 2 } : null,
  source_assets: sources,
  parameters,
})

async function fixture() {
  const root = await mkdtemp(resolve(tmpdir(), 'short-drama-tail-binding-'))
  await putAsset(root, { key: 'shot-ep001-001', type: 'video', name: '镜头 1' })
  const source = await addAssetVersion(root, 'shot-ep001-001', { id: 'v001', localPath: await makeFile(root, 'assets/videos/shot-ep001-001/v001.mp4', 'source-v1'), provenance: provenance('imported') })
  await selectAssetVersion(root, 'shot-ep001-001', 'v001')
  await putAsset(root, { key: 'other-transition-ep001-002', type: 'other', name: '镜头 2 首帧' })
  await addAssetVersion(root, 'other-transition-ep001-002', { id: 'v001', localPath: await makeFile(root, 'assets/other/other-transition-ep001-002/v001.png', 'tail-v1'), provenance: provenance('transformed', [{ key: 'shot-ep001-001', version_id: 'v001' }], { position: 'last', source_sha256: source.versions[0].sha256 }) })
  await selectAssetVersion(root, 'other-transition-ep001-002', 'v001')
  await writeFile(resolve(root, '.short-drama/state.json'), `${JSON.stringify({ stage: 'media-production', completed: [] })}\n`)
  return root
}

const shot = (inputMode = 'I2VA') => ({ shot_number: 2, input_mode: inputMode, continuity: { mode: 'previous-tail', source_shot_number: 1, required_provider_capability: 'video.first-frame' } })
const validManifest = [{ type: 'image', order: 1, asset_key: 'other-transition-ep001-002', version_id: 'v001', role: 'first_frame' }]

test('previous-tail 必须占用第一个 image/first_frame 引用', async () => {
  const root = await fixture()
  try {
    await assert.rejects(validatePreviousTailBinding(root, shot(), [{ type: 'image', order: 1, asset_key: 'board-ep001-002', version_id: 'v001', role: 'reference_image' }]), /first_frame/)
    await assert.doesNotReject(validatePreviousTailBinding(root, shot(), validManifest))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('previous-tail 拒绝无首帧能力的输入模式和过期来源版本', async () => {
  const root = await fixture()
  try {
    await assert.rejects(validatePreviousTailBinding(root, shot('Ref2VA'), validManifest), /video\.first-frame/)
    await addAssetVersion(root, 'shot-ep001-001', { id: 'v002', localPath: await makeFile(root, 'assets/videos/shot-ep001-001/v002.mp4', 'source-v2'), provenance: provenance('imported') })
    await selectAssetVersion(root, 'shot-ep001-001', 'v002')
    await assert.rejects(validatePreviousTailBinding(root, shot(), validManifest), /当前 selected|来源版本/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('视频提示词文档在保存前拒绝错误的 previous-tail 模式', () => {
  const prompt = '成片必须是单一连续的电影画面并铺满整个屏幕，严禁宫格、分屏、分框、拼贴、分割线、分镜编号或任何多画面构图。'
  const document = {
    episode_key: 'ep-001', source_versions: {}, unresolved: [], approved: true,
    shots: [{ shot_number: 2, production_plan_version: 'v001', storyboard_version: 'v001', provider: 'starrouter', model_or_workflow: 'dreamina-seedance-2-0-260128', prompt_profile: 'seedance2', input_mode: 'full-reference', prompt, duration: 5, references: validManifest, continuity: shot().continuity, audio_policy: { mode: 'post-dub' }, errors: [] }],
  }
  assert.throws(() => validateVideoPrompts(document, 'ep-001'), /video\.first-frame/)
})
