import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { basename, dirname, resolve } from 'node:path'
import { renderMarketReportMarkdown } from './report.mjs'

const ID_PATTERN = /^[A-Za-z0-9+_-]{1,80}$/

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function assertId(value, field = 'ID') {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) throw new Error(`${field} 无效`)
  return value
}

function reportTimestamp(report) {
  const timestamp = Date.parse(report?.generated_at)
  return Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY
}

function jsonSnapshot(value, label) {
  let serialized
  try {
    serialized = JSON.stringify(value)
  } catch {
    throw new Error(`${label} 必须是可序列化的 JSON 数据`)
  }
  if (serialized === undefined) throw new Error(`${label} 必须是可序列化的 JSON 数据`)
  return JSON.parse(serialized)
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT' || error instanceof SyntaxError) return null
    throw error
  }
}

async function writeJsonAtomically(path, value) {
  await mkdir(dirname(path), { recursive: true })
  const temporary = resolve(dirname(path), `.${basename(path)}.tmp-${process.pid}-${randomUUID()}`)
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  await rename(temporary, path)
}

async function writeTextAtomically(path, value) {
  await mkdir(dirname(path), { recursive: true })
  const temporary = resolve(dirname(path), `.${basename(path)}.tmp-${process.pid}-${randomUUID()}`)
  await writeFile(temporary, value, 'utf8')
  await rename(temporary, path)
}

function normalizeSnapshot(snapshot) {
  if (!isRecord(snapshot)) throw new Error('快照必须是对象')
  assertId(snapshot.snapshot_id, 'snapshot ID')
  if (!isRecord(snapshot.rankings)) throw new Error('快照 rankings 必须是对象')
  return snapshot
}

function normalizeReport(report) {
  if (!isRecord(report)) throw new Error('报告必须是对象')
  assertId(report.report_id, 'report ID')
  if (!Array.isArray(report.snapshot_ids) || report.snapshot_ids.length === 0) throw new Error('报告 snapshot_ids 必须是非空数组')
  for (const snapshotId of report.snapshot_ids) assertId(snapshotId, 'snapshot ID')
  return report
}

export function createMarketStore(workspaceRoot) {
  const root = resolve(workspaceRoot)
  const marketRoot = resolve(root, '.short-drama-market')
  const indexPath = resolve(marketRoot, 'index.json')
  const snapshotPath = (snapshotId) => resolve(marketRoot, 'snapshots', `${assertId(snapshotId, 'snapshot ID')}.json`)
  const reportPath = (reportId, extension = 'json') => resolve(marketRoot, 'reports', `${assertId(reportId, 'report ID')}.${extension}`)

  async function readIndex() {
    const index = await readJson(indexPath)
    return isRecord(index) ? index : null
  }

  async function saveIndex(index) {
    await writeJsonAtomically(indexPath, { schema_version: 1, ...index })
  }

  async function readSnapshot(snapshotId) {
    assertId(snapshotId, 'snapshot ID')
    return readJson(snapshotPath(snapshotId))
  }

  async function readReport(reportId) {
    assertId(reportId, 'report ID')
    return readJson(reportPath(reportId))
  }

  async function saveSnapshot(snapshot) {
    const source = normalizeSnapshot(snapshot)
    // rankings 的键代表实际成功返回的榜单；完全失败时不留下会被误当成可分析样本的快照。
    if (Object.keys(source.rankings).length === 0) return null
    await writeJsonAtomically(snapshotPath(source.snapshot_id), source)
    const current = await readIndex()
    await saveIndex({ ...(current ?? {}), latest_snapshot_id: source.snapshot_id })
    return source
  }

  async function listHistory() {
    const reportsDirectory = resolve(marketRoot, 'reports')
    let entries
    try {
      entries = await readdir(reportsDirectory, { withFileTypes: true })
    } catch (error) {
      if (error?.code === 'ENOENT') return []
      throw error
    }
    const reports = await Promise.all(entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json') && ID_PATTERN.test(entry.name.slice(0, -'.json'.length)))
      .map(async (entry) => readJson(resolve(reportsDirectory, entry.name))))
    return reports
      .filter((report) => isRecord(report) && typeof report.report_id === 'string' && ID_PATTERN.test(report.report_id))
      .sort((left, right) => reportTimestamp(right) - reportTimestamp(left) || String(right.report_id).localeCompare(String(left.report_id), 'en'))
  }

  async function saveReport(report) {
    // 报告写入跨越多个 await；先按 JSON 合同切断调用方引用，确保 JSON 与 Markdown 基于同一时点的数据。
    const source = normalizeReport(jsonSnapshot(report, '报告'))
    const markdown = renderMarketReportMarkdown(source)
    // 先落 Markdown、再暴露 JSON；历史读取只以 JSON 为准，避免写入中断时读到缺少配套 Markdown 的报告。
    await writeTextAtomically(reportPath(source.report_id, 'md'), markdown)
    await writeJsonAtomically(reportPath(source.report_id), source)
    const current = await readIndex()
    const currentReport = current?.latest_report_id ? await readReport(current.latest_report_id).catch(() => null) : null
    if (!currentReport || reportTimestamp(source) >= reportTimestamp(currentReport)) {
      await saveIndex({ ...(current ?? {}), latest_report_id: source.report_id })
    }
    return source
  }

  async function latestSnapshotFromDisk() {
    const directory = resolve(marketRoot, 'snapshots')
    let entries
    try {
      entries = await readdir(directory, { withFileTypes: true })
    } catch (error) {
      if (error?.code === 'ENOENT') return null
      throw error
    }
    const ids = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map((entry) => entry.name.slice(0, -'.json'.length))
      .filter((id) => ID_PATTERN.test(id))
      .sort((left, right) => right.localeCompare(left, 'en'))
    return ids.length > 0 ? readSnapshot(ids[0]) : null
  }

  async function readLatest() {
    const index = await readIndex()
    const indexedSnapshot = typeof index?.latest_snapshot_id === 'string'
      ? await readSnapshot(index.latest_snapshot_id).catch(() => null)
      : null
    const indexedReport = typeof index?.latest_report_id === 'string'
      ? await readReport(index.latest_report_id).catch(() => null)
      : null
    const history = indexedReport ? null : await listHistory()
    return {
      latestSnapshot: indexedSnapshot ?? await latestSnapshotFromDisk(),
      latestReport: indexedReport ?? history?.[0] ?? null,
    }
  }

  return { saveSnapshot, saveReport, readSnapshot, readReport, readLatest, listHistory }
}
