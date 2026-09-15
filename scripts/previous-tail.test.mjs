import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { addAssetVersion, putAsset, selectAssetVersion, selectedAssetVersion } from './asset-ledger.mjs'
import { preparePreviousTail } from './previous-tail.mjs'

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`)
}

function generateVideo(path) {
  const result = spawnSync('ffmpeg', ['-nostdin', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=320x180:r=24:d=2', '-c:v', 'mpeg4', '-pix_fmt', 'yuv420p', '-y', path], { encoding: 'utf8' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(result.stderr || '测试视频生成失败')
}

const state = () => ({ actors: [], props: [], axis_id: 'axis-a', camera_side: 'north', lighting_anchor: 'window-left' })

function continuityPlan() {
  return {
    episode_key: 'ep-001',
    source_versions: { storyboard: 'v001', 'director-book': 'v001', 'production-plan': 'v001' },
    scenes: [{ scene_key: 'scene-001', coordinate_mode: 'semantic', axis_id: 'axis-a', axis_description: '门到窗形成主轴线', camera_side: 'north', anchors: ['door', 'window'], lighting_anchor: 'window-left' }],
    shots: [
      { shot_number: 1, scene_key: 'scene-001', camera_setup_id: 'cam-a', start_state: state(), end_state: state(), transition_link: { mode: 'independent', source_shot_number: null, source_camera_setup_id: null, enabled: false, reason: '首镜建立空间', required_provider_capability: null }, inherited_fields: ['axis_id'], allowed_changes: [], evidence: ['director-book:scene-001'] },
      { shot_number: 2, scene_key: 'scene-001', camera_setup_id: 'cam-a', start_state: state(), end_state: state(), transition_link: { mode: 'previous-tail', source_shot_number: 1, source_camera_setup_id: 'cam-a', enabled: true, reason: '承接动作', required_provider_capability: 'video.first-frame' }, inherited_fields: ['axis_id'], allowed_changes: [], evidence: ['director-book:scene-001'] },
    ],
    unresolved: [],
    approved: true,
  }
}

test('从已审核上一镜派生并登记最后一帧', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'short-drama-previous-tail-'))
  try {
    const sourcePath = resolve(root, 'assets/videos/shot-ep001-001/v001.mp4')
    await mkdir(dirname(sourcePath), { recursive: true })
    generateVideo(sourcePath)
    await putAsset(root, { key: 'shot-ep001-001', type: 'video', name: '镜头 1' })
    await addAssetVersion(root, 'shot-ep001-001', { id: 'v001', localPath: 'assets/videos/shot-ep001-001/v001.mp4', provenance: { origin: 'imported', created_by: 'user', provider: null, model_or_workflow: null, task_id: null, prompt_document: null, source_assets: [], parameters: {} } })
    await selectAssetVersion(root, 'shot-ep001-001', 'v001')

    const planPath = resolve(root, 'episodes/ep-001/continuity-plan/v001.json')
    await writeJson(planPath, continuityPlan())
    await writeJson(resolve(root, 'episodes/ep-001/continuity-plan/selected.json'), { versionId: 'v001', path: 'episodes/ep-001/continuity-plan/v001.json' })

    await assert.rejects(preparePreviousTail({ projectRoot: root, episodeKey: 'ep-001', shotNumber: 2, continuityVersion: 'v001' }), /审核通过/)
    await writeJson(resolve(root, '.short-drama/shot-reviews.json'), { version: 1, reviews: { 'shot-ep001-001@v001': { approved: true } } })

    const result = await preparePreviousTail({ projectRoot: root, episodeKey: 'ep-001', shotNumber: 2, continuityVersion: 'v001' })
    assert.equal(result.asset_key, 'other-transition-ep001-002')
    assert.match(result.version_id, /^v\d{3}$/)
    assert.match(result.local_path, /^assets\/other\/other-transition-ep001-002\//)
    const selected = await selectedAssetVersion(root, result.asset_key)
    assert.equal(selected.version.provenance.source_assets[0].key, 'shot-ep001-001')
    assert.equal(selected.version.provenance.parameters.source_sha256, result.source_sha256)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
