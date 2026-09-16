import test from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import { createMarketStore } from './market/store.mjs'
import { runMarketResearch } from './market-research.mjs'

const execute = promisify(execFile)
const cli = resolve('scripts/market-research.mjs')

async function workspace() {
  return mkdtemp(resolve(tmpdir(), 'market-research-cli-'))
}

async function invoke(...args) {
  return execute(process.execPath, [cli, ...args])
}

function schemaAt(root, reference) {
  if (!reference?.startsWith('#/')) throw new Error(`测试验证器不支持外部引用：${reference}`)
  return reference.slice(2).split('/').reduce((value, key) => value[key], root)
}

function matchesType(value, type) {
  if (type === 'null') return value === null
  if (type === 'array') return Array.isArray(value)
  if (type === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value)
  if (type === 'integer') return Number.isInteger(value)
  return typeof value === type
}

function validateSchema(root, schema, value, path = '$') {
  const source = schema.$ref ? schemaAt(root, schema.$ref) : schema
  if (source.oneOf) {
    if (source.oneOf.some((entry) => validateSchema(root, entry, value, path).length === 0)) return []
    return [`${path} 不匹配任何 oneOf 分支`]
  }
  if (source.const !== undefined && value !== source.const) return [`${path} 必须等于 ${JSON.stringify(source.const)}`]
  if (source.enum && !source.enum.includes(value)) return [`${path} 不在枚举中`]
  const types = source.type === undefined ? [] : (Array.isArray(source.type) ? source.type : [source.type])
  if (types.length > 0 && !types.some((type) => matchesType(value, type))) return [`${path} 类型无效`]
  const errors = []
  if (Array.isArray(value)) {
    if (source.minItems !== undefined && value.length < source.minItems) errors.push(`${path} 项数不足`)
    if (source.items) value.forEach((entry, index) => errors.push(...validateSchema(root, source.items, entry, `${path}[${index}]`)))
  }
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const key of source.required ?? []) if (!Object.hasOwn(value, key)) errors.push(`${path}.${key} 缺失`)
    if (source.additionalProperties === false) {
      for (const key of Object.keys(value)) if (!Object.hasOwn(source.properties ?? {}, key)) errors.push(`${path}.${key} 是不允许的嵌套字段`)
    }
    for (const [key, child] of Object.entries(source.properties ?? {})) if (Object.hasOwn(value, key)) errors.push(...validateSchema(root, child, value[key], `${path}.${key}`))
  }
  return errors
}

test('市场 CLI 自检输出稳定合同', async () => {
  const { stdout } = await invoke('--self-check')
  assert.deepEqual(JSON.parse(stdout), { status: 'ok', rankingTypes: 8, schemaVersion: 1 })
})

test('入口通过 URL 与真实路径判定，含空格中文和保留主模块符号链接时仍执行', async () => {
  const root = await mkdtemp(resolve(tmpdir(), '市场 CLI 空格 # '))
  const linkedCli = resolve(root, '市场 调研 #.mjs')
  await symlink(resolve('scripts/market'), resolve(root, 'market'))
  await symlink(cli, linkedCli)
  const { stdout } = await execute(process.execPath, ['--preserve-symlinks-main', linkedCli, '--self-check'])
  assert.deepEqual(JSON.parse(stdout), { status: 'ok', rankingTypes: 8, schemaVersion: 1 })
})

test('analyze 只读取已有快照并生成可回读报告，report 和 list 输出摘要 JSON', async () => {
  const root = await workspace()
  const store = createMarketStore(root)
  await store.saveSnapshot({
    schema_version: 1,
    snapshot_id: '20260916T153000+0800',
    retrieved_at: '2026-09-16T15:30:00.000+08:00',
    source: { provider: 'dataeye-juchacha', coverage: 'public-top-30' },
    rankings: {
      hot: { content: [{ playletId: 'one', playletName: '都市悬疑新剧', rank: 1, playletTags: ['悬疑探案'], newFlag: 1 }] },
    },
    failures: [],
  })

  const analyzed = JSON.parse((await invoke('analyze', root)).stdout)
  assert.equal(analyzed.snapshot_id, '20260916T153000+0800')
  assert.match(analyzed.report_id, /^market-report-/)
  assert.match(analyzed.json_path, /\.short-drama-market\/reports\/market-report-.*\.json$/)
  assert.match(analyzed.markdown_path, /\.short-drama-market\/reports\/market-report-.*\.md$/)

  const reported = JSON.parse((await invoke('report', root, analyzed.report_id)).stdout)
  assert.deepEqual(reported, { report_id: analyzed.report_id, json_path: analyzed.json_path, markdown_path: analyzed.markdown_path })

  const listed = JSON.parse((await invoke('list', root)).stdout)
  assert.equal(listed.latest_snapshot_id, '20260916T153000+0800')
  assert.equal(listed.latest_report_id, analyzed.report_id)
  assert.equal(listed.reports[0].report_id, analyzed.report_id)
})

test('参数错误以退出码 2 返回', async () => {
  await assert.rejects(invoke('analyze'), (error) => error.code === 2)
  await assert.rejects(invoke('unknown', '/tmp'), (error) => error.code === 2)
  const root = await workspace()
  await assert.rejects(invoke('report', root, '../outside'), (error) => error.code === 2)
})

test('refresh 只编排采集、归一化、快照和报告，并保留部分失败榜单', async () => {
  const root = await workspace()
  const result = await runMarketResearch(['refresh', root], {
    now: () => new Date('2026-09-16T07:30:00.000Z'),
    createClient: () => ({
      fetchAllRankings: async () => ({
        rankings: { hot: { content: [{ playletId: 'one', playletName: '悬疑新剧', rank: 1, playletTags: ['悬疑探案'] }] } },
        failures: [{ type: 'douyin', code: 'JUCHACHA_TIMEOUT', endpoint: '/playlet/ranking', message: '超时' }],
      }),
    }),
  })
  assert.match(result.snapshot_id, /^m[0-9a-z]+-[a-f0-9]{64}$/)
  const saved = await createMarketStore(root).readSnapshot(result.snapshot_id)
  assert.deepEqual(saved.failures[0], { ranking_type: 'douyin', code: 'JUCHACHA_TIMEOUT', endpoint: '/playlet/ranking', message: '超时' })
  assert.equal((await createMarketStore(root).readReport(result.report_id)).coverage.sample_count, 1)
})

test('指定旧快照分析时只选择 retrieved_at 严格更早的最近快照，不依赖 ID 字典序', async () => {
  const root = await workspace()
  const store = createMarketStore(root)
  const snapshot = (snapshotId, retrievedAt, title) => ({
    schema_version: 1,
    snapshot_id: snapshotId,
    retrieved_at: retrievedAt,
    source: { provider: 'dataeye-juchacha', coverage: 'public-top-30' },
    rankings: { hot: { content: [{ playletId: snapshotId, playletName: title, rank: 1, playletTags: ['悬疑探案'] }] } },
    failures: [],
  })
  const older = snapshot('aaaa-earlier', '2026-09-14T15:30:00.000+08:00', '更早快照')
  const current = snapshot('middle-current', '2026-09-16T15:30:00.000+08:00', '当前快照')
  const future = snapshot('zzzz-future', '2026-09-17T15:30:00.000+08:00', '未来快照')
  await Promise.all([store.saveSnapshot(older), store.saveSnapshot(current), store.saveSnapshot(future)])
  await store.saveReport({ schema_version: 'market-report.v1', report_id: 'history-candidates', generated_at: '2026-09-18T00:00:00.000+08:00', snapshot_ids: [older.snapshot_id, future.snapshot_id] })

  const result = await runMarketResearch(['analyze', root, current.snapshot_id])
  const report = await store.readReport(result.report_id)
  assert.deepEqual(report.snapshot_ids, [older.snapshot_id, current.snapshot_id])
  assert.notEqual(report.summary.trend, null)
})

test('不存在严格更早的有效快照时趋势为空并保留趋势不可用限制', async () => {
  const root = await workspace()
  const store = createMarketStore(root)
  const snapshot = (snapshotId, retrievedAt) => ({
    schema_version: 1,
    snapshot_id: snapshotId,
    retrieved_at: retrievedAt,
    source: { provider: 'dataeye-juchacha', coverage: 'public-top-30' },
    rankings: { hot: { content: [{ playletId: snapshotId, playletName: snapshotId, rank: 1, playletTags: ['悬疑探案'] }] } },
    failures: [],
  })
  const current = snapshot('current-only-earlier', '2026-09-16T15:30:00.000+08:00')
  const future = snapshot('future-only', '2026-09-17T15:30:00.000+08:00')
  await Promise.all([store.saveSnapshot(current), store.saveSnapshot(future)])
  await store.saveReport({ schema_version: 'market-report.v1', report_id: 'future-only-history', generated_at: '2026-09-18T00:00:00.000+08:00', snapshot_ids: [future.snapshot_id] })

  const result = await runMarketResearch(['analyze', root, current.snapshot_id])
  const report = await store.readReport(result.report_id)
  assert.deepEqual(report.snapshot_ids, [current.snapshot_id])
  assert.equal(report.summary.trend, null)
  assert.ok(report.limitations.some((item) => item.includes('趋势不可用')))
})

test('同一毫秒 refresh 的不同内容生成不同快照并保持各自报告证据；相同内容稳定复用 ID', async () => {
  const root = await workspace()
  const now = () => new Date('2026-09-16T07:30:00.123Z')
  const fetchResult = (title) => ({ rankings: { hot: { content: [{ playletId: title, playletName: title, rank: 1, playletTags: ['悬疑探案'] }] } }, failures: [] })
  const first = await runMarketResearch(['refresh', root], { now, createClient: () => ({ fetchAllRankings: async () => fetchResult('甲') }) })
  const second = await runMarketResearch(['refresh', root], { now, createClient: () => ({ fetchAllRankings: async () => fetchResult('乙') }) })
  const repeated = await runMarketResearch(['refresh', root], { now, createClient: () => ({ fetchAllRankings: async () => fetchResult('乙') }) })
  assert.notEqual(first.snapshot_id, second.snapshot_id)
  assert.equal(second.snapshot_id, repeated.snapshot_id)
  const store = createMarketStore(root)
  assert.equal((await store.readSnapshot(first.snapshot_id)).rankings.hot.content[0].playletName, '甲')
  assert.equal((await store.readSnapshot(second.snapshot_id)).rankings.hot.content[0].playletName, '乙')
  for (const result of [first, second]) {
    const report = await store.readReport(result.report_id)
    assert.ok(report.evidence.every((entry) => entry.snapshot_id === result.snapshot_id))
  }
})

test('全部上游榜单失败以退出码 3 中止且不写入空快照', async () => {
  const root = await workspace()
  await assert.rejects(
    runMarketResearch(['refresh', root], { createClient: () => ({ fetchAllRankings: async () => ({ rankings: {}, failures: [] }) }) }),
    (error) => error.exitCode === 3,
  )
  assert.equal((await createMarketStore(root).readLatest()).latestSnapshot, null)
})

test('市场 Skill 固化触发边界、命令合同与报告输出顺序', async () => {
  const skill = await readFile(resolve('skills/analyze-drama-market/SKILL.md'), 'utf8')
  const schema = JSON.parse(await readFile(resolve('skills/analyze-drama-market/references/market-report.schema.json'), 'utf8'))

  assert.match(skill, /^---\nname: analyze-drama-market\ndescription: 分析近期短剧市场、剧查查公开排行榜、题材趋势、平台差异、竞争拥挤度、新剧势能和公司集中度，并生成带数据证据与置信度的市场调研报告；不用于分析单部小说\/剧本，不预测投资收益，不绕过付费或登录权限。\n---/)
  for (const command of ['refresh <workspace>', 'analyze <workspace> [snapshot-id]', 'report <workspace> [report-id]', 'list <workspace>', '--self-check']) assert.match(skill, new RegExp(command.replace(/[.[\]{}()*+?^$|\\]/gu, '\\$&')))
  for (const phrase of ['近期短剧题材趋势', '平台榜单', '市场机会', '竞争格局', '市场报告', '单部小说或剧本', '预测投资收益', '绕过付费或登录权限', '只有用户明确要求刷新时才联网', '公开 Top 30']) assert.match(skill, new RegExp(phrase))
  for (const heading of ['事实', '机会', '风险', '平台', '新剧', '创作启示', '限制']) assert.match(skill, new RegExp(`## ${heading}`))
  const headings = ['## 事实', '## 机会', '## 风险', '## 平台', '## 新剧', '## 创作启示', '## 限制'].map((heading) => skill.indexOf(heading))
  assert.ok(headings.every((index, position) => index >= 0 && (position === 0 || index > headings[position - 1])))

  assert.equal(schema.additionalProperties, false)
  assert.equal(schema.title, 'Short drama market report v2')
  assert.equal(schema.properties.schema_version.const, 'market-report.v2')
  assert.deepEqual(schema.required, ['schema_version', 'report_id', 'generated_at', 'snapshot_ids', 'coverage', 'filters', 'summary', 'topic_metrics', 'topic_cooccurrence', 'supply_demand_quadrants', 'platform_preferences', 'platform_matrix', 'company_concentration', 'new_title_watch', 'evidence', 'limitations'])
})

test('真实报告通过嵌套 Schema 合同，额外嵌套字段被递归拒绝', async () => {
  const root = await workspace()
  const store = createMarketStore(root)
  await store.saveSnapshot({
    schema_version: 1,
    snapshot_id: 'schema-positive',
    retrieved_at: '2026-09-16T15:30:00.000+08:00',
    source: { provider: 'dataeye-juchacha', coverage: 'public-top-30' },
    rankings: { hot: { content: [{ playletId: 'schema-work', playletName: '悬疑新剧', rank: 1, playletTags: ['悬疑探案'], newFlag: 1, relatedPartyCompany: ['制作方'] }] } },
    failures: [],
  })
  const result = await runMarketResearch(['analyze', root])
  const report = await store.readReport(result.report_id)
  const schema = JSON.parse(await readFile(resolve('skills/analyze-drama-market/references/market-report.schema.json'), 'utf8'))
  assert.deepEqual(validateSchema(schema, schema, report), [])
  const malformed = structuredClone(report)
  malformed.topic_metrics[0].confidence_detail.unknown = true
  assert.ok(validateSchema(schema, schema, malformed).some((error) => error.includes('confidence_detail.unknown 是不允许的嵌套字段')))
})
