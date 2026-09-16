import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { starrouter } from './starrouter.mjs'

test('StarRouter ASR 可请求单词级时间戳并按重复表单字段发送', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'starrouter-asr-'))
  const audio = resolve(root, 'speech.wav')
  const originalFetch = globalThis.fetch
  await writeFile(audio, 'audio-fixture')
  try {
    globalThis.fetch = async (_url, init) => {
      assert.deepEqual(init.body.getAll('timestamp_granularities[]'), ['word', 'segment'])
      return new Response(JSON.stringify({ text: '别回头', words: [{ word: '别', start: 0, end: 0.2 }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    const result = await starrouter.transcribe({
      model: 'whisper-1',
      file_path: audio,
      response_format: 'verbose_json',
      timestamp_granularities: ['word', 'segment'],
      confirmed: true,
    })
    assert.equal(result.words[0].word, '别')
  } finally {
    globalThis.fetch = originalFetch
    await rm(root, { recursive: true, force: true })
  }
})

test('词级时间戳仅允许 verbose_json 且拒绝未知粒度', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'starrouter-asr-invalid-'))
  const audio = resolve(root, 'speech.wav')
  await writeFile(audio, 'audio-fixture')
  try {
    await assert.rejects(starrouter.transcribe({ model: 'whisper-1', file_path: audio, response_format: 'json', timestamp_granularities: ['word'], confirmed: true }), /verbose_json/)
    await assert.rejects(starrouter.transcribe({ model: 'whisper-1', file_path: audio, response_format: 'verbose_json', timestamp_granularities: ['sentence'], confirmed: true }), /word.*segment/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
