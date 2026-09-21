import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import { chmod, mkdir, mkdtemp, readFile, readdir, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { importReferenceVideoBrowserFile, importReferenceVideoUrl, parseReferenceVideoUrl, validateReferenceImportReceipts } from './reference-video-import.mjs'

async function fixtureProject() {
  const root = await mkdtemp(resolve(tmpdir(), 'reference-url-import-'))
  await mkdir(resolve(root, '.short-drama'), { recursive: true })
  await mkdir(resolve(root, 'source'), { recursive: true })
  await writeFile(resolve(root, 'source/manifest.json'), '{"version":1,"sources":{}}\n')
  await writeFile(resolve(root, '.short-drama/state.json'), '{"version":1,"stage":"analysis","completed":[],"invalidatedAt":{},"updatedAt":"2026-09-16T00:00:00.000Z"}\n')
  await writeFile(resolve(root, '.short-drama/skill-runs.json'), '{"version":1,"runs":{}}\n')
  return root
}

async function videoFixture() {
  const directory = await mkdtemp(resolve(tmpdir(), 'reference-url-video-'))
  const path = resolve(directory, 'video.mp4')
  const result = spawnSync('ffmpeg', ['-nostdin', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=blue:s=160x120:d=1:r=10', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  return readFile(path)
}

async function dtkServer(video, options = {}) {
  const requests = []
  const digest = createHash('sha256').update(video).digest('hex')
  const server = createServer(async (request, response) => {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    requests.push({ method: request.method, url: request.url, authorization: request.headers.authorization, body: Buffer.concat(chunks).toString() })
    response.setHeader('content-type', 'application/json')
    if (request.method === 'POST' && request.url === '/api/v1/parse?wait=30') return response.end(JSON.stringify({ success: true, data: { platform: 'douyin', content_id: '7123456789012345678', kind: 'video', web_url: 'https://www.douyin.com/video/7123456789012345678', title: '测试视频', author: { nickname: '测试作者', uid: 'author-1' }, duration_ms: 1000 }, error: null, meta: { request_id: 'parse-1' } }))
    if (request.method === 'POST' && request.url === '/api/v1/downloads') return response.end(JSON.stringify({ success: true, data: { download_id: '11111111-1111-4111-8111-111111111111', state: 'queued' }, error: null, meta: { request_id: 'download-1' } }))
    if (request.method === 'GET' && request.url === '/api/v1/downloads/11111111-1111-4111-8111-111111111111') return response.end(JSON.stringify({ success: true, data: { id: '11111111-1111-4111-8111-111111111111', platform: 'douyin', content_id: '7123456789012345678', author_uid: 'author-1', state: 'done', directory: 'douyin/author-1/7123456789012345678', bytes_total: video.length, file_count: 1, pinned: false, on_disk: true, files_removed_at: null, error: null, task_id: '22222222-2222-4222-8222-222222222222', created_at: '2026-09-16T00:00:00Z', started_at: '2026-09-16T00:00:01Z', finished_at: '2026-09-16T00:00:02Z', files: [{ name: 'video.mp4', kind: 'video', content_type: 'video/mp4', size: video.length, sha256: digest, export_name: 'dtk-douyin-7123456789012345678-video.mp4' }] }, error: null, meta: { request_id: 'status-1' } }))
    if (request.method === 'GET' && request.url === '/api/v1/downloads/11111111-1111-4111-8111-111111111111/files/video.mp4') {
      if (options.failFile) { response.statusCode = 503; return response.end(JSON.stringify({ success: false, data: null, error: { code: 'DOWNLOADER_DOWN', message: 'down' }, meta: {} })) }
      response.setHeader('content-type', 'video/mp4')
      return response.end(video)
    }
    response.statusCode = 404
    response.end(JSON.stringify({ success: false, data: null, error: { code: 'NOT_FOUND' }, meta: {} }))
  })
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen))
  const address = server.address()
  return { baseUrl: `http://127.0.0.1:${address.port}`, requests, close: () => new Promise((resolveClose) => server.close(resolveClose)) }
}

test('链接解析只接受受支持平台并拒绝内网或伪造 URL', () => {
  assert.deepEqual(parseReferenceVideoUrl('复制这条 https://v.douyin.com/AbCd12/ 打开抖音'), { platform: 'douyin', url: 'https://v.douyin.com/AbCd12/' })
  assert.equal(parseReferenceVideoUrl('https://youtu.be/abc123').platform, 'youtube')
  assert.throws(() => parseReferenceVideoUrl('http://127.0.0.1/private'), /不支持|内网/)
  assert.throws(() => parseReferenceVideoUrl('https://evil.example/video/1'), /不支持/)
})

test('未确认素材权利时不得向下载服务发起请求', async () => {
  const root = await fixtureProject()
  const video = await videoFixture()
  const dtk = await dtkServer(video)
  try {
    await assert.rejects(importReferenceVideoUrl(root, { input: 'https://v.douyin.com/AbCd12/', sourceKey: 'src-reference-video', versionId: 'v001', provider: 'dtk', dtk: { baseUrl: dtk.baseUrl, apiKey: 'secret-key' } }), /权利|授权/)
    assert.equal(dtk.requests.length, 0)
  } finally { await dtk.close() }
})

test('DTK 下载失败时不登记来源且不留下导入收据', async () => {
  const root = await fixtureProject()
  const video = await videoFixture()
  const dtk = await dtkServer(video, { failFile: true })
  try {
    await assert.rejects(importReferenceVideoUrl(root, { input: 'https://v.douyin.com/AbCd12/', sourceKey: 'src-reference-video', versionId: 'v001', provider: 'dtk', rightsConfirmation: { confirmed: true, basis: 'owned' }, dtk: { baseUrl: dtk.baseUrl, apiKey: 'secret-key' }, pollIntervalMs: 1 }), /DTK|下载/)
    assert.deepEqual(JSON.parse(await readFile(resolve(root, 'source/manifest.json'), 'utf8')).sources, {})
    const receiptRoot = resolve(root, '.short-drama/reference-imports')
    await assert.rejects(readdir(receiptRoot), /ENOENT/)
  } finally { await dtk.close() }
})

test('来源选版前置条件失败时不留下半登记版本', async () => {
  const root = await fixtureProject()
  const video = await videoFixture()
  const dtk = await dtkServer(video)
  await writeFile(resolve(root, '.short-drama/state.json'), '{broken json')
  try {
    await assert.rejects(importReferenceVideoUrl(root, { input: 'https://v.douyin.com/AbCd12/', sourceKey: 'src-reference-video', versionId: 'v001', provider: 'dtk', rightsConfirmation: { confirmed: true, basis: 'owned' }, dtk: { baseUrl: dtk.baseUrl, apiKey: 'secret-key' }, pollIntervalMs: 1 }))
    assert.deepEqual(JSON.parse(await readFile(resolve(root, 'source/manifest.json'), 'utf8')).sources, {})
    await assert.rejects(readFile(resolve(root, 'source/src-reference-video/v001.mp4')), /ENOENT/)
  } finally { await dtk.close() }
})

test('导入收据路径含符号链接时在下载前拒绝', async () => {
  const root = await fixtureProject()
  const outside = await mkdtemp(resolve(tmpdir(), 'reference-receipt-outside-'))
  await mkdir(resolve(root, '.short-drama/reference-imports'), { recursive: true })
  await symlink(outside, resolve(root, '.short-drama/reference-imports/src-reference-video'))
  const video = await videoFixture()
  const dtk = await dtkServer(video)
  try {
    await assert.rejects(importReferenceVideoUrl(root, { input: 'https://v.douyin.com/AbCd12/', sourceKey: 'src-reference-video', versionId: 'v001', provider: 'dtk', rightsConfirmation: { confirmed: true, basis: 'owned' }, dtk: { baseUrl: dtk.baseUrl, apiKey: 'secret-key' } }), /符号链接|路径/)
    assert.equal(dtk.requests.length, 0)
    assert.deepEqual(JSON.parse(await readFile(resolve(root, 'source/manifest.json'), 'utf8')).sources, {})
  } finally { await dtk.close() }
})

test('DTK 成功导入后登记并选中 reference-video，收据不泄露 API key', async () => {
  const root = await fixtureProject()
  const video = await videoFixture()
  const dtk = await dtkServer(video)
  try {
    const result = await importReferenceVideoUrl(root, { input: '复制 https://v.douyin.com/AbCd12/', sourceKey: 'src-reference-video', versionId: 'v001', provider: 'dtk', rightsConfirmation: { confirmed: true, basis: 'licensed' }, dtk: { baseUrl: dtk.baseUrl, apiKey: 'secret-key' }, pollIntervalMs: 1 })
    const manifest = JSON.parse(await readFile(resolve(root, 'source/manifest.json'), 'utf8'))
    assert.equal(manifest.sources['src-reference-video'].kind, 'reference-video')
    assert.equal(manifest.sources['src-reference-video'].selectedVersionId, 'v001')
    assert.equal(manifest.sources['src-reference-video'].versions[0].sha256, createHash('sha256').update(video).digest('hex'))
    const receipt = JSON.parse(await readFile(resolve(root, result.receipt_path), 'utf8'))
    assert.equal(receipt.provider, 'dtk')
    assert.equal(receipt.platform, 'douyin')
    assert.equal(receipt.content_id, '7123456789012345678')
    assert.equal(receipt.rights_confirmation.basis, 'licensed')
    assert.doesNotMatch(JSON.stringify(receipt), /secret-key/)
    assert.ok(dtk.requests.every((request) => request.authorization === 'Bearer secret-key'))
  } finally { await dtk.close() }
})

test('yt-dlp 通过参数数组导入其他平台，不执行 URL 中的 shell 字符', async () => {
  const root = await fixtureProject()
  const video = await videoFixture()
  const tools = await mkdtemp(resolve(tmpdir(), 'fake-yt-dlp-'))
  const binary = resolve(tools, 'yt-dlp')
  const marker = resolve(tools, 'shell-was-executed')
  await writeFile(binary, `#!/usr/bin/env node
const fs = require('node:fs')
const args = process.argv.slice(2)
if (args[0] !== '--ignore-config' || process.env.YTDLP_NO_PLUGINS !== '1') process.exit(9)
if (args.includes('--dump-single-json')) {
  process.stdout.write(JSON.stringify({id:'abc123',webpage_url:'https://www.youtube.com/watch?v=abc123',title:'YouTube 测试',uploader:'作者'}))
} else {
  const output = args[args.indexOf('-o') + 1].replace('%(ext)s', 'mp4')
  fs.writeFileSync(output, Buffer.from('${video.toString('base64')}', 'base64'))
}
`)
  await chmod(binary, 0o755)
  const input = `https://www.youtube.com/watch?v=abc123$(touch$IFS${marker})`
  const result = await importReferenceVideoUrl(root, { input, sourceKey: 'src-youtube', versionId: 'v001', provider: 'yt-dlp', rightsConfirmation: { confirmed: true, basis: 'authorized-reference' }, ytDlpBinary: binary })
  assert.equal(result.provider, 'yt-dlp')
  await assert.rejects(readFile(marker), /ENOENT/)
  assert.equal(JSON.parse(await readFile(resolve(root, 'source/manifest.json'), 'utf8')).sources['src-youtube'].selectedVersionId, 'v001')
})

test('yt-dlp 遇到 403 时返回稳定的用户浏览器兜底合同且不留下半成品', async () => {
  const root = await fixtureProject()
  const tools = await mkdtemp(resolve(tmpdir(), 'fake-yt-dlp-403-'))
  const binary = resolve(tools, 'yt-dlp')
  await writeFile(binary, `#!/usr/bin/env node
const args = process.argv.slice(2)
if (args.includes('--dump-single-json')) {
  process.stdout.write(JSON.stringify({id:'7677937301649142961',webpage_url:'https://www.douyin.com/video/7677937301649142961',title:'抖音测试',uploader:'作者'}))
} else {
  process.stderr.write('ERROR: unable to download video data: HTTP Error 403: Forbidden; signed=https://example.invalid/private-token')
  process.exit(1)
}
`)
  await chmod(binary, 0o755)
  await assert.rejects(
    importReferenceVideoUrl(root, { input: 'https://www.douyin.com/video/7677937301649142961', sourceKey: 'src-douyin', versionId: 'v001', provider: 'yt-dlp', rightsConfirmation: { confirmed: true, basis: 'authorized-reference' }, ytDlpBinary: binary }),
    (error) => error.code === 'YTDLP_HTTP_403_BROWSER_SESSION_REQUIRED' && error.exitCode === 42 && error.fallback?.session === 'existing-user' && !error.message.includes('private-token'),
  )
  assert.deepEqual(JSON.parse(await readFile(resolve(root, 'source/manifest.json'), 'utf8')).sources, {})
  await assert.rejects(readdir(resolve(root, '.short-drama/reference-imports')), /ENOENT/)
})

test('yt-dlp 非 403 失败不得误切浏览器且不回显下载器敏感输出', async () => {
  const root = await fixtureProject()
  const tools = await mkdtemp(resolve(tmpdir(), 'fake-yt-dlp-generic-failure-'))
  const binary = resolve(tools, 'yt-dlp')
  await writeFile(binary, `#!/bin/sh
echo 'network timeout signed_url=do-not-leak' >&2
exit 7
`)
  await chmod(binary, 0o755)
  await assert.rejects(
    importReferenceVideoUrl(root, { input: 'https://youtu.be/abc123', sourceKey: 'src-youtube', versionId: 'v001', provider: 'yt-dlp', rightsConfirmation: { confirmed: true, basis: 'authorized-reference' }, ytDlpBinary: binary }),
    (error) => !error.code && /退出码 7/.test(error.message) && !error.message.includes('do-not-leak'),
  )
})

test('浏览器兜底只接受用户现有 Chrome 会话并在校验后登记来源', async () => {
  const root = await fixtureProject()
  const videoDirectory = await mkdtemp(resolve(tmpdir(), 'browser-session-video-'))
  const videoPath = resolve(videoDirectory, 'douyin.mp4')
  await writeFile(videoPath, await videoFixture())
  const base = {
    input: 'https://www.douyin.com/video/7677937301649142961',
    localFile: videoPath,
    sourceKey: 'src-douyin',
    versionId: 'v001',
    contentId: '7677937301649142961',
    rightsConfirmation: { confirmed: true, basis: 'authorized-reference' },
  }
  await assert.rejects(importReferenceVideoBrowserFile(root, { ...base, browserSession: 'temporary-agent-browser' }), /用户现有.*Chrome|临时浏览器/)
  const result = await importReferenceVideoBrowserFile(root, { ...base, browserSession: 'existing-user-chrome' })
  assert.equal(result.provider, 'browser-session')
  assert.equal(result.content_id, '7677937301649142961')
  assert.equal(result.technical.width, 160)
  assert.equal(result.technical.height, 120)
  assert.ok(result.technical.duration_ms > 0)
  assert.match(result.source_ref.sha256, /^[0-9a-f]{64}$/)
  assert.deepEqual(await validateReferenceImportReceipts(root), ['src-douyin@v001'])
})

test('浏览器兜底拒绝伪装成 MP4 的网页响应且不登记来源', async () => {
  const root = await fixtureProject()
  const directory = await mkdtemp(resolve(tmpdir(), 'browser-session-invalid-video-'))
  const localFile = resolve(directory, 'download.mp4')
  await writeFile(localFile, '<html>login required</html>')
  await assert.rejects(importReferenceVideoBrowserFile(root, {
    input: 'https://www.douyin.com/video/7677937301649142961',
    localFile,
    sourceKey: 'src-douyin',
    versionId: 'v001',
    browserSession: 'existing-user-chrome',
    contentId: '7677937301649142961',
    rightsConfirmation: { confirmed: true, basis: 'authorized-reference' },
  }), /ffprobe|视频流|执行失败/)
  assert.deepEqual(JSON.parse(await readFile(resolve(root, 'source/manifest.json'), 'utf8')).sources, {})
})

test('链接导入 CLI 提供稳定自检入口', () => {
  const result = spawnSync(process.execPath, [resolve(import.meta.dirname, 'reference-video-import.mjs'), '--self-check'], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout.trim(), 'ok')
})

test('链接导入 CLI 将 403 以退出码 42 和无凭据 JSON 暴露给编排器', async () => {
  const root = await fixtureProject()
  const tools = await mkdtemp(resolve(tmpdir(), 'fake-yt-dlp-cli-403-'))
  const binary = resolve(tools, 'yt-dlp')
  await writeFile(binary, `#!/bin/sh
echo 'ERROR: HTTP Error 403: Forbidden token=do-not-leak' >&2
exit 1
`)
  await chmod(binary, 0o755)
  const result = spawnSync(process.execPath, [resolve(import.meta.dirname, 'reference-video-import.mjs'), 'import', root, 'https://www.douyin.com/video/7677937301649142961', 'src-douyin', 'v001', '--provider', 'yt-dlp', '--rights-basis', 'authorized-reference'], { encoding: 'utf8', env: { ...process.env, YT_DLP_BINARY: binary } })
  assert.equal(result.status, 42)
  const failure = JSON.parse(result.stderr)
  assert.equal(failure.error.code, 'YTDLP_HTTP_403_BROWSER_SESSION_REQUIRED')
  assert.equal(failure.error.fallback.session, 'existing-user')
  assert.doesNotMatch(result.stderr, /do-not-leak/)
})

test('导入收据必须绑定来源哈希并拒绝任何凭据字段', async () => {
  const root = await fixtureProject()
  const video = await videoFixture()
  const dtk = await dtkServer(video)
  try {
    const result = await importReferenceVideoUrl(root, { input: 'https://v.douyin.com/AbCd12/', sourceKey: 'src-reference-video', versionId: 'v001', provider: 'dtk', rightsConfirmation: { confirmed: true, basis: 'owned' }, dtk: { baseUrl: dtk.baseUrl, apiKey: 'secret-key' }, pollIntervalMs: 1 })
    assert.deepEqual(await validateReferenceImportReceipts(root), ['src-reference-video@v001'])
    const receiptPath = resolve(root, result.receipt_path)
    const receipt = JSON.parse(await readFile(receiptPath, 'utf8'))
    receipt.provider_metadata = { cookie: 'sensitive' }
    await writeFile(receiptPath, `${JSON.stringify(receipt)}\n`)
    await assert.rejects(validateReferenceImportReceipts(root), /凭据|密钥|字段/)
  } finally { await dtk.close() }
})
