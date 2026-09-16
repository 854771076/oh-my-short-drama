#!/usr/bin/env node
import { stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { analyzeMarket } from './market/analyze.mjs'
import { createJuchachaClient, rankingDefinitions } from './market/juchacha-client.mjs'
import { normalizeRankings } from './market/normalize.mjs'
import { createMarketStore } from './market/store.mjs'

const ALL_RANKING_TYPES = Object.freeze(Object.keys(rankingDefinitions))
const ID_PATTERN = /^[A-Za-z0-9+_-]{1,80}$/

class CliError extends Error {
  constructor(exitCode, message) {
    super(message)
    this.exitCode = exitCode
  }
}

function usage() {
  return '用法：market-research.mjs refresh <workspace> | analyze <workspace> [snapshot-id] | report <workspace> [report-id] | list <workspace> | --self-check'
}

function json(value) {
  return `${JSON.stringify(value)}\n`
}

async function workspacePath(value) {
  if (typeof value !== 'string' || !value) throw new CliError(2, usage())
  const root = resolve(value)
  try {
    if (!(await stat(root)).isDirectory()) throw new CliError(2, `工作区必须是目录：${value}`)
  } catch (error) {
    if (error instanceof CliError) throw error
    throw new CliError(2, `工作区不存在或不可访问：${value}`)
  }
  return root
}

function shanghaiParts(value) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(value)
  return Object.fromEntries(parts.filter(({ type }) => type !== 'literal').map(({ type, value: entry }) => [type, entry]))
}

function nowInShanghai(now = new Date()) {
  const parts = shanghaiParts(now)
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}.000+08:00`
}

function snapshotId(now = new Date()) {
  const parts = shanghaiParts(now)
  return `${parts.year}${parts.month}${parts.day}T${parts.hour}${parts.minute}${parts.second}+0800`
}

function failuresForSnapshot(failures) {
  return (Array.isArray(failures) ? failures : []).map((failure) => ({
    ranking_type: failure?.type ?? failure?.ranking_type ?? '',
    code: failure?.code ?? 'JUCHACHA_INVALID_RESPONSE',
    endpoint: failure?.endpoint ?? null,
    message: failure?.message ?? '剧查查榜单请求失败',
  }))
}

function reportPaths(root, reportId) {
  return {
    json_path: resolve(root, '.short-drama-market', 'reports', `${reportId}.json`),
    markdown_path: resolve(root, '.short-drama-market', 'reports', `${reportId}.md`),
  }
}

function successfulRankingTypes(snapshot) {
  return Object.keys(snapshot?.rankings ?? {}).filter((type) => ALL_RANKING_TYPES.includes(type))
}

function normalizedSnapshot(snapshot) {
  return normalizeRankings(snapshot?.rankings ?? {}, {
    snapshotId: snapshot?.snapshot_id ?? null,
    observedAt: snapshot?.retrieved_at ?? null,
  })
}

async function selectedSnapshot(store, selectedId) {
  const latest = await store.readLatest()
  const snapshot = selectedId ? await store.readSnapshot(selectedId) : latest.latestSnapshot
  if (!snapshot) throw new CliError(4, selectedId ? `未找到快照：${selectedId}` : '尚无可分析的市场快照，请先执行 refresh')
  return { snapshot, latestReport: latest.latestReport }
}

async function previousSnapshot(store, currentSnapshotId, latestReport) {
  // 存储层只暴露有效报告历史；从最近报告引用中回读快照，可避免扫描未校验的目录候选。
  const candidates = [
    ...(latestReport?.snapshot_ids ?? []),
    ...((await store.listHistory()).flatMap((report) => report.snapshot_ids ?? [])),
  ]
  for (const candidate of [...new Set(candidates)].sort().reverse()) {
    if (candidate === currentSnapshotId) continue
    const snapshot = await store.readSnapshot(candidate)
    if (snapshot) return snapshot
  }
  return null
}

async function analyzeSnapshot({ root, store, snapshot, latestReport }) {
  const previous = await previousSnapshot(store, snapshot.snapshot_id, latestReport)
  const report = analyzeMarket({
    items: normalizedSnapshot(snapshot),
    successfulRankingTypes: successfulRankingTypes(snapshot),
    snapshotIds: previous ? [snapshot.snapshot_id, previous.snapshot_id] : [snapshot.snapshot_id],
    previousItems: previous ? normalizedSnapshot(previous) : [],
    filters: previous ? { previousSuccessfulRankingTypes: successfulRankingTypes(previous) } : {},
  })
  try {
    await store.saveReport(report)
  } catch (error) {
    throw new CliError(4, `保存市场报告失败：${error.message}`)
  }
  return { report_id: report.report_id, ...reportPaths(root, report.report_id), snapshot_id: snapshot.snapshot_id }
}

async function refresh(root, dependencies) {
  const store = dependencies.createStore(root)
  let collected
  try {
    collected = await dependencies.createClient().fetchAllRankings()
  } catch (error) {
    throw new CliError(3, `采集剧查查榜单失败：${error.message}`)
  }
  const rankings = collected?.rankings ?? {}
  if (Object.keys(rankings).length === 0) throw new CliError(3, '剧查查所有公开榜单采集失败，未创建空快照')
  const collectedAt = dependencies.now()
  const retrievedAt = dependencies.nowInShanghai(collectedAt)
  const snapshot = {
    schema_version: 1,
    snapshot_id: dependencies.snapshotId(collectedAt),
    retrieved_at: retrievedAt,
    source: { provider: 'dataeye-juchacha', coverage: 'public-top-30' },
    rankings,
    failures: failuresForSnapshot(collected?.failures),
  }
  try {
    const saved = await store.saveSnapshot(snapshot)
    if (!saved) throw new Error('没有成功榜单可保存')
  } catch (error) {
    throw new CliError(4, `保存市场快照失败：${error.message}`)
  }
  const latest = await store.readLatest()
  return analyzeSnapshot({ root, store, snapshot, latestReport: latest.latestReport })
}

async function analyze(root, selectedId, dependencies) {
  const store = dependencies.createStore(root)
  let selected
  try {
    selected = await selectedSnapshot(store, selectedId)
  } catch (error) {
    if (error instanceof CliError) throw error
    throw new CliError(4, `读取市场快照失败：${error.message}`)
  }
  return analyzeSnapshot({ root, store, ...selected })
}

async function report(root, reportId, dependencies) {
  const store = dependencies.createStore(root)
  try {
    const latest = await store.readLatest()
    const id = reportId ?? latest.latestReport?.report_id
    if (!id) throw new CliError(4, '尚无市场报告，请先执行 analyze 或 refresh')
    const value = await store.readReport(id)
    if (!value) throw new CliError(4, `未找到报告：${id}`)
    return { report_id: value.report_id, ...reportPaths(root, value.report_id) }
  } catch (error) {
    if (error instanceof CliError) throw error
    throw new CliError(4, `读取市场报告失败：${error.message}`)
  }
}

async function list(root, dependencies) {
  const store = dependencies.createStore(root)
  try {
    const [latest, history] = await Promise.all([store.readLatest(), store.listHistory()])
    return {
      latest_snapshot_id: latest.latestSnapshot?.snapshot_id ?? null,
      latest_report_id: latest.latestReport?.report_id ?? null,
      reports: history.map((value) => ({
        report_id: value.report_id,
        generated_at: value.generated_at,
        snapshot_ids: value.snapshot_ids,
        sample_count: value.coverage?.sample_count ?? 0,
        successful_ranking_types: value.coverage?.successful_ranking_types ?? [],
      })),
    }
  } catch (error) {
    throw new CliError(4, `读取市场历史失败：${error.message}`)
  }
}

export async function runMarketResearch(argv, overrides = {}) {
  const dependencies = {
    createClient: () => createJuchachaClient(),
    createStore: (root) => createMarketStore(root),
    now: () => new Date(),
    nowInShanghai,
    snapshotId,
    ...overrides,
  }
  const args = Array.isArray(argv) ? argv : []
  if (args.length === 1 && args[0] === '--self-check') return { status: 'ok', rankingTypes: ALL_RANKING_TYPES.length, schemaVersion: 1 }
  const [command, workspace, optionalId, ...rest] = args
  if (!['refresh', 'analyze', 'report', 'list'].includes(command) || rest.length > 0 || !workspace || (command === 'refresh' && optionalId) || (command === 'list' && optionalId)) {
    throw new CliError(2, usage())
  }
  if (optionalId !== undefined && !ID_PATTERN.test(optionalId)) throw new CliError(2, `报告或快照 ID 无效：${optionalId}`)
  const root = await workspacePath(workspace)
  if (command === 'refresh') return refresh(root, dependencies)
  if (command === 'analyze') return analyze(root, optionalId, dependencies)
  if (command === 'report') return report(root, optionalId, dependencies)
  return list(root, dependencies)
}

async function main() {
  try {
    process.stdout.write(json(await runMarketResearch(process.argv.slice(2))))
  } catch (error) {
    const exitCode = error instanceof CliError ? error.exitCode : 4
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = exitCode
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main()
