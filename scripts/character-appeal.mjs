const ADULT_WORDS = /(?:成年|青年|中年|老年|年轻男|年轻女)/
const CHILD_WORDS = /(?:儿童|幼儿|男童|女童|小学生|少年|少女)/
const CHILD_PROHIBITED = /(?:性感|妩媚|成熟妆|成人妆|成人化|低胸|身体曲线|挑逗|性化镜头)/
const FIELDS = ['age_class', 'appeal_mode', 'screen_presence', 'grooming_and_makeup', 'costume_signature', 'memory_anchors', 'prohibited_treatment']

function exactFields(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...FIELDS].sort())) throw new Error('audience_appeal 字段不完整')
}

function text(value, field, allowEmpty = false) {
  if (typeof value !== 'string' || !allowEmpty && !value.trim()) throw new Error(`audience_appeal.${field} 必须是${allowEmpty ? '' : '非空'}字符串`)
}

function textList(value, field, { min = 0, max = Infinity } = {}) {
  if (!Array.isArray(value) || value.length < min || value.length > max || value.some((item) => typeof item !== 'string' || !item.trim())) throw new Error(`audience_appeal.${field} 必须为 ${min}–${max === Infinity ? '不限' : max} 项非空字符串`)
  if (new Set(value.map((item) => item.trim().toLocaleLowerCase())).size !== value.length) throw new Error(`audience_appeal.${field} 不得重复`)
}

export function classifyAgeRange(value) {
  const text = String(value || '')
  const age = Number(text.match(/(?:^|\D)(\d{1,3})\s*岁/)?.[1])
  if (Number.isInteger(age) && age >= 0 && age <= 120) return age >= 18 ? 'adult' : 'child'
  if (ADULT_WORDS.test(text)) return 'adult'
  if (CHILD_WORDS.test(text)) return 'child'
  return 'unknown'
}

export function validateAudienceAppeal(value, context = {}) {
  exactFields(value)
  const expectedAge = context.is_human === false ? 'not-applicable' : classifyAgeRange(context.age_range)
  if (value.age_class !== expectedAge) throw new Error('audience_appeal 年龄分级与证据不一致')
  if (!['adult-charisma', 'child-cuteness', 'not-applicable'].includes(value.appeal_mode)) throw new Error('audience_appeal appeal_mode 无效')
  textList(value.memory_anchors, 'memory_anchors', { max: 3 })
  textList(value.prohibited_treatment, 'prohibited_treatment', { max: 8 })
  if (expectedAge === 'adult') {
    if (value.appeal_mode !== 'adult-charisma') throw new Error('成年人物必须使用 adult-charisma')
    for (const field of ['screen_presence', 'grooming_and_makeup', 'costume_signature']) text(value[field], field)
    const minimum = ['S', 'A'].includes(context.role_level) ? 2 : 1
    if (value.memory_anchors.length < minimum) throw new Error(`成年人物记忆锚点必须为 ${minimum === 2 ? '2–3' : '1–3'} 项`)
  } else if (expectedAge === 'child') {
    if (value.appeal_mode !== 'child-cuteness') throw new Error('儿童保护规则失败：必须使用 child-cuteness')
    for (const field of ['screen_presence', 'grooming_and_makeup', 'costume_signature']) text(value[field], field)
    if (value.memory_anchors.length < 1 || CHILD_PROHIBITED.test([value.screen_presence, value.grooming_and_makeup, value.costume_signature, ...value.memory_anchors].join(' '))) throw new Error('儿童保护规则失败')
  } else {
    if (value.appeal_mode !== 'not-applicable') throw new Error('未知年龄或非人类角色必须使用 not-applicable')
    for (const field of ['screen_presence', 'grooming_and_makeup', 'costume_signature']) text(value[field], field, true)
    if (value.memory_anchors.length) throw new Error('未知年龄或非人类角色不得编造视觉魅力锚点')
  }
  return structuredClone(value)
}

export function assertCharacterReadyForVisuals(character) {
  const value = validateAudienceAppeal(character?.audience_appeal, character || {})
  if (value.age_class === 'unknown') throw new Error('人物缺少明确年龄证据，禁止生成视觉资产或正式视频')
  return value
}
