import test from 'node:test'
import assert from 'node:assert/strict'
import { compileMusicSearch, listMusicCatalogs, searchMusicCatalog } from './providers.mjs'

test('剧情功能被编译为具体选曲条件', () => {
  assert.deepEqual(compileMusicSearch({ purpose: 'bgm', dramatic_function: '秘密揭露前持续加压', pace: 'slow-build', dialogue_density: 'high', duration_seconds: 32 }), { query: 'suspense tension minimal instrumental', genre: ['cinematic'], mood: ['suspense'], duration_seconds: 32 })
})

test('外部站点返回官方搜索入口而不是盗链', async () => {
  const result = await searchMusicCatalog({ catalog: 'pixabay', query: 'cinematic suspense' })
  assert.equal(result.mode, 'browser')
  assert.match(result.search_url, /^https:\/\/pixabay\.com\/music\/search\//)
})

test('目录声明许可证和登录特性', () => {
  assert.deepEqual(listMusicCatalogs().map((item) => item.key), ['local-licensed', 'pixabay', 'youtube-audio-library', 'uppbeat'])
})
