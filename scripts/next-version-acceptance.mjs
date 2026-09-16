#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { access, readFile, realpath } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { dirname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUTPUT_LIMIT = 4000
const DUBBING_REVIEW_DIMENSIONS = ['semantic_integrity', 'speaker_identity', 'emotion_arc', 'intensity_and_subtext', 'emphasis_pause_breath', 'timing_fit', 'picture_interaction', 'technical_audio']

export function acceptanceChecks() {
  return [
    { id: 'character-appeal', title: '人物银幕吸引力与儿童保护', required_files: ['scripts/character-appeal.mjs', 'scripts/character-appeal-review.mjs'], commands: ['node --test scripts/character-appeal.test.mjs scripts/character-appeal-review.test.mjs scripts/character-identity-binding.test.mjs'] },
    { id: 'tail-frame', title: '上一镜尾帧绑定下一镜首帧', required_files: ['scripts/previous-tail.mjs'], commands: ['node --test scripts/previous-tail.test.mjs scripts/previous-tail-binding.test.mjs'] },
    { id: 'spatial-continuity', title: '连续镜头空间方位', required_files: ['scripts/continuity-plan.mjs'], commands: ['node --test scripts/continuity-plan.test.mjs'] },
    { id: 'native-audio', title: '原生音频优先与受控兜底', required_files: ['scripts/audio-plan-contract.mjs', 'scripts/native-audio-audit.mjs'], commands: ['node --test scripts/audio-plan-contract.test.mjs scripts/native-audio-audit.test.mjs scripts/audio-fallback.test.mjs scripts/native-audio-routing.test.mjs'] },
    { id: 'voice-lip-sync', title: '语音生成、外部音频与口型', required_files: ['scripts/generation/musetalk.mjs', 'scripts/generation/voice-tools.mjs'], commands: ['node --test scripts/audio-fallback-flow.test.mjs scripts/generation/musetalk.test.mjs scripts/lip-sync-flow.test.mjs'] },
    { id: 'source-timed-emotional-dubbing', title: '源时间线情感配音闭环', required_files: ['scripts/speech-timing.mjs', 'scripts/dubbing-compiler.mjs', 'scripts/dubbing-fit.mjs', 'scripts/dubbing-performance-review.mjs', 'scripts/subtitles-from-audio.mjs'], commands: ['node --test scripts/speech-timing.test.mjs scripts/audio-plan-contract.test.mjs scripts/dubbing-compiler.test.mjs scripts/dubbing-fit.test.mjs scripts/dubbing-performance-review.test.mjs scripts/subtitles-from-audio.test.mjs scripts/dubbing-mcp.test.mjs scripts/lip-sync-flow.test.mjs scripts/source-timed-dubbing-flow.test.mjs'], requires_external_evidence: true },
    { id: 'licensed-music', title: '授权音乐目录', required_files: ['scripts/music-catalog/providers.mjs', 'scripts/music-license-ledger.mjs'], commands: ['node --test scripts/music-catalog/providers.test.mjs scripts/music-license-ledger.test.mjs scripts/licensed-music-flow.test.mjs'] },
    { id: 'media-editing-mcp', title: '视频局部修复 MCP', required_files: ['scripts/media-operation-contract.mjs', 'scripts/media-operations.mjs'], commands: ['node --test scripts/media-operation-contract.test.mjs scripts/media-operation-mcp.test.mjs scripts/media-operation-review.test.mjs scripts/media-operations.test.mjs'] },
    { id: 'seedvr25', title: 'RunningHub SeedVR2.5 超分', required_files: ['scripts/generation/seedvr2.5-video-upscale.mapping.json'], commands: ['node --test scripts/generation/seedvr25-mapping.test.mjs scripts/generation/seedvr25-adapter.test.mjs scripts/seedvr25-flow.test.mjs scripts/generation/live-smoke-test.test.mjs'], requires_external_evidence: true },
    { id: 'plugin-release', title: '插件回归与版本一致性', required_files: ['.codex-plugin/plugin.json', '.claude-plugin/plugin.json', '.claude-plugin/marketplace.json'], commands: ['node scripts/integration-self-check.mjs --self-check', 'node scripts/audit-plugin.mjs --self-check'] },
  ]
}

function runCommand(command) {
  const [program, ...args] = command.split(' ')
  const result = spawnSync(program, args, { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
  const output = `${result.stdout || ''}${result.stderr || ''}`
  return { command, passed: result.status === 0 && !result.error, exit_code: result.status, output_tail: output.slice(-OUTPUT_LIMIT), ...(result.error ? { error: result.error.message } : {}) }
}

async function sha256(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex')
}

async function verifySeedVrEvidence() {
  const projectArg = process.env.SEEDVR25_EVIDENCE_PROJECT
  if (!projectArg) throw new Error('缺少 SEEDVR25_EVIDENCE_PROJECT；合成测试不能替代真实付费超分与完整复看证据')
  const project = await realpath(resolve(projectArg))
  const [assets, reviews, tasks] = await Promise.all([
    readFile(resolve(project, '.short-drama/assets.json'), 'utf8').then(JSON.parse),
    readFile(resolve(project, '.short-drama/shot-reviews.json'), 'utf8').then(JSON.parse),
    readFile(resolve(project, '.short-drama/tasks.json'), 'utf8').then(JSON.parse),
  ])
  const requestedAsset = process.env.SEEDVR25_EVIDENCE_ASSET
  const candidates = Object.values(assets.assets || {}).filter((asset) => !requestedAsset || asset.key === requestedAsset)
  for (const asset of candidates) {
    const version = asset.versions?.find((item) => item.id === asset.selectedVersionId)
    if (version?.provenance?.model_or_workflow !== 'seedvr2.5-video-upscale') continue
    const review = reviews.reviews?.[`${asset.key}@${version.id}`]
    const task = Object.values(tasks.tasks || {}).find((item) => item.taskId === version.provenance.task_id || item.providerTaskId === version.provenance.task_id)
    const local = resolve(project, version.localPath || '')
    if (local !== project && !local.startsWith(`${project}${sep}`)) continue
    // 兼容旧审核记录保存在 QC 中的哈希；新记录同时写入顶层 asset_sha256。
    const reviewedSha256 = review?.asset_sha256 || review?.qc?.video_sha256
    if (review?.review_type !== 'media-operation' || review.operation !== 'video-upscale' || review.approved !== true || review.watched_full !== true || reviewedSha256 !== version.sha256 || review.qc?.passed !== true) continue
    if (!version.provenance.source_assets?.length || !version.provenance.parameters?.output_processing?.provider_output?.sha256) continue
    if (!task || task.status !== 'completed') continue
    await access(local)
    if (await sha256(local) !== version.sha256) continue
    return { passed: true, asset_key: asset.key, version_id: version.id, sha256: version.sha256, task_id: version.provenance.task_id }
  }
  throw new Error('项目中没有当前 selected、真实 RunningHub SeedVR2.5、完整复看且专项审核通过的输出')
}

function projectPath(project, path, label) {
  const resolved = resolve(project, path || '')
  if (resolved !== project && !resolved.startsWith(`${project}${sep}`)) throw new Error(`${label} 路径越界`)
  return resolved
}

function evidenceVersion(assets, reference, { selected = false } = {}) {
  const asset = assets.assets?.[reference?.asset_key]
  const version = asset?.versions?.find((item) => item.id === reference?.version_id)
  if (!asset || !version || asset.staleVersionIds?.includes(reference.version_id) || selected && asset.selectedVersionId !== reference.version_id) throw new Error('真实配音验收引用的资产不存在、已失效或不是当前 selected')
  if (version.sha256 !== reference.sha256) throw new Error('真实配音验收报告与资产账本 SHA 不一致')
  return { asset, version }
}

function fullDubbingReview(review, report) {
  if (review?.review_type !== 'dubbing-performance' || review.approved !== true || review.selection_state !== 'committed' || review.watched_full !== true) throw new Error('真实配音证据缺少已提交的八维完整复听')
  if (DUBBING_REVIEW_DIMENSIONS.some((key) => review.dimensions?.[key]?.status !== 'passed' || typeof review.dimensions[key].observation !== 'string' || !review.dimensions[key].observation.trim())) throw new Error('真实配音证据的八维完整复听不完整')
  if (review.issues?.some((issue) => ['P0', 'P1'].includes(issue.severity))) throw new Error('真实配音证据仍存在 P0/P1')
  if (report.performance_review?.watched_full !== true || DUBBING_REVIEW_DIMENSIONS.some((key) => report.performance_review?.dimensions?.[key]?.status !== 'passed')) throw new Error('A/B 报告没有绑定八维完整复听结果')
}

export async function verifySourceTimedDubbingEvidence(projectArg = process.env.DUBBING_EVIDENCE_PROJECT, reportArg = process.env.DUBBING_EVIDENCE_REPORT) {
  if (!projectArg) throw new Error('缺少 DUBBING_EVIDENCE_PROJECT；合成测试不能替代真实镜头情感配音 A/B')
  if (!reportArg) throw new Error('缺少 DUBBING_EVIDENCE_REPORT；必须指定真实镜头 A/B 报告')
  const project = await realpath(resolve(projectArg))
  const reportPath = projectPath(project, await realpath(resolve(project, reportArg)), 'A/B 报告')
  const [assets, reviews, tasks, report] = await Promise.all([
    readFile(resolve(project, '.short-drama/assets.json'), 'utf8').then(JSON.parse),
    readFile(resolve(project, '.short-drama/dubbing-reviews.json'), 'utf8').then(JSON.parse),
    readFile(resolve(project, '.short-drama/tasks.json'), 'utf8').then(JSON.parse),
    readFile(reportPath, 'utf8').then(JSON.parse),
  ])
  if (report.version !== 1 || report.accepted !== true || !/^ep-\d{3}$/.test(report.episode_key || '') || !Number.isInteger(report.line_index) || report.line_index <= 0) throw new Error('真实镜头 A/B 报告未通过或身份无效')
  if (!Number.isInteger(report.production_duration_ms) || report.production_duration_ms <= 0) throw new Error('真实镜头 A/B 报告缺少正整数制作耗时')
  const original = evidenceVersion(assets, report.original)
  const dub = evidenceVersion(assets, report.dub, { selected: true })
  if (original.asset.type !== 'video' || dub.asset.type !== 'audio') throw new Error('真实镜头 A/B 必须比较原视频与第三方配音音频')
  if (dub.version.provenance?.origin !== 'generated' || typeof dub.version.provenance.provider !== 'string' || !dub.version.provenance.provider.trim() || typeof dub.version.provenance.task_id !== 'string' || !dub.version.provenance.task_id.trim()) throw new Error('配音资产缺少真实第三方生成来源与任务')
  const originalPath = projectPath(project, original.version.localPath, '原视频')
  const dubPath = projectPath(project, dub.version.localPath, '配音')
  const [originalSha, dubSha] = await Promise.all([sha256(originalPath), sha256(dubPath)])
  if (originalSha !== report.original.sha256 || dubSha !== report.dub.sha256) throw new Error('真实媒体文件 SHA 与 A/B 报告不一致')
  const review = reviews.reviews?.[`${report.dub.asset_key}@${report.dub.version_id}`]
  if (review?.asset_sha256 !== dubSha || review.episode_key !== report.episode_key || review.line_index !== report.line_index) throw new Error('八维复听未绑定当前配音 SHA、分集和台词行')
  fullDubbingReview(review, report)
  if (report.source_timing?.word_errors?.status !== 'passed' || report.subtitle?.bound !== true || report.subtitle?.within_tolerance !== true || report.lip_sync?.bound !== true) throw new Error('真实镜头 A/B 的时序、字幕或口型验收未通过')
  const task = Object.values(tasks.tasks || {}).find((item) => item.taskId === dub.version.provenance.task_id || item.providerTaskId === dub.version.provenance.task_id)
  if (!task || task.status !== 'completed') throw new Error('真实第三方配音没有绑定已完成的生成任务')
  return { passed: true, report: reportPath, asset_key: report.dub.asset_key, version_id: report.dub.version_id, sha256: dubSha, task_id: dub.version.provenance.task_id }
}

async function verifyExternalEvidence(check) {
  if (check.id === 'seedvr25') return verifySeedVrEvidence()
  if (check.id === 'source-timed-emotional-dubbing') return verifySourceTimedDubbingEvidence()
  throw new Error(`未知外部证据类型：${check.id}`)
}

async function run() {
  const results = []
  for (const check of acceptanceChecks()) {
    const missing = []
    for (const file of check.required_files) try { await access(resolve(root, file)) } catch { missing.push(file) }
    const commands = missing.length ? [] : check.commands.map(runCommand)
    let external_evidence = null
    if (check.requires_external_evidence && !missing.length && commands.every((item) => item.passed)) {
      try { external_evidence = await verifyExternalEvidence(check) }
      catch (error) { external_evidence = { passed: false, error: error.message } }
    }
    results.push({ id: check.id, title: check.title, passed: missing.length === 0 && commands.every((item) => item.passed) && (!check.requires_external_evidence || external_evidence?.passed === true), missing_files: missing, commands, ...(check.requires_external_evidence ? { external_evidence } : {}) })
  }
  const output = { passed: results.every((item) => item.passed), results }
  console.log(process.argv.includes('--json') ? JSON.stringify(output, null, 2) : results.map((item) => `${item.passed ? 'PASS' : 'FAIL'} ${item.id} ${item.title}`).join('\n'))
  if (!output.passed) process.exitCode = 1
}

if (process.argv[1] === fileURLToPath(import.meta.url)) run().catch((error) => { console.error(error.message); process.exitCode = 1 })
