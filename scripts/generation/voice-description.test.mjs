import test from 'node:test'
import assert from 'node:assert/strict'
import { validateVoiceDescription } from './voice-description.mjs'

const profile = { name: '林晚', gender: 'female', age_range: '年轻女性' }

test('接受性别年龄和四个声音特征', () => {
  assert.equal(validateVoiceDescription('年轻女性，音色清亮，语速平稳，表达冷静，略带磁性', profile).traits.length, 4)
})

test('缺少性别年龄时拒绝', () => {
  assert.throws(() => validateVoiceDescription('音色清亮，语速平稳', profile), /性别和年龄段/)
})

test('人物名、剧情、前缀和五项特征均拒绝', () => {
  for (const value of ['林晚是年轻女性，清亮温柔', '年轻女性，剧情中声音清亮', '声音描述：年轻女性，清亮温柔', '年轻女性，低沉、舒缓、温柔、磁性、沙哑']) assert.throws(() => validateVoiceDescription(value, profile))
})

test('描述必须与人物档案的性别和年龄段一致', () => {
  assert.throws(() => validateVoiceDescription('中年女性，清亮，平稳', profile), /年龄段/)
  assert.throws(() => validateVoiceDescription('年轻男性，清亮，平稳', profile), /性别/)
  assert.throws(() => validateVoiceDescription(`年轻女性，清亮，平稳${'声'.repeat(20)}`, profile), /50/)
})
