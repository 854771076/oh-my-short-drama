import test from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp } from 'node:fs/promises'
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

test('市场 CLI 自检输出稳定合同', async () => {
  const { stdout } = await invoke('--self-check')
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
  assert.equal(result.snapshot_id, '20260916T153000+0800')
  const saved = await createMarketStore(root).readSnapshot(result.snapshot_id)
  assert.deepEqual(saved.failures[0], { ranking_type: 'douyin', code: 'JUCHACHA_TIMEOUT', endpoint: '/playlet/ranking', message: '超时' })
  assert.equal((await createMarketStore(root).readReport(result.report_id)).coverage.sample_count, 1)
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
  const { readFile } = await import('node:fs/promises')
  const skill = await readFile(resolve('skills/analyze-drama-market/SKILL.md'), 'utf8')
  const schema = JSON.parse(await readFile(resolve('skills/analyze-drama-market/references/market-report.schema.json'), 'utf8'))

  assert.match(skill, /^---\nname: analyze-drama-market\ndescription: 分析近期短剧市场、剧查查公开排行榜、题材趋势、平台差异、竞争拥挤度、新剧势能和公司集中度，并生成带数据证据与置信度的市场调研报告；不用于分析单部小说\/剧本，不预测投资收益，不绕过付费或登录权限。\n---/)
  for (const command of ['refresh <workspace>', 'analyze <workspace> [snapshot-id]', 'report <workspace> [report-id]', 'list <workspace>', '--self-check']) assert.match(skill, new RegExp(command.replace(/[.[\]{}()*+?^$|\\]/gu, '\\$&')))
  for (const phrase of ['近期短剧题材趋势', '平台榜单', '市场机会', '竞争格局', '市场报告', '单部小说或剧本', '预测投资收益', '绕过付费或登录权限', '只有用户明确要求刷新时才联网', '公开 Top 30']) assert.match(skill, new RegExp(phrase))
  for (const heading of ['事实', '机会', '风险', '平台', '新剧', '创作启示', '限制']) assert.match(skill, new RegExp(`## ${heading}`))
  const headings = ['## 事实', '## 机会', '## 风险', '## 平台', '## 新剧', '## 创作启示', '## 限制'].map((heading) => skill.indexOf(heading))
  assert.ok(headings.every((index, position) => index >= 0 && (position === 0 || index > headings[position - 1])))

  assert.equal(schema.additionalProperties, false)
  assert.deepEqual(schema.required, ['schema_version', 'report_id', 'generated_at', 'snapshot_ids', 'coverage', 'filters', 'summary', 'topic_metrics', 'platform_matrix', 'company_concentration', 'new_title_watch', 'evidence', 'limitations'])
})
