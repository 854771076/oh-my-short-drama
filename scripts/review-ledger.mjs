#!/usr/bin/env node
import { mkdir, readFile, realpath, rename, writeFile } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { dirname, resolve, sep } from 'node:path'
import { withFileLock } from './file-lock.mjs'
import { selectAssetVersion, selectedAssetVersion } from './asset-ledger.mjs'
import { sameShotVersion } from './shot-fingerprint.mjs'
import { fileSha256, probePrevizMedia, validatePrevizContract, validatePrevizMedia } from './previz-contract.mjs'
import { validateMediaOperationReview } from './media-operation-review.mjs'

const CHECKS = new Set(['passed', 'failed', 'not-applicable'])
// 机器质量标记必须人工复核后才能放行；只能用带实际观察的误报判定覆盖。
const BLOCKING_QUALITY_FLAGS = new Set(['grid_suspect', 'grid_high_confidence', 'grid_check_failed'])
const VIDEO_CONTINUITY_FIELDS = ['identity', 'screen_direction', 'facing_and_gaze', 'entry_exit', 'end_state']
const hasConfirmedGrid = (flags) => flags.includes('grid_high_confidence')
export const STORYBOARD_REVIEW_CRITERIA = [
  '空间关系与轴线', '时间与动作连续性', '物理与交互逻辑', '光线与色彩连续性',
  '人物身份与造型一致性', '场景与道具一致性', '构图与镜头语言', '叙事覆盖与阅读顺序',
]
export const PREVIZ_SCORE_WEIGHTS = {
  '剧情因果与节拍': 20,
  '人物调度与表演': 15,
  '相机动机与运动曲线': 20,
  '构图与视觉层级': 15,
  '空间、轴线与连续性': 15,
  '物理与接触': 10,
  '技术交付': 5,
}
export const PREVIZ_REVIEW_CRITERIA = Object.keys(PREVIZ_SCORE_WEIGHTS)
const pathFor = (root) => resolve(root, '.short-drama', 'shot-reviews.json')

export function validPrevizScore(score) {
  if (!score || !Number.isFinite(score.total) || !score.breakdown || JSON.stringify(Object.keys(score.breakdown)) !== JSON.stringify(PREVIZ_REVIEW_CRITERIA)) return false
  const total = PREVIZ_REVIEW_CRITERIA.reduce((sum, criterion) => {
    const value = score.breakdown[criterion]
    const maximum = PREVIZ_SCORE_WEIGHTS[criterion]
    if (!Number.isFinite(value) || value < maximum * 0.7 || value > maximum) return NaN
    return sum + value
  }, 0)
  return Number.isFinite(total) && total === score.total && total >= 85
}

function validate(record) {
  for (const field of ['assetKey', 'versionId']) if (typeof record[field] !== 'string' || !record[field]) throw new Error(`${field} 必填`)
  if (!/^v\d{3}$/.test(record.versionId)) throw new Error('versionId 必须为 v001 格式')
  for (const field of ['visual', 'audio', 'transition', 'captions']) if (!CHECKS.has(record[field])) throw new Error(`${field} 验收值无效`)
  if (!Array.isArray(record.issues)) throw new Error('issues[] 必填')
  for (const issue of record.issues) if (!['P0', 'P1', 'P2'].includes(issue?.severity) || typeof issue.message !== 'string') throw new Error('issue 必须包含有效 severity/message')
  if (!Array.isArray(record.criteria) || record.criteria.length === 0) throw new Error('criteria[] 必填，必须逐项记录制作计划验收点的实际观察')
  for (const item of record.criteria) if (typeof item?.criterion !== 'string' || !item.criterion.trim() || !['passed', 'failed'].includes(item.status) || typeof item.observation !== 'string' || !item.observation.trim()) throw new Error('criteria[] 必须包含 criterion/status/observation')
  if (record.grid_check !== undefined && (record.grid_check?.status !== 'false-positive' || typeof record.grid_check.observation !== 'string' || !record.grid_check.observation.trim())) throw new Error('grid_check 必须是 {status:"false-positive", observation:"实际观看观察"}')
  if (record.continuity !== undefined) for (const field of VIDEO_CONTINUITY_FIELDS) {
    const item = record.continuity?.[field]
    if (!['passed', 'failed'].includes(item?.status) || typeof item.observation !== 'string' || !item.observation.trim()) throw new Error(`continuity.${field} 必须包含 status/observation`)
  }
  return record.visual === 'passed' && !['audio', 'transition', 'captions'].some((field) => record[field] === 'failed') && record.criteria.every((item) => item.status === 'passed') && (!record.continuity || VIDEO_CONTINUITY_FIELDS.every((field) => record.continuity[field].status === 'passed')) && !record.issues.some((issue) => issue.severity === 'P0' || issue.severity === 'P1')
}

async function read(root) {
  try { return JSON.parse(await readFile(pathFor(root), 'utf8')) }
  catch (error) { if (error?.code === 'ENOENT') return { version: 1, reviews: {} }; throw error }
}

async function save(root, value) {
  const target = pathFor(root)
  await mkdir(dirname(target), { recursive: true })
  const temporary = `${target}.${randomUUID()}.tmp`
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' })
  await rename(temporary, target)
}

export async function putMediaOperationReview(rootArg, input) {
  const root = resolve(rootArg)
  const record = structuredClone(input)
  if (!/^shot-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(record?.asset_key || '')) throw new Error('媒体操作审核 asset_key 无效')
  if (!/^v\d{3}$/.test(record?.version_id || '')) throw new Error('媒体操作审核 version_id 无效')
  validateMediaOperationReview(record.operation, record)
  return withFileLock(pathFor(root), async () => {
    const assets = JSON.parse(await readFile(resolve(root, '.short-drama', 'assets.json'), 'utf8'))
    const asset = assets.assets?.[record.asset_key]
    const version = asset?.versions?.find((item) => item.id === record.version_id)
    if (asset?.type !== 'video' || !version || asset.staleVersionIds?.includes(record.version_id)) throw new Error('媒体操作审核目标必须是未失效的视频候选版本')
    if (version.provenance?.origin !== 'transformed' || version.provenance?.parameters?.operation !== record.operation) throw new Error('媒体操作审核类型必须与候选版本 provenance 一致')
    const source = version.provenance.source_assets?.find((item) => item.key === record.asset_key)
    if (!source || asset.selectedVersionId !== source.version_id) throw new Error('媒体操作审核只能替换当前 selected 来源版本')
    const sourceVersion = asset.versions.find((item) => item.id === source.version_id)
    if (!sourceVersion || version.provenance.parameters.source_sha256 !== sourceVersion.sha256) throw new Error('媒体操作候选记录的来源 SHA-256 与当前来源版本不一致')
    await selectedAssetVersion(root, record.asset_key)
    const local = resolve(root, version.localPath || '')
    const [rootReal, localReal] = await Promise.all([realpath(root), realpath(local)])
    if (localReal !== rootReal && !localReal.startsWith(`${rootReal}${sep}`)) throw new Error('媒体操作审核文件必须位于项目内')
    const actualSha256 = createHash('sha256').update(await readFile(localReal)).digest('hex')
    if (actualSha256 !== version.sha256 || record.qc?.video_sha256 && record.qc.video_sha256 !== version.sha256) throw new Error('媒体操作审核 QC 必须绑定当前候选文件 SHA-256')

    const ledger = await read(root)
    const key = `${record.asset_key}@${record.version_id}`
    const previous = ledger.reviews[key]
    const saved = { ...record, review_type: 'media-operation', reviewedAt: new Date().toISOString() }
    ledger.reviews[key] = saved
    await save(root, ledger)
    if (record.approved) try { await selectAssetVersion(root, record.asset_key, record.version_id) }
    catch (error) {
      if (previous) ledger.reviews[key] = previous
      else delete ledger.reviews[key]
      await save(root, ledger)
      throw error
    }
    return { ...saved, selected: record.approved }
  })
}

async function main() {
  const [command, rootArg, inputPath] = process.argv.slice(2)
  if (command === '--self-check') {
    if (!validate({ assetKey: 'shot-1', versionId: 'v001', visual: 'passed', audio: 'not-applicable', transition: 'passed', captions: 'not-applicable', issues: [], criteria: [{ criterion: '主体清晰', status: 'passed', observation: '主体全程可辨认' }] })) throw new Error('验收自检失败')
    try { validate({ assetKey: 'shot-1', versionId: 'v001', visual: 'passed', audio: 'not-applicable', transition: 'passed', captions: 'not-applicable', issues: [], criteria: [{ criterion: '主体清晰', status: 'passed', observation: 'ok' }], grid_check: { status: 'ok' } }); throw new Error('grid_check 自检失败') }
    catch (error) { if (!String(error.message).includes('grid_check')) throw error }
    if (!hasConfirmedGrid(['grid_high_confidence']) || hasConfirmedGrid(['grid_suspect'])) throw new Error('高置信宫格门禁自检失败')
    if (!validPrevizScore({ total: 85, breakdown: { '剧情因果与节拍': 17, '人物调度与表演': 13, '相机动机与运动曲线': 17, '构图与视觉层级': 13, '空间、轴线与连续性': 13, '物理与接触': 8, '技术交付': 4 } })) throw new Error('白模评分自检失败')
    if (validPrevizScore({ total: 95, breakdown: { '剧情因果与节拍': 20, '人物调度与表演': 15, '相机动机与运动曲线': 20, '构图与视觉层级': 15, '空间、轴线与连续性': 12, '物理与接触': 10, '技术交付': 3 } })) throw new Error('白模评分单项门禁自检失败')
    return console.log('ok')
  }
  if (!rootArg) throw new Error('必须提供项目目录')
  const root = resolve(rootArg)
  if (command === 'list') return console.log(JSON.stringify(await read(root), null, 2))
  if (command === 'review-media-operation' && inputPath) return console.log(JSON.stringify(await putMediaOperationReview(root, JSON.parse(await readFile(resolve(inputPath), 'utf8'))), null, 2))
  if (command !== 'put' || !inputPath) throw new Error('用法：review-ledger.mjs put <项目目录> <验收 JSON> | review-media-operation <项目目录> <专项审核 JSON> | list <项目目录>')
  return withFileLock(pathFor(root), async () => {
    const record = JSON.parse(await readFile(resolve(inputPath), 'utf8'))
    let approved = validate(record)
    const assets = JSON.parse(await readFile(resolve(root, '.short-drama', 'assets.json'), 'utf8'))
    const asset = assets.assets?.[record.assetKey]
    if (!asset) throw new Error('验收资产不存在')
    const version = asset.versions?.find((item) => item.id === record.versionId)
    if (!version || asset.staleVersionIds?.includes(record.versionId)) throw new Error('验收目标必须是未失效的候选资产版本')
    if (version.provenance?.origin === 'transformed' && version.provenance?.parameters?.operation) throw new Error('媒体操作候选必须使用 review-media-operation 专项审核，不得用普通镜头验收绕过')
    const blockingFlags = (version.quality_flags || []).filter((flag) => BLOCKING_QUALITY_FLAGS.has(flag))
    if (hasConfirmedGrid(blockingFlags) && approved) throw new Error('机器在多数抽样帧中高置信命中宫格/分屏，当前版本不得以误报方式批准；请判 failed 并重生单一连续画面')
    if (blockingFlags.length && approved && record.grid_check?.status !== 'false-positive') throw new Error(`版本带有机器质量标记 ${blockingFlags.join('、')}：必须实际观看素材，确认为误报时在 grid_check 写明观察再通过；确认宫格请判 failed 并重生`)
    if (record.grid_check && !blockingFlags.length) throw new Error('版本没有待复核的机器质量标记，不得提交 grid_check')
    const local = resolve(root, version?.localPath || '')
    if (!version?.localPath || (local !== root && !local.startsWith(`${root}${sep}`))) throw new Error('验收资产路径无效')
    const [rootReal, localReal] = await Promise.all([realpath(root), realpath(local)])
    if (localReal !== rootReal && !localReal.startsWith(`${rootReal}${sep}`)) throw new Error('验收资产真实路径必须位于项目内')
    if (version.provenance?.origin === 'generated' && asset.type === 'other' && /^other-previz-ep\d{3}-\d{3}$/.test(record.assetKey)) {
      const source = version.provenance?.prompt_document
      const match = /^other-previz-(ep\d{3})-(\d{3})$/.exec(record.assetKey)
      const episode = match[1].replace('ep', 'ep-')
      const shotNumber = Number(match[2])
      if (version.provenance.created_by !== 'codex' || version.provenance.model_or_workflow !== 'blender-eevee-previz' || source?.kind !== 'storyboard' || source.episode_key !== episode || source.shot_number !== shotNumber) throw new Error('验收白模分镜缺少有效 Blender 与分镜来源')
      const selected = JSON.parse(await readFile(resolve(root, 'episodes', episode, 'storyboard', 'selected.json'), 'utf8'))
      if (!await sameShotVersion(root, episode, 'storyboard', source.version_id, selected.versionId, shotNumber).catch(() => false)) throw new Error('验收白模分镜不是当前镜头内容')
      const contractPath = version.provenance?.parameters?.direction_contract
      if (typeof contractPath !== 'string' || !new RegExp(`^episodes/${episode}/previz/shot-${String(shotNumber).padStart(3, '0')}-v\\d{3}\\.json$`).test(contractPath)) throw new Error('验收白模分镜缺少当前镜头导演合同路径')
      const contractLocal = resolve(root, contractPath)
      const contractReal = await realpath(contractLocal)
      if (contractReal !== rootReal && !contractReal.startsWith(`${rootReal}${sep}`)) throw new Error('验收白模导演合同真实路径必须位于项目内')
      if (await fileSha256(contractReal) !== version.provenance.parameters.direction_contract_sha256) throw new Error('验收白模导演合同 SHA-256 与登记值不一致')
      const contract = JSON.parse(await readFile(contractReal, 'utf8'))
      const planSelected = JSON.parse(await readFile(resolve(root, 'episodes', episode, 'production-plan', 'selected.json'), 'utf8'))
      validatePrevizContract(contract, { episode, storyboardVersion: selected.versionId, productionPlanVersion: planSelected.versionId, shotNumber })
      const plan = JSON.parse(await readFile(resolve(root, planSelected.path), 'utf8'))
      const planShot = plan.shots?.find((item) => item.shot_number === shotNumber)
      if (!planShot) throw new Error('验收白模分镜在当前制作计划中不存在')
      if (record.audio !== 'not-applicable' || record.transition !== 'not-applicable' || record.captions !== 'not-applicable' || JSON.stringify(record.criteria.map((item) => item.criterion)) !== JSON.stringify(PREVIZ_REVIEW_CRITERIA)) throw new Error('白模分镜 criteria[] 必须按导演评分合同原顺序逐项覆盖')
      const actualSha256 = createHash('sha256').update(await readFile(localReal)).digest('hex')
      if (actualSha256 !== version.sha256 || record.asset_sha256 !== version.sha256) throw new Error('白模分镜审核必须绑定当前且未被替换的媒体 SHA-256')
      if (record.watchedFull !== true || !record.watch_evidence || !Number.isFinite(record.watch_evidence.duration_seconds) || record.watch_evidence.duration_seconds <= 0 || ['start', 'middle', 'end'].some((field) => typeof record.watch_evidence[field] !== 'string' || !record.watch_evidence[field].trim())) throw new Error('白模分镜必须完整观看并记录首、中、尾证据')
      const actualMedia = probePrevizMedia(localReal)
      validatePrevizMedia(actualMedia, contract, planShot)
      const expectedDuration = version.provenance?.parameters?.duration
      const durationTolerance = Math.max(0.05, 1 / actualMedia.fps)
      if (!Number.isFinite(expectedDuration) || Math.abs(actualMedia.duration_seconds - expectedDuration) > durationTolerance || Math.abs(record.watch_evidence.duration_seconds - actualMedia.duration_seconds) > durationTolerance) throw new Error('白模分镜审核时长必须与实际媒体及生成声明一致')
      if (!Array.isArray(record.hard_gates) || JSON.stringify(record.hard_gates.map((item) => item?.gate)) !== JSON.stringify(contract.review_contract.hard_gates)) throw new Error('白模分镜 hard_gates[] 必须按导演合同原顺序逐项覆盖')
      for (const evidence of record.hard_gates) if (!['passed', 'failed'].includes(evidence?.status) || typeof evidence.observation !== 'string' || !evidence.observation.trim() || !Number.isInteger(evidence.frame) || evidence.frame < 1 || evidence.frame > Math.round(contract.fps * contract.duration_seconds)) throw new Error('白模分镜 hard_gates[] 必须包含 gate/status/frame/observation 的逐帧证据')
      if (record.hard_gates.some((item) => item.status === 'failed')) approved = false
      if (approved && !validPrevizScore(record.score)) throw new Error('白模分镜通过时必须总分至少 85，且各项达到满分 70%')
    } else if (version.provenance?.origin === 'generated' && asset.type === 'storyboard') {
      const source = version.provenance?.prompt_document
      if (source?.kind !== 'storyboard' || !source.episode_key || !source.version_id || !Number.isInteger(source.shot_number) || record.assetKey !== `board-${source.episode_key.replace('-', '')}-${String(source.shot_number).padStart(3, '0')}`) throw new Error('验收分镜图缺少有效分镜来源')
      const selected = JSON.parse(await readFile(resolve(root, 'episodes', source.episode_key, 'storyboard', 'selected.json'), 'utf8'))
      const storyboard = JSON.parse(await readFile(resolve(root, 'episodes', source.episode_key, 'storyboard', `${source.version_id}.json`), 'utf8'))
      if (!storyboard.panels?.some((item) => item.shot_number === source.shot_number) || !await sameShotVersion(root, source.episode_key, 'storyboard', source.version_id, selected.versionId, source.shot_number).catch(() => false)) throw new Error('验收分镜图不是当前镜头内容')
      if (record.audio !== 'not-applicable' || record.transition !== 'not-applicable' || record.captions !== 'not-applicable' || JSON.stringify(record.criteria.map((item) => item.criterion)) !== JSON.stringify(STORYBOARD_REVIEW_CRITERIA)) throw new Error('分镜图 criteria[] 必须按八维审计合同原顺序逐项覆盖')
    } else if (version.provenance?.origin === 'generated') {
      const source = version.provenance?.prompt_document
      if (!source?.episode_key || !source?.version_id || !Number.isInteger(source?.shot_number)) throw new Error('验收视频缺少视频提示词来源')
      const prompts = JSON.parse(await readFile(resolve(root, 'episodes', source.episode_key, 'video-prompts', `${source.version_id}.json`), 'utf8'))
      const prompt = prompts.shots?.find((item) => item.shot_number === source.shot_number)
      const plan = JSON.parse(await readFile(resolve(root, 'episodes', source.episode_key, 'production-plan', `${prompt?.production_plan_version}.json`), 'utf8'))
      const required = plan.shots?.find((item) => item.shot_number === source.shot_number)?.review_checks || []
      const actual = record.criteria.map((item) => item.criterion)
      if (!required.length || JSON.stringify(actual) !== JSON.stringify(required)) throw new Error('criteria[] 必须按制作计划 review_checks 原顺序逐项覆盖')
      if (record.watchedFull !== true || !record.watch_evidence || !Number.isFinite(record.watch_evidence.duration_seconds) || record.watch_evidence.duration_seconds <= 0 || ['start', 'middle', 'end'].some((field) => typeof record.watch_evidence[field] !== 'string' || !record.watch_evidence[field].trim())) throw new Error('视频验收必须完整观看，并在 watch_evidence 记录时长及首、中、尾实际观察')
      if (!record.continuity || VIDEO_CONTINUITY_FIELDS.some((field) => !record.continuity[field])) throw new Error('视频验收必须逐项记录人物身份、运动方向、朝向与视线、出入画和尾帧状态')
    }
    const ledger = await read(root)
    const key = `${record.assetKey}@${record.versionId}`
    const previous = ledger.reviews[key]
    ledger.reviews[key] = { ...record, approved, reviewedAt: new Date().toISOString() }
    await save(root, ledger)
    if (approved) try { await selectAssetVersion(root, record.assetKey, record.versionId) }
    catch (error) {
      if (previous) ledger.reviews[key] = previous
      else delete ledger.reviews[key]
      await save(root, ledger)
      throw error
    }
    console.log(JSON.stringify({ ...ledger.reviews[key], selected: approved }, null, 2))
  })
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((error) => { console.error(error.message); process.exitCode = 1 })
