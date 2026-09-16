import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import { selectAudioVersionAndInvalidateDerived, verifiedAssetVersion } from './asset-ledger.mjs'
import { selectedSpeechTiming } from './speech-timing.mjs'
import { withFileLock } from './file-lock.mjs'

export const DUBBING_REVIEW_DIMENSIONS = Object.freeze([
  'semantic_integrity',
  'speaker_identity',
  'emotion_arc',
  'intensity_and_subtext',
  'emphasis_pause_breath',
  'timing_fit',
  'picture_interaction',
  'technical_audio',
])

const VERSION = /^v\d{3}$/
const SHA256 = /^[0-9a-f]{64}$/
const TECHNICAL_CHECKS = ['clipping', 'swallowed_words', 'tail_cutoff', 'unnatural_tempo', 'loudness_blocker']

function reviewPath(root) { return resolve(root, '.short-drama', 'dubbing-reviews.json') }

async function readJson(path, fallback = null) {
  try { return JSON.parse(await readFile(path, 'utf8')) }
  catch (error) { if (error?.code === 'ENOENT') return fallback; throw error }
}

async function writeJsonAtomic(path, value) {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${randomUUID()}.tmp`
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' })
  await rename(temporary, path)
}

function requiredString(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} 必填`)
  return value
}

function validateDimension(key, value) {
  if (!value || typeof value !== 'object' || !['passed', 'failed'].includes(value.status) || typeof value.evidence !== 'string' || !value.evidence.trim()) throw new Error(`审核维度 ${key} 无效`)
  if (key === 'technical_audio') {
    if (!value.checks || TECHNICAL_CHECKS.some((name) => typeof value.checks[name] !== 'boolean')) throw new Error('technical_audio 必须逐项核对技术阻断项')
    if (value.status === 'passed' && TECHNICAL_CHECKS.some((name) => value.checks[name])) throw new Error('technical_audio 存在技术阻断项时不得通过')
  }
  return structuredClone(value)
}

function validateReview(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('配音审核输入无效')
  for (const field of ['asset_key', 'episode_key', 'reviewer']) requiredString(input[field], field)
  for (const field of ['version_id', 'audio_plan_version', 'timing_version_id']) if (!VERSION.test(input[field] || '')) throw new Error(`${field} 必须为 v001 格式`)
  if (!/^audio-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.asset_key) || !/^ep-\d{3}$/.test(input.episode_key) || !Number.isInteger(input.line_index) || input.line_index <= 0 || !SHA256.test(input.asset_sha256 || '')) throw new Error('配音审核绑定字段无效')
  if (typeof input.watched_full !== 'boolean' || !input.dimensions || typeof input.dimensions !== 'object' || Array.isArray(input.dimensions)) throw new Error('配音审核必须声明完整观看和八维结果')
  const dimensions = Object.fromEntries(DUBBING_REVIEW_DIMENSIONS.map((key) => [key, validateDimension(key, input.dimensions[key])]))
  if (Object.keys(input.dimensions).some((key) => !DUBBING_REVIEW_DIMENSIONS.includes(key))) throw new Error('配音审核包含未知维度')
  if (!Array.isArray(input.issues) || input.issues.some((issue) => !issue || !['P0', 'P1', 'P2', 'P3'].includes(issue.severity) || typeof issue.message !== 'string' || !issue.message.trim())) throw new Error('配音审核 issues 无效')
  const approved = input.watched_full && DUBBING_REVIEW_DIMENSIONS.every((key) => dimensions[key].status === 'passed') && !input.issues.some(({ severity }) => severity === 'P0' || severity === 'P1')
  return { ...structuredClone(input), review_type: 'dubbing-performance', dimensions, approved }
}

async function selectedAudioPlan(root, episodeKey) {
  const directory = resolve(root, 'episodes', episodeKey, 'audio-plan')
  const marker = await readJson(resolve(directory, 'selected.json'))
  if (!marker || !VERSION.test(marker.versionId || '')) throw new Error('必须先选择 audio-plan 版本')
  const document = await readJson(resolve(directory, `${marker.versionId}.json`))
  if (!document) throw new Error('selected audio-plan 文档不存在')
  return { version_id: marker.versionId, document }
}

async function verifyBindings(root, review) {
  const audio = await verifiedAssetVersion(root, review.asset_key, review.version_id)
  if (audio.asset.type !== 'audio' || audio.version.sha256 !== review.asset_sha256) throw new Error('审核音频资产或 SHA 不匹配')
  const plan = await selectedAudioPlan(root, review.episode_key)
  if (plan.version_id !== review.audio_plan_version) throw new Error('审核必须绑定当前 selected audio-plan 版本')
  const line = plan.document.lines?.find((item) => item.line_index === review.line_index)
  if (!line || line.dubbing_contract?.mode !== 'generated') throw new Error('审核未绑定有效的生成配音合同')
  const timing = await selectedSpeechTiming(root, review.episode_key)
  if (timing.version_id !== review.timing_version_id || line.dubbing_contract.timing_source?.version_id !== timing.version_id) throw new Error('审核必须绑定当前最终 speech-timing 版本')
  if (line.dubbing_contract.timing_source?.line_index !== review.line_index) throw new Error('审核行与配音合同 timing 行不一致')
  return audio
}

export async function putDubbingPerformanceReview(rootArg, input) {
  const root = resolve(rootArg)
  const review = validateReview(input)
  await verifyBindings(root, review)
  const target = reviewPath(root)
  return withFileLock(target, async () => {
    const previousBytes = await readFile(target).catch((error) => error?.code === 'ENOENT' ? null : Promise.reject(error))
    const ledger = previousBytes ? JSON.parse(previousBytes) : { version: 1, reviews: {} }
    const identity = `${review.asset_key}@${review.version_id}`
    const previousReview = ledger.reviews?.[identity]
    if (previousReview) {
      if (JSON.stringify(previousReview) !== JSON.stringify(review)) throw new Error(`配音审核不可变：${identity}`)
      return { approved: review.approved, selected: false, invalidated: [], review: structuredClone(previousReview) }
    }
    ledger.reviews ||= {}
    ledger.reviews[identity] = review
    await writeJsonAtomic(target, ledger)
    if (!review.approved) return { approved: false, selected: false, invalidated: [], review }
    try {
      const selected = await selectAudioVersionAndInvalidateDerived(root, review.asset_key, review.version_id)
      return { approved: true, selected: true, invalidated: selected.invalidated, review }
    } catch (error) {
      // 审核账本和资产选版必须共同成功；选版失败时恢复审核前状态，允许修复后重试。
      if (previousBytes === null) await rm(target, { force: true })
      else {
        const temporary = `${target}.${randomUUID()}.rollback`
        await writeFile(temporary, previousBytes, { flag: 'wx' })
        await rename(temporary, target)
      }
      throw error
    }
  })
}
