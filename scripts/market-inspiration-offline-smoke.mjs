#!/usr/bin/env node
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import { analyzeMarket } from './market/analyze.mjs'
import { createMarketStore } from './market/store.mjs'
import { createStudioServer } from './studio.mjs'

const execute = promisify(execFile)
const projectStore = resolve(import.meta.dirname, 'project-store.mjs')

async function runProjectStore(...args) {
  await execute(process.execPath, [projectStore, ...args], {
    env: { ...process.env, SHORT_DRAMA_STUDIO_ACTIVE: '1' },
  })
}

function briefFixture() {
  return {
    title: '离线灵感冒烟项目', logline: '', adaptation_mode: 'original', genre: '原有题材', audience: '', platform: '原有平台', tone: '', core_conflict: '', output_language: 'zh-CN', spoken_language: 'zh-CN', subtitle_language: 'zh-CN', aspect_ratio: '9:16', episode_count: 1, episode_duration_seconds: 30, rating: '', existing_materials: [], required_deliverables: [], prohibited_content: [], ending_type: '', creative_constraints: [], market_inspiration_ref: null, open_questions: [], approved: true,
  }
}

function reportFixture() {
  return analyzeMarket({
    items: [
      { key: 'offline-suspense-1', playletId: 'offline-suspense-1', title: '离线样本甲', topics: ['悬疑推理'], rankingType: 'hot', ranking: 1, heatValue: 100, audience: '女频', format: '真人', snapshotId: 'offline-snapshot', provenance: { topicSource: 'source-tag' } },
      { key: 'offline-suspense-2', playletId: 'offline-suspense-2', title: '离线样本乙', topics: ['悬疑推理'], rankingType: 'douyin', ranking: 2, heatValue: 80, audience: '女频', format: '真人', snapshotId: 'offline-snapshot', provenance: { topicSource: 'source-tag' } },
    ],
    successfulRankingTypes: ['hot', 'douyin'],
    snapshotIds: ['offline-snapshot'],
  })
}

async function main() {
  const workspace = await mkdtemp(resolve(tmpdir(), 'short-drama-market-offline-smoke-'))
  let server
  try {
    const store = createMarketStore(workspace)
    const report = reportFixture()
    await store.saveReport(report)

    const projectRoot = resolve(workspace, 'offline-smoke-project')
    await runProjectStore('init', projectRoot)
    const briefPath = resolve(workspace, 'brief.json')
    const originalBrief = briefFixture()
    await writeFile(briefPath, `${JSON.stringify(originalBrief)}\n`)
    await runProjectStore('put-document', projectRoot, 'brief', briefPath)
    const originalProject = JSON.parse(await readFile(resolve(projectRoot, '.short-drama/project.json'), 'utf8'))

    let refreshCalls = 0
    server = createStudioServer({
      workspaceRoot: workspace,
      marketService: {
        report: (id) => store.readReport(id),
        refresh: async () => { refreshCalls += 1; throw new Error('离线 smoke 禁止刷新') },
      },
    })
    await new Promise((done) => server.listen(0, '127.0.0.1', done))
    const base = `http://127.0.0.1:${server.address().port}`
    const workspacePayload = await fetch(`${base}/api/v1/workspace`).then((response) => response.json())
    const headers = { 'content-type': 'application/json', 'x-short-drama-csrf': workspacePayload.csrfToken }
    const generatedResponse = await fetch(`${base}/api/v1/market/inspirations/generate`, {
      method: 'POST', headers, body: JSON.stringify({ reportId: report.report_id, topics: ['悬疑推理'] }),
    })
    const generated = await generatedResponse.json()
    if (!generatedResponse.ok) throw new Error(generated.error || '离线候选生成失败')
    const registeredResponse = await fetch(`${base}/api/v1/market/inspirations/register`, {
      method: 'POST', headers, body: JSON.stringify({ projectKey: 'offline-smoke-project', candidateId: generated.candidates[0].id }),
    })
    const registered = await registeredResponse.json()
    if (!registeredResponse.ok) throw new Error(registered.error || '离线灵感登记失败')

    const [savedBrief, savedProject] = await Promise.all([
      readFile(resolve(projectRoot, '.short-drama/brief.json'), 'utf8').then(JSON.parse),
      readFile(resolve(projectRoot, '.short-drama/project.json'), 'utf8').then(JSON.parse),
    ])
    return {
      ok: true,
      report_schema: report.schema_version,
      inspiration_schema: registered.marketInspiration.schema_version,
      brief_reference_saved: savedBrief.market_inspiration_ref?.report_id === report.report_id,
      project_genre_unchanged: savedProject.creative.genre === originalProject.creative.genre,
      brief_platform_unchanged: savedBrief.platform === originalBrief.platform,
      refresh_calls: refreshCalls,
    }
  } finally {
    if (server?.listening) await new Promise((done) => server.close(done))
    await rm(workspace, { recursive: true, force: true })
  }
}

process.stdout.write(`${JSON.stringify(await main())}\n`)
