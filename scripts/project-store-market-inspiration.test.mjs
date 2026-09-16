import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const scripts = dirname(fileURLToPath(import.meta.url))
const storeScript = resolve(scripts, 'project-store.mjs')

function run(...args) {
  return spawnSync(process.execPath, [storeScript, ...args], { encoding: 'utf8' })
}

async function writeJson(root, name, value) {
  const path = resolve(root, name)
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`)
  return path
}

function inspiration() {
  const reportRef = {
    report_id: 'market-report-20260916',
    snapshot_ids: ['20260916T153000+0800'],
    generated_at: '2026-09-16T15:30:00.000+08:00',
    filters: { topic: ['悬疑推理'], rankingTypes: ['hot'] },
    sha256: 'a'.repeat(64),
    selected_hypothesis_ids: ['hyp-suspense-hook'],
  }
  return {
    schema_version: 'market-inspiration.v1',
    report_ref: reportRef,
    signals: [{
      id: 'signal-suspense-demand',
      fact: '悬疑推理题材在已选公开榜单样本中存在可追溯指标。',
      confidence: 'medium',
      evidence: [{ snapshot_id: '20260916T153000+0800', ranking_type: 'hot', playlet_id: 'sample-1', key: 'playlet-id:sample-1' }],
      limitations: ['仅覆盖公开 Top 30 样本。'],
    }],
    hypotheses: [{
      id: 'hyp-suspense-hook',
      derived_signal_ids: ['signal-suspense-demand'],
      inference: '可测试高密度线索回收的连续叙事。',
      creative_transformation: '以原创社区档案室为场景，围绕匿名录音展开。',
      premises: ['用户确认允许悬疑基调。'],
      opening_hook: '一段未来日期的求救录音在直播中播放。',
      serial_engine: '每集解锁一个可验证线索，并让主角承担新的代价。',
      differentiation: '用声音证据链替代模仿任何榜单作品的人物或情节。',
      production_fit: '固定室内场景与少量角色，适合竖屏短剧制作。',
      risks: ['样本置信度中等，需先做受众验证。'],
      validation_questions: ['目标受众是否认可声音线索作为主叙事驱动？'],
    }],
    decision: {
      selected_hypothesis_ids: ['hyp-suspense-hook'],
      rejected_hypothesis_ids: [],
      confirmed_at: null,
    },
    guardrails: {
      no_title_copy: true,
      no_plot_copy: true,
      no_revenue_promise: true,
      market_data_non_authoritative: true,
    },
  }
}

test('market-inspiration.v1 可验证、保存并回读，且 Brief 保留完整可空市场引用', async (t) => {
  const root = await mkdtemp(resolve(tmpdir(), 'project-market-inspiration-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  assert.equal(run('init', root).status, 0)

  const document = inspiration()
  const documentPath = await writeJson(root, 'market-inspiration.json', document)
  const saved = run('put-document', root, 'market-inspiration', documentPath)
  assert.equal(saved.status, 0, saved.stderr)
  assert.deepEqual(JSON.parse(await readFile(resolve(root, '.short-drama/market-inspiration.json'), 'utf8')), document)

  const brief = {
    title: '测试', logline: '', adaptation_mode: 'original', genre: '', audience: '', platform: '', tone: '', core_conflict: '', output_language: 'zh-CN', spoken_language: 'zh-CN', subtitle_language: 'zh-CN', aspect_ratio: '9:16', episode_count: 1, episode_duration_seconds: 30, rating: '', existing_materials: [], required_deliverables: [], prohibited_content: [], ending_type: '', creative_constraints: [], market_inspiration_ref: document.report_ref, open_questions: [], approved: true,
  }
  const briefPath = await writeJson(root, 'brief.json', brief)
  assert.equal(run('put-document', root, 'brief', briefPath).status, 0)
  assert.deepEqual(JSON.parse(await readFile(resolve(root, '.short-drama/brief.json'), 'utf8')).market_inspiration_ref, document.report_ref)

  const withoutMarket = { ...brief, market_inspiration_ref: null }
  const withoutMarketPath = await writeJson(root, 'brief-without-market.json', withoutMarket)
  assert.equal(run('put-document', root, 'brief', withoutMarketPath).status, 0)
  assert.equal(JSON.parse(await readFile(resolve(root, '.short-drama/brief.json'), 'utf8')).market_inspiration_ref, null)
})

test('market-inspiration.v1 和 Brief 拒绝未知字段', async (t) => {
  const root = await mkdtemp(resolve(tmpdir(), 'project-market-inspiration-invalid-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  assert.equal(run('init', root).status, 0)

  const invalidInspirationPath = await writeJson(root, 'invalid-market-inspiration.json', { ...inspiration(), injected: true })
  const invalidInspiration = run('put-document', root, 'market-inspiration', invalidInspirationPath)
  assert.notEqual(invalidInspiration.status, 0)
  assert.match(invalidInspiration.stderr, /market-inspiration 顶层字段必须且只能是/)

  const invalidBriefPath = await writeJson(root, 'invalid-brief.json', {
    title: '测试', logline: '', adaptation_mode: 'original', genre: '', audience: '', platform: '', tone: '', core_conflict: '', output_language: 'zh-CN', spoken_language: 'zh-CN', subtitle_language: 'zh-CN', aspect_ratio: '9:16', episode_count: 1, episode_duration_seconds: 30, rating: '', existing_materials: [], required_deliverables: [], prohibited_content: [], ending_type: '', creative_constraints: [], market_inspiration_ref: null, open_questions: [], approved: true, injected: true,
  })
  const invalidBrief = run('put-document', root, 'brief', invalidBriefPath)
  assert.notEqual(invalidBrief.status, 0)
  assert.match(invalidBrief.stderr, /brief 顶层字段必须且只能是/)
})
