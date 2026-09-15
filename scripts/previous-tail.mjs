import { readFile, rm } from 'node:fs/promises'
import { relative, resolve } from 'node:path'
import { addAssetVersion, putAsset, selectAssetVersion, selectedAssetVersion } from './asset-ledger.mjs'
import { validateContinuityPlan } from './continuity-plan.mjs'
import { extractFrame } from './media-tools.mjs'

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'))
}

async function readSelectedContinuityPlan(root, episodeKey, versionId) {
  const directory = resolve(root, 'episodes', episodeKey, 'continuity-plan')
  const expectedPath = resolve(directory, `${versionId}.json`)
  const marker = await readJson(resolve(directory, 'selected.json'))
  if (marker.versionId !== versionId || resolve(root, marker.path) !== expectedPath) throw new Error('必须使用当前 selected 的连续性计划版本')
  const plan = validateContinuityPlan(await readJson(expectedPath), episodeKey)
  if (plan.approved !== true || plan.unresolved.length) throw new Error('连续性计划必须已批准且没有未决项')
  return plan
}

async function requireApprovedReview(root, assetKey, versionId) {
  let ledger
  try { ledger = await readJson(resolve(root, '.short-drama', 'shot-reviews.json')) }
  catch (error) {
    if (error?.code === 'ENOENT') throw new Error(`上一镜尚未审核通过：${assetKey}@${versionId}`)
    throw error
  }
  if (ledger.reviews?.[`${assetKey}@${versionId}`]?.approved !== true) throw new Error(`上一镜尚未审核通过：${assetKey}@${versionId}`)
}

async function nextAssetVersion(root, key) {
  let ledger
  try { ledger = await readJson(resolve(root, '.short-drama', 'assets.json')) }
  catch (error) {
    if (error?.code === 'ENOENT') return 'v001'
    throw error
  }
  const numbers = (ledger.assets?.[key]?.versions || []).map((version) => Number(version.id.slice(1))).filter(Number.isInteger)
  return `v${String(Math.max(0, ...numbers) + 1).padStart(3, '0')}`
}

export async function preparePreviousTail({ projectRoot, episodeKey, shotNumber, continuityVersion }) {
  const root = resolve(projectRoot)
  if (!/^ep-\d{3}$/.test(episodeKey) || !Number.isInteger(shotNumber) || shotNumber < 2 || !/^v\d{3}$/.test(continuityVersion)) throw new Error('尾帧派生参数无效')
  const plan = await readSelectedContinuityPlan(root, episodeKey, continuityVersion)
  const link = plan.shots.find((shot) => shot.shot_number === shotNumber)?.transition_link
  if (link?.mode !== 'previous-tail' || link.enabled !== true) throw new Error('目标镜头没有启用 previous-tail')

  const sourceKey = `shot-${episodeKey.replace('-', '')}-${String(link.source_shot_number).padStart(3, '0')}`
  const source = await selectedAssetVersion(root, sourceKey)
  await requireApprovedReview(root, sourceKey, source.version.id)
  const key = `other-transition-${episodeKey.replace('-', '')}-${String(shotNumber).padStart(3, '0')}`
  const versionId = await nextAssetVersion(root, key)
  const output = resolve(root, 'assets', 'other', key, `${versionId}.png`)
  let registered = false
  try {
    extractFrame(source.path, output, 'last')
    await putAsset(root, { key, type: 'other', name: `镜头 ${shotNumber} 继承首帧` })
    await addAssetVersion(root, key, {
      id: versionId,
      localPath: relative(root, output),
      provenance: {
        origin: 'transformed',
        created_by: 'codex',
        provider: null,
        model_or_workflow: 'ffmpeg-extract-frame',
        task_id: null,
        prompt_document: { kind: 'continuity-plan', episode_key: episodeKey, version_id: continuityVersion, shot_number: shotNumber },
        source_assets: [{ key: sourceKey, version_id: source.version.id }],
        parameters: { position: 'last', source_sha256: source.version.sha256 },
      },
    })
    registered = true
    await selectAssetVersion(root, key, versionId)
    return { asset_key: key, version_id: versionId, local_path: relative(root, output), source_sha256: source.version.sha256 }
  } catch (error) {
    if (!registered) await rm(output, { force: true })
    throw error
  }
}
