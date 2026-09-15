import { weightedLength } from './bailian.mjs'

const AGE = /(少年|少女|年轻|青年|中年|老年|儿童|男孩|女孩|young|teen(?:age)?|middle-aged|elderly|child)/i
const GENDER = /(男性|女性|男声|女声|男人|女人|男孩|女孩|少年|少女|\bmale\b|\bfemale\b|\bman\b|\bwoman\b|\bboy\b|\bgirl\b)/i
const TRAITS = [
  '低沉', '清亮', '高亢', '沙哑', '浑厚', '温暖', '磁性', '鼻音', '娃娃音', '舒缓', '急促', '平稳', '稍快', '温柔', '冷峻', '冷静', '威严', '活泼', '甜美', '沧桑', '自然', '亲切',
  'deep', 'clear', 'bright', 'raspy', 'warm', 'magnetic', 'nasal', 'gentle', 'brisk', 'steady', 'calm', 'cold', 'authoritative', 'lively', 'sweet', 'weathered', 'natural', 'friendly',
]
const FORBIDDEN = /声音描述\s*[:：]|voice\s*(?:description|prompt)\s*:|[“”"#]|剧情|台词|地名|模仿|真人|plot|dialogue|imitat(?:e|ion)|real[- ]person/i

function expectedGender(profile) {
  const gender = String(profile?.gender || '').toLowerCase()
  if (['female', 'woman', 'girl', '女', '女性'].some((token) => gender.includes(token))) return 'female'
  if (['male', 'man', 'boy', '男', '男性'].some((token) => gender.includes(token))) return 'male'
  return null
}

function expectedAge(profile) {
  const age = String(profile?.age_range || '').toLowerCase()
  for (const [group, tokens] of Object.entries({ child: ['儿童', '男孩', '女孩', 'child'], teen: ['少年', '少女', '青少年', 'teen'], young: ['年轻', '青年', 'young'], middle: ['中年', 'middle-aged'], elderly: ['老年', 'elderly'] })) {
    if (tokens.some((token) => age.includes(token))) return { group, tokens }
  }
  return null
}

export function validateVoiceDescription(input, profile = {}) {
  const text = String(input || '').trim()
  if (!text || weightedLength(text) > 50) throw new Error('声音描述必须为 50 个中文加权字符以内')
  if (!AGE.test(text) || !GENDER.test(text)) throw new Error('声音描述必须明确性别和年龄段')
  if (profile.name && text.includes(String(profile.name))) throw new Error('声音描述不得包含人物名')
  if (FORBIDDEN.test(text)) throw new Error('声音描述包含剧情、台词、前缀、地名或真人模仿等禁止内容')
  const gender = expectedGender(profile)
  if (gender === 'female' && !/(女性|女声|女人|女孩|少女|\bfemale\b|\bwoman\b|\bgirl\b)/i.test(text)) throw new Error('声音描述性别与人物档案不一致')
  if (gender === 'male' && !/(男性|男声|男人|男孩|少年|\bmale\b|\bman\b|\bboy\b)/i.test(text)) throw new Error('声音描述性别与人物档案不一致')
  const age = expectedAge(profile)
  if (age && !age.tokens.some((token) => text.toLowerCase().includes(token))) throw new Error('声音描述年龄段与人物档案不一致')
  const traits = [...new Set(TRAITS.filter((trait) => new RegExp(`[\\s，,、；;。.]${trait}(?=[\\s，,、；;。.]|$)`, 'i').test(`，${text}，`) || text.includes(trait)))]
  if (traits.length < 2 || traits.length > 4) throw new Error('声音描述必须包含 2–4 个声音特征')
  if (Array.isArray(profile.voice_traits)) {
    const unsupported = traits.filter((trait) => !profile.voice_traits.includes(trait))
    if (unsupported.length) throw new Error(`声音特征缺少人物档案证据：${unsupported.join('、')}`)
  }
  return { text, traits }
}
