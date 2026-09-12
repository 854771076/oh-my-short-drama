#!/usr/bin/env node
import { mkdir, readFile, realpath, rename, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { dirname, resolve, sep } from 'node:path'
import { withFileLock } from './file-lock.mjs'
import { selectAssetVersion } from './asset-ledger.mjs'
import { sameShotVersion } from './shot-fingerprint.mjs'

const CHECKS = new Set(['passed', 'failed', 'not-applicable'])
// 机器质量标记必须人工复核后才能放行；只能用带实际观察的误报判定覆盖。
const BLOCKING_QUALITY_FLAGS = new Set(['grid_suspect', 'grid_check_failed'])
export const STORYBOARD_REVIEW_CRITERIA = [
  '空间关系与轴线', '时间与动作连续性', '物理与交互逻辑', '光线与色彩连续性',
  '人物身份与造型一致性', '场景与道具一致性', '构图与镜头语言', '叙事覆盖与阅读顺序',
]
const pathFor = (root) => resolve(root, '.short-drama', 'shot-reviews.json')

function validate(record) {
  for (const field of ['assetKey', 'versionId']) if (typeof record[field] !== 'string' || !record[field]) throw new Error(`${field} 必填`)
  if (!/^v\d{3}$/.test(record.versionId)) throw new Error('versionId 必须为 v001 格式')
  for (const field of ['visual', 'audio', 'transition', 'captions']) if (!CHECKS.has(record[field])) throw new Error(`${field} 验收值无效`)
  if (!Array.isArray(record.issues)) throw new Error('issues[] 必填')
  for (const issue of record.issues) if (!['P0', 'P1', 'P2'].includes(issue?.severity) || typeof issue.message !== 'string') throw new Error('issue 必须包含有效 severity/message')
  if (!Array.isArray(record.criteria) || record.criteria.length === 0) throw new Error('criteria[] 必填，必须逐项记录制作计划验收点的实际观察')
  for (const item of record.criteria) if (typeof item?.criterion !== 'string' || !item.criterion.trim() || !['passed', 'failed'].includes(item.status) || typeof item.observation !== 'string' || !item.observation.trim()) throw new Error('criteria[] 必须包含 criterion/status/observation')
  if (record.grid_check !== undefined && (record.grid_check?.status !== 'false-positive' || typeof record.grid_check.observation !== 'string' || !record.grid_check.observation.trim())) throw new Error('grid_check 必须是 {status:"false-positive", observation:"实际观看观察"}')
  return record.visual === 'passed' && !['audio', 'transition', 'captions'].some((field) => record[field] === 'failed') && record.criteria.every((item) => item.status === 'passed') && !record.issues.some((issue) => issue.severity === 'P0' || issue.severity === 'P1')
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

async function main() {
  const [command, rootArg, inputPath] = process.argv.slice(2)
  if (command === '--self-check') {
    if (!validate({ assetKey: 'shot-1', versionId: 'v001', visual: 'passed', audio: 'not-applicable', transition: 'passed', captions: 'not-applicable', issues: [], criteria: [{ criterion: '主体清晰', status: 'passed', observation: '主体全程可辨认' }] })) throw new Error('验收自检失败')
    try { validate({ assetKey: 'shot-1', versionId: 'v001', visual: 'passed', audio: 'not-applicable', transition: 'passed', captions: 'not-applicable', issues: [], criteria: [{ criterion: '主体清晰', status: 'passed', observation: 'ok' }], grid_check: { status: 'ok' } }); throw new Error('grid_check 自检失败') }
    catch (error) { if (!String(error.message).includes('grid_check')) throw error }
    return console.log('ok')
  }
  if (!rootArg) throw new Error('必须提供项目目录')
  const root = resolve(rootArg)
  if (command === 'list') return console.log(JSON.stringify(await read(root), null, 2))
  if (command !== 'put' || !inputPath) throw new Error('用法：review-ledger.mjs put <项目目录> <验收 JSON> | list <项目目录>')
  return withFileLock(pathFor(root), async () => {
    const record = JSON.parse(await readFile(resolve(inputPath), 'utf8'))
    const approved = validate(record)
    const assets = JSON.parse(await readFile(resolve(root, '.short-drama', 'assets.json'), 'utf8'))
    const asset = assets.assets?.[record.assetKey]
    if (!asset) throw new Error('验收资产不存在')
    const version = asset.versions?.find((item) => item.id === record.versionId)
    if (!version || asset.staleVersionIds?.includes(record.versionId)) throw new Error('验收目标必须是未失效的候选资产版本')
    const blockingFlags = (version.quality_flags || []).filter((flag) => BLOCKING_QUALITY_FLAGS.has(flag))
    if (blockingFlags.length && approved && record.grid_check?.status !== 'false-positive') throw new Error(`版本带有机器质量标记 ${blockingFlags.join('、')}：必须实际观看素材，确认为误报时在 grid_check 写明观察再通过；确认宫格请判 failed 并重生`)
    if (record.grid_check && !blockingFlags.length) throw new Error('版本没有待复核的机器质量标记，不得提交 grid_check')
    const local = resolve(root, version?.localPath || '')
    if (!version?.localPath || (local !== root && !local.startsWith(`${root}${sep}`))) throw new Error('验收资产路径无效')
    const [rootReal, localReal] = await Promise.all([realpath(root), realpath(local)])
    if (localReal !== rootReal && !localReal.startsWith(`${rootReal}${sep}`)) throw new Error('验收资产真实路径必须位于项目内')
    if (version.provenance?.origin === 'generated' && asset.type === 'storyboard') {
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
