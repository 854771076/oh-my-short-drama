import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { importAssetFile, selectAssetVersion } from './asset-ledger.mjs'
import { validateCharacterAppealReview } from './character-appeal-review.mjs'
import { putCharacterAppealReview } from './review-ledger.mjs'

const dimension = (observation = '完整检查后与人物档案一致') => ({ status: 'passed', observation })
const adult = { name: '林晚', age_range: '28岁', role_level: 'S', audience_appeal: { age_class: 'adult', appeal_mode: 'adult-charisma', screen_presence: '清冷利落', grooming_and_makeup: '高马尾与干净眼妆', costume_signature: '墨黑风衣与银色领针', memory_anchors: ['高马尾', '银色领针'], prohibited_treatment: [] } }
const child = { name: '小满', age_range: '8岁', role_level: 'A', audience_appeal: { age_class: 'child', appeal_mode: 'child-cuteness', screen_presence: '灵动童真', grooming_and_makeup: '自然短发与干净面容', costume_signature: '明黄雨衣', memory_anchors: ['翘起的短发'], prohibited_treatment: ['成人妆容'] } }
const review = (ageClass = 'adult') => ({
  age_classification: { ...dimension(), observed_age_class: ageClass },
  identity: dimension(), grooming_costume: dimension(), memory_anchors: dimension(), audience_appeal: dimension(),
  protection_flags: [], watched_or_inspected_full: true, approved: true,
})

test('儿童保护失败不能由高美观分抵消', () => {
  assert.throws(() => validateCharacterAppealReview(child, { ...review('child'), beauty_score: 100, protection_flags: ['出现成人化妆容'] }), /儿童保护|保护性规则/)
})

test('成年角色缺少妆造或锚点观察不能批准', () => {
  const value = review()
  delete value.grooming_costume
  assert.throws(() => validateCharacterAppealReview(adult, value), /grooming_costume/)
  assert.throws(() => validateCharacterAppealReview(adult, { ...review(), memory_anchors: { status: 'failed', observation: '银色领针缺失' } }), /memory_anchors/)
})

test('新生成人物候选只能经人物专项审核选版', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'character-review-'))
  await mkdir(resolve(root, '.short-drama'), { recursive: true })
  await writeFile(resolve(root, '.short-drama/assets.json'), '{"version":1,"assets":{}}\n')
  await writeFile(resolve(root, '.short-drama/shot-reviews.json'), '{"version":1,"reviews":{}}\n')
  await mkdir(resolve(root, 'episodes/ep-001/asset-plan'), { recursive: true })
  const plan = { episode_key: 'ep-001', characters: [{ key: 'char-lin-wan', name: '林晚' }] }
  await writeFile(resolve(root, 'episodes/ep-001/asset-plan/v001.json'), `${JSON.stringify(plan)}\n`)
  await writeFile(resolve(root, 'episodes/ep-001/asset-plan/selected.json'), `${JSON.stringify({ versionId: 'v001', path: 'episodes/ep-001/asset-plan/v001.json' })}\n`)
  await mkdir(resolve(root, 'assets/characters'), { recursive: true })
  await writeFile(resolve(root, 'assets/characters/profiles.json'), `${JSON.stringify({ version: 1, characters: [adult] })}\n`)
  const source = resolve(root, 'candidate.png')
  await writeFile(source, Buffer.from('candidate-image'))
  await importAssetFile(root, 'char-lin-wan', source, { origin: 'generated', created_by: 'provider', provider: 'starrouter', model_or_workflow: 'gpt-image-2', task_id: 'task-char', prompt_document: { kind: 'asset-plan', episode_key: 'ep-001', version_id: 'v001', asset_key: 'char-lin-wan' }, source_assets: [], parameters: {} }, '林晚')
  await assert.rejects(() => selectAssetVersion(root, 'char-lin-wan', 'v001'), /人物专项审核/)
  const result = await putCharacterAppealReview(root, { assetKey: 'char-lin-wan', versionId: 'v001', review_type: 'character-appeal', ...review() })
  assert.equal(result.selected, true)
})

