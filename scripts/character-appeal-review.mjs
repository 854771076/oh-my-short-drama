import { assertCharacterReadyForVisuals } from './character-appeal.mjs'

const DIMENSIONS = ['age_classification', 'identity', 'grooming_costume', 'memory_anchors', 'audience_appeal']

function dimension(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`人物视觉审核缺少 ${label}`)
  const expected = label === 'age_classification' ? ['status', 'observation', 'observed_age_class'] : ['status', 'observation']
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(expected.sort())) throw new Error(`人物视觉审核 ${label} 字段无效`)
  if (!['passed', 'failed'].includes(value.status) || typeof value.observation !== 'string' || !value.observation.trim()) throw new Error(`人物视觉审核 ${label} 必须包含状态与实际观察`)
  return value
}

export function validateCharacterAppealReview(character, review) {
  const appeal = assertCharacterReadyForVisuals(character)
  if (!review || typeof review !== 'object' || Array.isArray(review)) throw new Error('人物视觉审核必须是对象')
  for (const field of DIMENSIONS) dimension(review[field], field)
  if (!['adult', 'child', 'not-applicable'].includes(review.age_classification.observed_age_class) || review.age_classification.observed_age_class !== appeal.age_class) throw new Error('人物视觉审核 age_classification 与档案年龄分级不一致')
  if (!Array.isArray(review.protection_flags) || review.protection_flags.some((item) => typeof item !== 'string' || !item.trim())) throw new Error('人物视觉审核缺少 protection_flags')
  if (review.watched_or_inspected_full !== true) throw new Error('人物视觉必须查看原图并完整检查')
  if (typeof review.approved !== 'boolean') throw new Error('人物视觉审核 approved 必须是布尔值')
  const failed = DIMENSIONS.filter((field) => review[field].status === 'failed')
  if (review.approved && failed.length) throw new Error(`人物视觉审核 ${failed.join('、')} 未通过，不得批准`)
  if (appeal.age_class === 'child' && review.protection_flags.length) throw new Error('儿童保护失败，禁止批准')
  if (review.approved && review.protection_flags.length) throw new Error('保护性规则失败不能被总体美观分抵消')
  return review.approved && failed.length === 0 && review.protection_flags.length === 0
}

