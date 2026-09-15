import test from 'node:test'
import assert from 'node:assert/strict'
import {
  mergePlayletObservations,
  normalizeRankingItem,
  normalizeRankings,
  parseList,
} from './normalize.mjs'

test('合并数组和字符串标签并保留来源', () => {
  const result = normalizeRankings({
    hot: [{ playletId: 1, playletName: '公司扣我年终奖，我不忍了', ranking: 1, consumeNum: 889000, newFlag: true, playletTags: ['男频', null, '现代', '都市日常'], relatedPartyCompany: ['快创'] }],
    douyin: [{ playletId: 2, playletName: '今晚查寝，别开门', ranking: 1, playCountAddRaw: 900000, tags: '["女频","悬疑"]', isNew: 1 }],
  }, { observedAt: '2026-09-16T15:30:00+08:00' })

  assert.deepEqual(result[0].topics, ['都市日常'])
  assert.equal(result[0].audience, '男频')
  assert.equal(result[0].provenance.topicSource, 'source-tag')
  assert.equal(result[1].growthValue, 900000)
  assert.deepEqual(Object.keys(result[0]).sort(), [
    'audience', 'companies', 'era', 'format', 'growthValue', 'heatValue', 'isNew', 'key', 'persistenceDays', 'playletId', 'provenance', 'ranking', 'rankingType', 'title', 'topics', 'observedAt',
  ].sort())
})

test('parseList 处理数组、JSON、普通分隔符和非法 JSON', () => {
  assert.deepEqual(parseList([' 男频 ', null, '都市', '男频']), ['男频', '都市'])
  assert.deepEqual(parseList('["女频", null, "悬疑", "女频"]'), ['女频', '悬疑'])
  assert.deepEqual(parseList('公司, 快创；公司|星河/快创'), ['公司', '快创', '星河'])
  assert.deepEqual(parseList(null), [])
  assert.deepEqual(parseList('{非法 JSON'), ['{非法 JSON'])
})

test('损坏 JSON 数组清洗括号、引号和字符串 null，并保留可恢复标签', () => {
  const tags = parseList('["男频",null,"都市日常"')
  assert.deepEqual(tags, ['男频', '都市日常'])

  const observation = normalizeRankingItem('hot', {
    title: '一部普通短剧',
    tags: '["男频",null,"都市日常"',
  })
  assert.equal(observation.audience, '男频')
  assert.deepEqual(observation.topics, ['都市日常'])
  assert.deepEqual(observation.provenance.evidence.rawTags, ['男频', '都市日常'])
})

test('状态和形式标签不是题材证据，未知标签不会伪装成 source-tag', () => {
  const observation = normalizeRankingItem('hot', {
    title: '没有明确题材的作品',
    tags: ['真人', '短剧', '已完结', '神秘标签'],
  })

  assert.deepEqual(observation.topics, ['未分类'])
  assert.equal(observation.provenance.topicSource, 'unclassified')
  assert.equal(observation.format, null)
  assert.deepEqual(observation.provenance.evidence.rawTags, ['真人', '短剧', '已完结', '神秘标签'])
})

test('来源细分题材按受控语义词根保留原标签', () => {
  const observation = normalizeRankingItem('hot', {
    title: '一部普通作品',
    tags: ['都市职场', '婆媳伦理', '古装爱情'],
  })

  assert.deepEqual(observation.topics, ['都市职场', '婆媳伦理', '古装爱情'])
  assert.equal(observation.provenance.topicSource, 'source-tag')
})

test('标题词根只推断受控题材，不从题材推断受众和时代', () => {
  const observation = normalizeRankingItem('hot', {
    name: '重生后我成了霸总的白月光',
    tags: ['现代'],
  }, { observedAt: '2026-09-16T15:30:00+08:00' })

  assert.deepEqual(observation.topics, ['霸道总裁', '重生穿越'])
  assert.equal(observation.audience, null)
  assert.equal(observation.era, '现代')
  assert.equal(observation.provenance.topicSource, 'title-keyword')
})

test('脏数据和缺失 ID 使用稳定标题键，动态漫字段不扩张合同', () => {
  const first = normalizeRankingItem('motion-ai', {
    title: 'AI 归来',
    rank: '2',
    hotValue: 'not-a-number',
    playCount: '12,300',
    listDays: '7',
    company: ['快创', '快创', null],
    tags: '["男频", null]',
    cover: 'ignored-cover-a.jpg',
  }, { observedAt: '2026-09-16T15:30:00+08:00' })
  const second = normalizeRankingItem('motion-ai', {
    title: ' AI 归来 ',
    rank: 3,
    coverUrl: 'ignored-cover-b.jpg',
  }, { observedAt: '2026-09-16T15:30:00+08:00' })

  assert.equal(first.key, second.key)
  assert.equal(first.ranking, 2)
  assert.equal(first.heatValue, 12300)
  assert.equal(first.persistenceDays, 7)
  assert.deepEqual(first.companies, ['快创'])
  assert.equal(first.format, '真人AI')
  assert.equal(first.audience, '男频')
  assert.equal('cover' in first, false)
  assert.equal('coverUrl' in first, false)
  assert.equal(normalizeRankingItem('motion', { title: '动态样本', tags: ['动态漫'] }).format, '动态漫')
})

test('跨榜单按作品键聚合并保留每个榜单观察和证据', () => {
  const observations = normalizeRankings({
    hot: [{ playletId: 'same', playletName: '同一部剧', ranking: 1, consumeNum: 100 }],
    douyin: [{ playletId: 'same', name: '同一部剧', topNum: '4', playCountAddRaw: '200' }],
  }, { observedAt: '2026-09-16T15:30:00+08:00' })
  const merged = mergePlayletObservations(observations)

  assert.equal(merged.length, 1)
  assert.equal(merged[0].key, observations[0].key)
  assert.equal(merged[0].observations.length, 2)
  assert.deepEqual(merged[0].rankingTypes, ['hot', 'douyin'])
  assert.deepEqual(merged[0].rankings.map(({ rankingType, ranking }) => ({ rankingType, ranking })), [
    { rankingType: 'hot', ranking: 1 },
    { rankingType: 'douyin', ranking: 4 },
  ])
  assert.equal(merged[0].rankings[1].provenance.rankingType, 'douyin')
})
