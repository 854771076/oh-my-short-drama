#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { starrouter } from './generation/starrouter.mjs'

const normalize = (value) => String(value || '').toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '')

function similarity(left, right) {
  const a = normalize(left), b = normalize(right)
  if (!a.length || !b.length) return a === b ? 1 : 0
  const row = Array.from({ length: b.length + 1 }, (_, index) => index)
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = row[0]
    row[0] = i
    for (let j = 1; j <= b.length; j += 1) {
      const previous = row[j]
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1))
      diagonal = previous
    }
  }
  return 1 - row[b.length] / Math.max(a.length, b.length)
}

const seconds = (item, prefix) => Number(item?.[`${prefix}_seconds`] ?? item?.[prefix] ?? (Number(item?.[`${prefix}_ms`]) / 1000))
const text = (item) => item?.text ?? item?.content ?? item?.line ?? item?.dialogue ?? ''

export function compareDialogue(expected, actual) {
  return expected.map((line, index) => {
    const segment = actual[index] || {}
    const expectedStart = seconds(line, 'start'), actualStart = seconds(segment, 'start')
    const score = similarity(text(line), text(segment))
    const driftSeconds = Number.isFinite(expectedStart) && Number.isFinite(actualStart) ? Math.abs(expectedStart - actualStart) : null
    const speakerMatched = line.speaker && segment.speaker ? normalize(line.speaker) === normalize(segment.speaker) : null
    return { index: index + 1, expected: text(line), actual: text(segment), similarity: Number(score.toFixed(3)), drift_seconds: driftSeconds, expected_speaker: line.speaker || null, actual_speaker: segment.speaker || null, passed: score >= 0.8 && (driftSeconds === null || driftSeconds <= 1) && speakerMatched !== false }
  })
}

async function auditVersion(root, { episodeKey, shotNumber, assetKey, versionId }) {
  const assets = JSON.parse(await readFile(resolve(root, '.short-drama', 'assets.json'), 'utf8'))
  const asset = assets.assets?.[assetKey]
  const version = asset?.versions?.find((item) => item.id === versionId)
  if (asset?.type !== 'video' || !version?.localPath || asset.staleVersionIds?.includes(versionId)) throw new Error('待审计视频版本不存在或已失效')
  const selection = JSON.parse(await readFile(resolve(root, 'episodes', episodeKey, 'video-prompts', 'selected.json'), 'utf8'))
  const prompts = JSON.parse(await readFile(resolve(root, selection.path), 'utf8'))
  const expected = prompts.shots?.find((item) => item.shot_number === shotNumber)?.audio_policy?.speech_timeline
  if (!Array.isArray(expected) || !expected.length) throw new Error('当前镜头缺少 audio_policy.speech_timeline，不能执行语义审计')
  const temporary = await mkdtemp(resolve(tmpdir(), 'short-drama-asr-'))
  let transcript
  try {
    const audio = resolve(temporary, 'audio.wav')
    const extraction = spawnSync('ffmpeg', ['-nostdin', '-loglevel', 'error', '-y', '-i', resolve(root, version.localPath), '-vn', '-ac', '1', '-ar', '16000', audio], { encoding: 'utf8' })
    if (extraction.error || extraction.status !== 0) throw new Error(`音轨提取失败：${extraction.error?.message || extraction.stderr || extraction.status}`)
    transcript = await starrouter.transcribe({ model: process.env.STARROUTER_ASR_MODEL || 'qwen3-asr-flash', file_path: audio, response_format: 'verbose_json', language: 'zh', confirmed: true })
  } finally { await rm(temporary, { recursive: true, force: true }) }
  const segments = Array.isArray(transcript.segments) && transcript.segments.length ? transcript.segments : [{ text: transcript.text }]
  const comparisons = compareDialogue(Array.isArray(transcript.segments) ? expected : [{ text: expected.map(text).join('') }], segments)
  const issues = []
  if (!Array.isArray(transcript.segments)) issues.push('ASR 未返回分句时间戳，需人工核对对白时序')
  else if (comparisons.length !== transcript.segments.length) issues.push('ASR 分段数与计划对白数不一致')
  for (const item of comparisons) {
    if (!item.passed) issues.push(`第 ${item.index} 句文本、说话人或时间偏差未通过`)
    if (item.expected_speaker && !item.actual_speaker) issues.push(`第 ${item.index} 句缺少说话人检测结果`)
  }
  const report = { episode_key: episodeKey, shot_number: shotNumber, asset_key: assetKey, version_id: versionId, sha256: version.sha256, approved: issues.length === 0, comparisons, issues, audited_at: new Date().toISOString() }
  const target = resolve(root, '.short-drama', 'audio-audits', `${assetKey}@${versionId}.json`)
  await mkdir(dirname(target), { recursive: true })
  const reportTemporary = `${target}.${randomUUID()}.tmp`
  await writeFile(reportTemporary, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' })
  await rename(reportTemporary, target)
  return report
}

async function auditEpisode(rootArg, episodeKey) {
  const root = resolve(rootArg)
  const selection = JSON.parse(await readFile(resolve(root, 'episodes', episodeKey, 'video-prompts', 'selected.json'), 'utf8'))
  const prompts = JSON.parse(await readFile(resolve(root, selection.path), 'utf8'))
  const assets = JSON.parse(await readFile(resolve(root, '.short-drama', 'assets.json'), 'utf8'))
  const jobs = []
  const skipped = []
  for (const shot of prompts.shots || []) {
    const expected = shot.audio_policy?.speech_timeline
    if (!Array.isArray(expected) || !expected.length) continue
    const assetKey = `shot-${episodeKey.replace('-', '')}-${String(shot.shot_number).padStart(3, '0')}`
    const asset = assets.assets?.[assetKey]
    const versionId = asset?.selectedVersionId
    if (!versionId || asset.staleVersionIds?.includes(versionId)) { skipped.push({ shot_number: shot.shot_number, asset_key: assetKey, reason: '视频候选未选版' }); continue }
    const version = asset.versions.find((item) => item.id === versionId)
    const reportPath = resolve(root, '.short-drama', 'audio-audits', `${assetKey}@${versionId}.json`)
    let existing = null
    try { existing = JSON.parse(await readFile(reportPath, 'utf8')) } catch (error) { if (error.code !== 'ENOENT') throw error }
    if (existing?.sha256 === version.sha256) skipped.push({ shot_number: shot.shot_number, asset_key: assetKey, version_id: versionId, reason: '已审计', approved: existing.approved })
    else jobs.push({ shotNumber: shot.shot_number, assetKey, versionId })
  }
  return { jobs, skipped }
}

async function main() {
  const [command, rootArg, episodeKey, shotRaw, assetKey, versionId, confirmation] = process.argv.slice(2)
  if (command === '--self-check') {
    const result = compareDialogue([{ text: '别绕弯子。', start: 1, speaker: '林乔' }], [{ text: '别绕弯子', start: 1.2, speaker: '林乔' }])[0]
    if (!result.passed || result.similarity !== 1) throw new Error('原生对白审计自检失败')
    return console.log('ok')
  }
  if (command === 'audit-episode') {
    if (!rootArg || !/^ep-\d{3}$/.test(episodeKey) || confirmation !== undefined && confirmation !== '--confirmed') throw new Error('用法：native-audio-audit.mjs audit-episode <项目> <ep-001> [--confirmed]')
    const { jobs, skipped } = await auditEpisode(resolve(rootArg), episodeKey)
    if (confirmation !== '--confirmed') {
      console.log(JSON.stringify({ phase: 'plan', episode_key: episodeKey, audit: jobs.map((job) => ({ shot_number: job.shotNumber, asset_key: job.assetKey, version_id: job.versionId })), skipped }, null, 2))
      return
    }
    const reports = []
    const failed = []
    for (const job of jobs) {
      try { reports.push(await auditVersion(resolve(rootArg), { episodeKey, ...job })) }
      catch (error) { failed.push({ shot_number: job.shotNumber, asset_key: job.assetKey, error: error.message }) }
    }
    console.log(JSON.stringify({ phase: 'audited', episode_key: episodeKey, reports, failed, skipped }, null, 2))
    if (failed.length || reports.some((report) => !report.approved)) process.exitCode = 1
    return
  }
  if (command !== 'audit' || !rootArg || !/^ep-\d{3}$/.test(episodeKey) || !/^\d+$/.test(shotRaw) || !assetKey || !/^v\d{3}$/.test(versionId) || confirmation !== '--confirmed') throw new Error('用法：native-audio-audit.mjs audit <项目> <ep-001> <镜号> <视频资产 key> <版本> --confirmed | audit-episode <项目> <ep-001> [--confirmed]')
  const report = await auditVersion(resolve(rootArg), { episodeKey, shotNumber: Number(shotRaw), assetKey, versionId })
  console.log(JSON.stringify(report, null, 2))
  if (!report.approved) process.exitCode = 1
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((error) => { console.error(error.message); process.exitCode = 1 })
