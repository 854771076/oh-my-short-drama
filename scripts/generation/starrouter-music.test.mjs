import test from 'node:test'
import assert from 'node:assert/strict'
import { starrouter } from './starrouter.mjs'

async function capturedMusicBody(input) {
  const originalFetch = globalThis.fetch
  let body
  try {
    globalThis.fetch = async (url, init) => {
      assert.match(String(url), /\/suno\/submit\/MUSIC$/)
      body = JSON.parse(init.body)
      return Response.json({ data: 'task_music' })
    }
    await starrouter.music({ confirmed: true, model: 'suno_music', title: '逆光而行', tags: 'cinematic, heroic', ...input })
    return body
  } finally {
    globalThis.fetch = originalFetch
  }
}

test('无歌词 BGM 使用 Suno 普通描述字段而不是自定义歌词字段', async () => {
  const body = await capturedMusicBody({ prompt: '结合追逃剧情的暗色电子配乐', make_instrumental: true })
  assert.equal(body.gpt_description_prompt, '结合追逃剧情的暗色电子配乐')
  assert.equal(body.prompt, undefined)
  assert.equal(body.make_instrumental, true)
})

test('有歌词 OP/ED 只把批准歌词发送到 Suno 自定义 prompt', async () => {
  const body = await capturedMusicBody({ prompt: '国漫热血片头曲', lyrics: '[Chorus]\n逆着光，重新归来', make_instrumental: false })
  assert.equal(body.prompt, '[Chorus]\n逆着光，重新归来')
  assert.equal(body.gpt_description_prompt, undefined)
})
