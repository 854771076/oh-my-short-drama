import { lstat, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { basename, dirname, resolve } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { renderMarketReportMarkdown } from './report.mjs'

const ID_PATTERN = /^[A-Za-z0-9+_-]{1,80}$/
const REPORT_SCHEMA_VERSIONS = new Set(['market-report.v1', 'market-report.v2'])
const coordinators = new Map()

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function assertId(value, field = 'ID') {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) throw new Error(`${field} 无效`)
  return value
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

function isSnapshot(value, expectedId = null) {
  if (!isRecord(value) || value.schema_version !== 1 || !isRecord(value.rankings)) return false
  try {
    assertId(value.snapshot_id, 'snapshot ID')
  } catch {
    return false
  }
  return expectedId === null || value.snapshot_id === expectedId
}

function isReport(value, expectedId = null) {
  if (!isRecord(value) || !REPORT_SCHEMA_VERSIONS.has(value.schema_version) || !Array.isArray(value.snapshot_ids) || value.snapshot_ids.length === 0) return false
  try {
    assertId(value.report_id, 'report ID')
    for (const snapshotId of value.snapshot_ids) assertId(snapshotId, 'snapshot ID')
  } catch {
    return false
  }
  return expectedId === null || value.report_id === expectedId
}

function normalizeSnapshot(snapshot) {
  if (!isSnapshot(snapshot)) throw new Error('快照合同无效')
  return snapshot
}

function normalizeReport(report) {
  if (!isReport(report)) throw new Error('报告合同无效')
  return report
}

function canonicalRoot(workspaceRoot) {
  const resolved = resolve(workspaceRoot)
  try {
    return realpathSync(resolved)
  } catch {
    return resolved
  }
}

function coordinatorFor(root) {
  if (!coordinators.has(root)) coordinators.set(root, { tail: Promise.resolve() })
  return coordinators.get(root)
}

function enqueue(coordinator, task) {
  // 同一工作区按调用顺序串行完成整个写入事务，避免报告双文件或索引 read-modify-write 在 await 间交错。
  const result = coordinator.tail.then(task, task)
  coordinator.tail = result.catch(() => undefined)
  return result
}

function timestamp(value, field) {
  const parsed = Date.parse(value?.[field])
  return Number.isFinite(parsed) ? parsed : null
}

function newest(values, idField, timeField) {
  return [...values].sort((left, right) => {
    const leftTime = timestamp(left, timeField)
    const rightTime = timestamp(right, timeField)
    if (leftTime !== null && rightTime !== null && leftTime !== rightTime) return rightTime - leftTime
    if (leftTime !== null && rightTime === null) return -1
    if (leftTime === null && rightTime !== null) return 1
    return String(right[idField]).localeCompare(String(left[idField]), 'en')
  })[0] ?? null
}

async function lstatOrNull(path) {
  try {
    return await lstat(path)
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

async function safePath(path, label) {
  const status = await lstatOrNull(path)
  if (status?.isSymbolicLink()) throw new Error(`${label} 禁止使用符号链接`)
  return status
}

async function ensureDirectory(path, label, create) {
  let status = await safePath(path, label)
  if (!status) {
    if (!create) return false
    await mkdir(path, { recursive: true })
    status = await safePath(path, label)
  }
  if (!status?.isDirectory()) throw new Error(`${label} 必须是目录`)
  return true
}

async function readJsonFile(path, label) {
  const status = await safePath(path, label)
  if (!status) return null
  if (!status.isFile()) throw new Error(`${label} 必须是文件`)
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch (error) {
    if (error instanceof SyntaxError) return null
    throw error
  }
}

async function readTextFile(path, label) {
  const status = await safePath(path, label)
  if (!status) return null
  if (!status.isFile()) throw new Error(`${label} 必须是文件`)
  return readFile(path, 'utf8')
}

async function writeAtomically(path, value, label, renameFile = rename) {
  const target = await safePath(path, label)
  if (target && !target.isFile()) throw new Error(`${label} 必须是文件`)
  const temporary = resolve(dirname(path), `.${basename(path)}.tmp-${process.pid}-${randomUUID()}`)
  try {
    await writeFile(temporary, value, 'utf8')
    await renameFile(temporary, path)
  } finally {
    // rename 失败时主动回收同目录临时文件，避免恢复扫描把残留写入误判为业务数据。
    await rm(temporary, { force: true }).catch(() => undefined)
  }
}

function reportStorageError(code, message) {
  const error = new Error(`${code}: ${message}`)
  error.code = code
  return error
}

export function createMarketStore(workspaceRoot, { renameFile = rename } = {}) {
  const root = canonicalRoot(workspaceRoot)
  const coordinator = coordinatorFor(root)
  const marketRoot = resolve(root, '.short-drama-market')
  const indexPath = resolve(marketRoot, 'index.json')
  const snapshotPath = (snapshotId) => resolve(marketRoot, 'snapshots', `${assertId(snapshotId, 'snapshot ID')}.json`)
  const reportPath = (reportId, extension = 'json') => resolve(marketRoot, 'reports', `${assertId(reportId, 'report ID')}.${extension}`)

  async function ensureMarketRoot(create) {
    return ensureDirectory(marketRoot, '市场存储目录', create)
  }

  async function ensureDataDirectory(name, create) {
    if (!await ensureMarketRoot(create)) return false
    return ensureDirectory(resolve(marketRoot, name), `${name} 目录`, create)
  }

  async function readIndex() {
    if (!await ensureMarketRoot(false)) return null
    const index = await readJsonFile(indexPath, '市场索引文件')
    return isRecord(index) ? index : null
  }

  async function readSnapshot(snapshotId) {
    assertId(snapshotId, 'snapshot ID')
    if (!await ensureDataDirectory('snapshots', false)) return null
    const snapshot = await readJsonFile(snapshotPath(snapshotId), '快照文件')
    return isSnapshot(snapshot, snapshotId) ? snapshot : null
  }

  async function readReport(reportId) {
    assertId(reportId, 'report ID')
    if (!await ensureDataDirectory('reports', false)) return null
    const report = await readJsonFile(reportPath(reportId), '报告文件')
    return isReport(report, reportId) ? report : null
  }

  async function readReportMarkdown(reportId) {
    assertId(reportId, 'report ID')
    if (!await ensureDataDirectory('reports', false)) return null
    return readTextFile(reportPath(reportId, 'md'), '报告 Markdown 文件')
  }

  async function collectSnapshots() {
    const directory = resolve(marketRoot, 'snapshots')
    if (!await ensureDataDirectory('snapshots', false)) return []
    const entries = await readdir(directory, { withFileTypes: true })
    const snapshots = []
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue
      const snapshotId = entry.name.slice(0, -'.json'.length)
      if (!ID_PATTERN.test(snapshotId)) continue
      try {
        const snapshot = await readJsonFile(resolve(directory, entry.name), '快照文件')
        if (isSnapshot(snapshot, snapshotId)) snapshots.push(snapshot)
      } catch (error) {
        // 扫描恢复只跳过单个异常候选；显式 readSnapshot 仍会将符号链接作为边界错误返回给调用方。
        if (!/符号链接/u.test(error.message)) throw error
      }
    }
    return snapshots
  }

  async function collectReports() {
    const directory = resolve(marketRoot, 'reports')
    if (!await ensureDataDirectory('reports', false)) return []
    const entries = await readdir(directory, { withFileTypes: true })
    const reports = []
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue
      const reportId = entry.name.slice(0, -'.json'.length)
      if (!ID_PATTERN.test(reportId)) continue
      try {
        const report = await readJsonFile(resolve(directory, entry.name), '报告文件')
        if (isReport(report, reportId)) reports.push(report)
      } catch (error) {
        if (!/符号链接/u.test(error.message)) throw error
      }
    }
    return reports
  }

  async function rebuildIndex() {
    const [snapshots, reports] = await Promise.all([collectSnapshots(), collectReports()])
    const latestSnapshot = newest(snapshots, 'snapshot_id', 'retrieved_at')
    const latestReport = newest(reports, 'report_id', 'generated_at')
    const index = { schema_version: 1 }
    if (latestSnapshot) index.latest_snapshot_id = latestSnapshot.snapshot_id
    if (latestReport) index.latest_report_id = latestReport.report_id
    return index
  }

  async function refreshIndex() {
    const [stored, rebuilt] = await Promise.all([readIndex(), rebuildIndex()])
    // 索引缺失或损坏时完全以磁盘有效历史恢复；有效索引的扩展字段则保留，但最新指针始终由完整历史重算。
    const next = { ...(stored ?? {}), ...rebuilt, schema_version: 1 }
    if (!rebuilt.latest_snapshot_id) delete next.latest_snapshot_id
    if (!rebuilt.latest_report_id) delete next.latest_report_id
    await ensureMarketRoot(true)
    await writeAtomically(indexPath, `${JSON.stringify(next, null, 2)}\n`, '市场索引文件')
  }

  async function existingReportState(source) {
    const jsonPath = reportPath(source.report_id)
    const markdownPath = reportPath(source.report_id, 'md')
    const [jsonStatus, markdownStatus] = await Promise.all([
      safePath(jsonPath, '报告文件'),
      safePath(markdownPath, '报告 Markdown 文件'),
    ])
    if (jsonStatus && !jsonStatus.isFile()) throw reportStorageError('MARKET_REPORT_CORRUPT', `报告 ${source.report_id} 的 JSON 产物不是文件，请修复后重试`)
    if (markdownStatus && !markdownStatus.isFile()) throw reportStorageError('MARKET_REPORT_CORRUPT', `报告 ${source.report_id} 的 Markdown 产物不是文件，请修复后重试`)
    if (!jsonStatus && !markdownStatus) return 'absent'
    if (!jsonStatus || !markdownStatus) throw reportStorageError('MARKET_REPORT_CORRUPT', `报告 ${source.report_id} 仅存在单边产物，请修复或移除不完整产物后重试`)
    const [stored, markdown] = await Promise.all([
      readJsonFile(jsonPath, '报告文件'),
      readTextFile(markdownPath, '报告 Markdown 文件'),
    ])
    if (!isReport(stored, source.report_id)) throw reportStorageError('MARKET_REPORT_CORRUPT', `报告 ${source.report_id} 的 JSON 合同无效，请修复后重试`)
    if (!isDeepStrictEqual(stored, source)) throw reportStorageError('MARKET_REPORT_CONFLICT', `报告 ${source.report_id} 已绑定不同内容，不能覆盖`)
    if (markdown !== renderMarketReportMarkdown(stored)) throw reportStorageError('MARKET_REPORT_CORRUPT', `报告 ${source.report_id} 的 JSON 与 Markdown 不一致，请修复后重试`)
    return 'idempotent'
  }

  function saveSnapshot(snapshot) {
    const source = normalizeSnapshot(jsonSnapshot(snapshot, '快照'))
    return enqueue(coordinator, async () => {
      // rankings 的键代表实际成功返回的榜单；完全失败时不留下会被误当成可分析样本的快照。
      if (Object.keys(source.rankings).length === 0) return null
      await ensureDataDirectory('snapshots', true)
      const path = snapshotPath(source.snapshot_id)
      const status = await safePath(path, '快照文件')
      if (status) {
        if (!status.isFile()) throw reportStorageError('MARKET_SNAPSHOT_CORRUPT', `快照 ${source.snapshot_id} 不是文件`)
        const stored = await readJsonFile(path, '快照文件')
        if (!isSnapshot(stored, source.snapshot_id)) throw reportStorageError('MARKET_SNAPSHOT_CORRUPT', `快照 ${source.snapshot_id} 合同无效`)
        if (!isDeepStrictEqual(stored, source)) throw reportStorageError('MARKET_SNAPSHOT_CONFLICT', `快照 ${source.snapshot_id} 已绑定不同内容，不能覆盖`)
        return source
      }
      await writeAtomically(path, `${JSON.stringify(source, null, 2)}\n`, '快照文件')
      await refreshIndex()
      return source
    })
  }

  function saveReport(report) {
    const source = normalizeReport(jsonSnapshot(report, '报告'))
    return enqueue(coordinator, async () => {
      await ensureDataDirectory('reports', true)
      const state = await existingReportState(source)
      if (state === 'idempotent') return source
      const markdown = renderMarketReportMarkdown(source)
      // 同一队列内先落 Markdown、再暴露 JSON，随后更新索引；同 report_id 的调用以调用顺序完成，最终产物同源。
      await writeAtomically(reportPath(source.report_id, 'md'), markdown, '报告 Markdown 文件', renameFile)
      await writeAtomically(reportPath(source.report_id), `${JSON.stringify(source, null, 2)}\n`, '报告文件', renameFile)
      await refreshIndex()
      return source
    })
  }

  async function listHistory() {
    return (await collectReports()).sort((left, right) => {
      const selected = newest([left, right], 'report_id', 'generated_at')
      return selected === left ? -1 : selected === right ? 1 : 0
    })
  }

  async function readLatest() {
    // 先检查索引路径边界；恢复结果只使用逐个验证后的磁盘候选，不信任损坏或陈旧索引的指针。
    await readIndex()
    const [snapshots, reports] = await Promise.all([collectSnapshots(), collectReports()])
    return {
      latestSnapshot: newest(snapshots, 'snapshot_id', 'retrieved_at'),
      latestReport: newest(reports, 'report_id', 'generated_at'),
    }
  }

  return { saveSnapshot, saveReport, readSnapshot, readReport, readReportMarkdown, readLatest, listHistory }
}
