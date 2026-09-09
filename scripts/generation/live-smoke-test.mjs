#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises'
import { extname, resolve } from 'node:path'
import { starrouter } from './starrouter.mjs'

const outputArg = process.argv.indexOf('--output')
const output = outputArg >= 0 ? resolve(process.argv[outputArg + 1] || '') : ''
if (!process.argv.includes('--confirmed') || !output) throw new Error('用法：live-smoke-test.mjs --confirmed --output <目录>')

await mkdir(output, { recursive: true })
const report = { startedAt: new Date().toISOString(), parameters: { image: '1K/1:1/low/n=1', video2: '4s/480p/1:1', video1: '5s/720p/1:1', audio: 'mp3/male-qn-qingse' }, results: [] }
const sleep = (milliseconds) => new Promise((done) => setTimeout(done, milliseconds))
const safeName = (value) => value.replace(/[^a-zA-Z0-9._-]/g, '-')

async function save(result, model) {
  const files = []
  for (const [index, item] of (result.outputs || []).entries()) {
    let bytes
    let extension = ''
    if (item.b64_json) {
      const match = /^data:([^;,]+);base64,(.+)$/s.exec(item.b64_json)
      bytes = Buffer.from((match?.[2] || item.b64_json).replace(/\s+/g, ''), 'base64')
      extension = ({ 'audio/mpeg': '.mp3', 'audio/flac': '.flac', 'audio/L16': '.pcm', 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' })[match?.[1]] || ''
    } else if (item.url) {
      const response = await fetch(item.url, { signal: AbortSignal.timeout(300_000) })
      if (!response.ok) throw new Error(`结果下载失败(${response.status})`)
      bytes = Buffer.from(await response.arrayBuffer())
      extension = extname(new URL(item.url).pathname)
    }
    if (!bytes?.length) throw new Error('结果为空')
    extension ||= item.media_type === 'video' ? '.mp4' : item.media_type === 'audio' ? '.mp3' : '.png'
    const path = resolve(output, `${safeName(model)}-${index + 1}${extension}`)
    await writeFile(path, bytes, { flag: 'wx' })
    files.push({ path, bytes: bytes.length })
  }
  return files
}

async function attempt(modality, model, action) {
  const startedAt = new Date().toISOString()
  try {
    const result = await action()
    const files = await save(result, model)
    const record = { modality, model, status: 'passed', task_id: result.task_id || null, files, startedAt, finishedAt: new Date().toISOString() }
    report.results.push(record)
    console.log(JSON.stringify(record))
  } catch (error) {
    const record = { modality, model, status: 'failed', error: error instanceof Error ? error.message : String(error), startedAt, finishedAt: new Date().toISOString() }
    report.results.push(record)
    console.log(JSON.stringify(record))
  }
}

const catalog = (await starrouter.models()).catalog
for (const model of catalog.image) await attempt('image', model, () => starrouter.image({ model, prompt: '极简灰色摄影棚中的白色电影场记板，无文字，无人物。', resolution: '1K', aspect_ratio: '1:1', quality: 'low', n: 1, output_format: 'png', confirmed: true }))
for (const model of catalog.audio) await attempt('audio', model, () => starrouter.audio({ model, input: '测试成功。', voice: process.env.STARROUTER_TEST_VOICE || 'male-qn-qingse', speed: 1, response_format: 'mp3', metadata: { output_format: 'hex', language_boost: 'Chinese' }, confirmed: true }))

const videos = []
for (const model of catalog.video) {
  const seedance2 = /seedance-2-0/.test(model)
  const h3 = /^MiniMax-H3/.test(model)
  try {
    const submitted = await starrouter.submitVideo({ model, prompt_profile: seedance2 ? 'seedance2' : h3 ? 'h3' : 'generic', input_mode: seedance2 ? 'first-last-frame' : h3 ? 'T2VA' : 'generic', prompt_version: 'v001', prompt: '固定机位，极简灰色摄影棚中的白色电影场记板缓慢合拢，无文字，无人物。', duration: seedance2 ? 4 : 5, ...(h3 ? { size: model.endsWith('-Max') ? '480P' : '768P' } : { resolution: seedance2 ? '480p' : '720p' }), ratio: '1:1', fps: seedance2 ? 24 : undefined, generate_audio: false, watermark: false, reference_manifest: [], confirmed: true })
    videos.push({ model, task_id: submitted.task_id, startedAt: new Date().toISOString() })
    console.log(JSON.stringify({ modality: 'video', model, status: 'submitted', task_id: submitted.task_id }))
  } catch (error) {
    report.results.push({ modality: 'video', model, status: 'failed', error: error instanceof Error ? error.message : String(error), finishedAt: new Date().toISOString() })
  }
}

const deadline = Date.now() + 20 * 60_000
while (videos.length && Date.now() < deadline) {
  for (let index = videos.length - 1; index >= 0; index -= 1) {
    const pending = videos[index]
    try {
      const result = await starrouter.task({ task_id: pending.task_id, media_type: 'video' })
      if (result.status === 'pending') continue
      if (result.status === 'failed') throw new Error(result.error || '视频任务失败')
      const files = await save(result, pending.model)
      const record = { modality: 'video', model: pending.model, status: 'passed', task_id: pending.task_id, files, startedAt: pending.startedAt, finishedAt: new Date().toISOString() }
      report.results.push(record)
      console.log(JSON.stringify(record))
      videos.splice(index, 1)
    } catch (error) {
      const record = { modality: 'video', model: pending.model, status: 'failed', task_id: pending.task_id, error: error instanceof Error ? error.message : String(error), startedAt: pending.startedAt, finishedAt: new Date().toISOString() }
      report.results.push(record)
      console.log(JSON.stringify(record))
      videos.splice(index, 1)
    }
  }
  if (videos.length) await sleep(10_000)
}
for (const pending of videos) report.results.push({ modality: 'video', model: pending.model, status: 'timeout', task_id: pending.task_id, startedAt: pending.startedAt, finishedAt: new Date().toISOString() })

report.finishedAt = new Date().toISOString()
report.summary = Object.fromEntries(['passed', 'failed', 'timeout'].map((status) => [status, report.results.filter((item) => item.status === status).length]))
await writeFile(resolve(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' })
console.log(JSON.stringify({ output, summary: report.summary }))
if (report.summary.failed || report.summary.timeout) process.exitCode = 1
