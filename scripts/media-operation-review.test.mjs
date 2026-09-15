import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { addAssetVersion, putAsset, selectAssetVersion, selectedAssetVersion } from './asset-ledger.mjs'
import { validateMediaOperationReview } from './media-operation-review.mjs'
import { putMediaOperationReview } from './review-ledger.mjs'

const observed = (keys) => Object.fromEntries(keys.map((key) => [key, `${key} 已逐项检查`]))
const qc = (contents) => ({
  version: 1,
  passed: true,
  blockers: [],
  video_sha256: createHash('sha256').update(contents).digest('hex'),
  duration_ms: 2000,
  video: { width: 1920, height: 1080, fps: 24 },
  audio: true,
})

test('局部修复必须记录范围内和范围外观察', () => {
  assert.throws(() => validateMediaOperationReview('video-inpaint', {
    approved: true,
    watched_full: true,
    observations: { inside_range: '瑕疵消失', identity: '身份稳定', temporal_consistency: '时序连续' },
    qc: qc('output'),
  }), /outside_range/)
})

test('超分必须记录分辨率、时长、细节和伪影', () => {
  assert.throws(() => validateMediaOperationReview('video-upscale', {
    approved: true,
    watched_full: true,
    observations: {},
    qc: qc('output'),
  }), /resolution/)
})

test('批准媒体操作后才选择候选版本', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'short-drama-operation-review-'))
  const key = 'shot-ep001-001'
  const sourceContents = 'source'
  const outputContents = 'output'
  try {
    await mkdir(resolve(root, '.short-drama'), { recursive: true })
    await writeFile(resolve(root, '.short-drama/state.json'), `${JSON.stringify({ stage: 'editing', completed: [] })}\n`)
    await putAsset(root, { key, type: 'video', name: '镜头 1' })
    const makeVersion = async (id, contents, provenance) => {
      const localPath = `assets/videos/${key}/${id}.mp4`
      await mkdir(dirname(resolve(root, localPath)), { recursive: true })
      await writeFile(resolve(root, localPath), contents)
      await addAssetVersion(root, key, { id, localPath, provenance })
    }
    await makeVersion('v001', sourceContents, { origin: 'imported', created_by: 'user', provider: null, model_or_workflow: null, task_id: null, prompt_document: null, source_assets: [], parameters: {} })
    await selectAssetVersion(root, key, 'v001')
    await makeVersion('v002', outputContents, {
      origin: 'transformed', created_by: 'provider', provider: 'runninghub', model_or_workflow: 'workflow-upscale', task_id: 'task-upscale', prompt_document: null,
      source_assets: [{ key, version_id: 'v001' }],
      parameters: { operation: 'video-upscale', parameters: { target_resolution: '2K' }, source_sha256: createHash('sha256').update(sourceContents).digest('hex') },
    })
    const genericPath = resolve(root, 'generic-review.json')
    await writeFile(genericPath, `${JSON.stringify({ assetKey: key, versionId: 'v002', visual: 'passed', audio: 'passed', transition: 'passed', captions: 'not-applicable', issues: [], criteria: [{ criterion: '画面清晰', status: 'passed', observation: '已观看' }] })}\n`)
    const bypass = spawnSync(process.execPath, [resolve(import.meta.dirname, 'review-ledger.mjs'), 'put', root, genericPath], { encoding: 'utf8' })
    assert.notEqual(bypass.status, 0)
    assert.match(bypass.stderr, /专项审核/)
    const review = {
      asset_key: key,
      version_id: 'v002',
      operation: 'video-upscale',
      approved: true,
      watched_full: true,
      observations: observed(['resolution', 'duration_fps', 'audio_preservation', 'faces_hands_text', 'motion_artifacts', 'color_crop']),
      issues: [],
      qc: qc(outputContents),
    }
    const saved = await putMediaOperationReview(root, review)
    assert.equal(saved.selected, true)
    assert.equal((await selectedAssetVersion(root, key)).version.id, 'v002')
    const ledger = JSON.parse(await readFile(resolve(root, '.short-drama/shot-reviews.json'), 'utf8'))
    assert.equal(ledger.reviews[`${key}@v002`].review_type, 'media-operation')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
