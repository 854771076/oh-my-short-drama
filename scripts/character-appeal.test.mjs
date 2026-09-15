import test from 'node:test'
import assert from 'node:assert/strict'
import { assertCharacterReadyForVisuals, classifyAgeRange, validateAudienceAppeal } from './character-appeal.mjs'
import { validateAnalysis } from './character-profiles.mjs'

const adult = { age_class: 'adult', appeal_mode: 'adult-charisma', screen_presence: '克制但锋利', grooming_and_makeup: '利落短发与干净修容', costume_signature: '修身深色外套与哑光金属领扣', memory_anchors: ['左眉浅疤', '不对称领扣'], prohibited_treatment: ['色情化构图', '无剧情依据的裸露'] }

test('只从明确年龄范围分类', () => {
  assert.equal(classifyAgeRange('28岁'), 'adult')
  assert.equal(classifyAgeRange('8岁儿童'), 'child')
  assert.equal(classifyAgeRange('年龄未提供'), 'unknown')
  assert.equal(classifyAgeRange('公司总裁'), 'unknown')
})

test('S级成年人物必须有两个以上记忆锚点', () => {
  assert.equal(validateAudienceAppeal(adult, { age_range: '28岁', gender: 'male', role_level: 'S' }).appeal_mode, 'adult-charisma')
  assert.throws(() => validateAudienceAppeal({ ...adult, memory_anchors: ['左眉浅疤'] }, { age_range: '28岁', gender: 'male', role_level: 'S' }), /2–3/)
})

test('儿童成人化和未知年龄都阻止视觉生成', () => {
  assert.throws(() => validateAudienceAppeal({ ...adult, age_class: 'child', appeal_mode: 'child-cuteness', costume_signature: '性感修身礼服' }, { age_range: '8岁', gender: 'female', role_level: 'A' }), /儿童保护/)
  assert.throws(() => assertCharacterReadyForVisuals({ age_range: '未提供稳定证据', audience_appeal: { age_class: 'unknown', appeal_mode: 'not-applicable', screen_presence: '', grooming_and_makeup: '', costume_signature: '', memory_anchors: [], prohibited_treatment: [] } }), /年龄证据/)
})

test('非人类角色必须明确使用不适用合同', () => {
  const value = { age_class: 'not-applicable', appeal_mode: 'not-applicable', screen_presence: '', grooming_and_makeup: '', costume_signature: '', memory_anchors: [], prohibited_treatment: [] }
  assert.equal(validateAudienceAppeal(value, { age_range: '不适用', gender: 'unknown', role_level: 'B', is_human: false }).age_class, 'not-applicable')
})

test('新人物档案缺少 audience_appeal 时拒绝但空增量仍兼容', () => {
  assert.deepEqual(validateAnalysis({ new_characters: [], updated_characters: [] }), { new_characters: [], updated_characters: [] })
  const character = {
    name: '林晚', aliases: [], introduction: '28岁刑警', gender: 'female', age_range: '28岁', role_level: 'S', archetype: '调查者', personality_tags: ['敏锐', '克制'], era_period: '当代', social_class: '工薪', occupation: '刑警', costume_tier: 1, suggested_colors: ['深蓝', '灰'], primary_identifier: '左眉浅疤', visual_keywords: ['冷静'],
    performance_bible: { center_of_gravity: '稳定', gait: '干练', habitual_actions: [], eyeline_behavior: '直视', blink_rhythm: '慢', stress_response: '下颌收紧', forbidden_performance: [] },
    voice_identity: { pitch: '中', timbre: '清冷', accent: '普通话', pace: '中速', delivery: '克制' }, audience_appeal: adult, expected_appearances: [{ id: 1, change_reason: '初次出场' }],
  }
  assert.equal(validateAnalysis({ new_characters: [character], updated_characters: [] }).new_characters[0].name, '林晚')
  const { audience_appeal, ...missing } = character
  assert.throws(() => validateAnalysis({ new_characters: [missing], updated_characters: [] }), /audience_appeal|字段必须且只能/)
})
