#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises'
import { dirname, relative, resolve, sep } from 'node:path'

const EPISODE = /^ep-\d{3}$/
const CANDIDATE = /^v\d{3}(?:-[a-z0-9][a-z0-9-]*)?$/
const hash = (value) => createHash('sha256').update(value).digest('hex')

async function inside(root, path) {
  const [rootReal, pathReal] = await Promise.all([realpath(root), realpath(path)])
  if (pathReal !== rootReal && !pathReal.startsWith(`${rootReal}${sep}`)) throw new Error('候选输入必须位于项目目录内')
  return pathReal
}

async function files(root) {
  const entries = await readdir(root, { withFileTypes: true })
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = resolve(root, entry.name)
    return entry.isDirectory() ? files(path) : [path]
  }))
  return nested.flat().sort()
}

async function record(root, path, snapshotPath = null) {
  const content = await readFile(path)
  const info = await stat(path)
  return { path: relative(root, path), ...(snapshotPath ? { snapshot_path: relative(root, snapshotPath) } : {}), sizeBytes: info.size, sha256: hash(content) }
}

export async function freezeCandidate(rootArg, episode, candidate, timelineArg, remotionArg) {
  if (!EPISODE.test(episode) || !CANDIDATE.test(candidate)) throw new Error('episode/candidate 必须为 ep-001 与 v001-name 格式')
  const root = await realpath(resolve(rootArg))
  const timelinePath = await inside(root, resolve(timelineArg))
  const remotion = await inside(root, resolve(remotionArg))
  const timelineContent = await readFile(timelinePath)
  const timeline = JSON.parse(timelineContent)
  if (timeline.episode_key !== episode || !Array.isArray(timeline.segments) || !Array.isArray(timeline.subtitles)) throw new Error('候选时间线与目标分集不一致或合同不完整')
  const actualDuration = timeline.segments.at(-1)?.timeline_end_ms
  if (!Number.isInteger(timeline.duration_ms) || timeline.duration_ms !== actualDuration) throw new Error('timeline.duration_ms 必须等于最后片段的 timeline_end_ms')
  const target = resolve(root, 'editing', episode, 'candidates', candidate)
  await mkdir(dirname(target), { recursive: true })
  await mkdir(target)
  const frozenTimeline = resolve(target, 'timeline.json')
  await writeFile(frozenTimeline, timelineContent, { flag: 'wx' })

  const explicit = ['package.json', 'package-lock.json', 'remotion.config.ts'].map((name) => resolve(remotion, name))
  const present = []
  for (const path of explicit) { try { await stat(path); present.push(path) } catch { /* 跳过尚未生成的 package-lock.json */ } }
  const rendererFiles = (await files(resolve(remotion, 'src'))).concat(present)
  const renderer = []
  for (const source of rendererFiles) {
    const local = relative(remotion, source)
    const destination = resolve(target, 'renderer', local)
    await mkdir(dirname(destination), { recursive: true })
    await writeFile(destination, await readFile(source), { flag: 'wx' })
    renderer.push(await record(root, source, destination))
  }

  const mediaPaths = [...timeline.segments.map((item) => item.file), ...(timeline.audio_tracks || []).map((item) => item.file)]
  const media = []
  for (const item of [...new Set(mediaPaths)].sort()) media.push(await record(root, await inside(root, resolve(remotion, 'public', item))))
  const manifest = {
    version: 1,
    episode_key: episode,
    candidate,
    frozen_at: new Date().toISOString(),
    timeline: await record(root, timelinePath, frozenTimeline),
    renderer,
    media,
  }
  const manifestPath = resolve(target, 'render-input.json')
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' })
  return manifestPath
}

export async function verifyCandidate(rootArg, episode, candidate) {
  if (!EPISODE.test(episode) || !CANDIDATE.test(candidate)) throw new Error('episode/candidate 格式无效')
  const root = await realpath(resolve(rootArg))
  const manifestPath = resolve(root, 'editing', episode, 'candidates', candidate, 'render-input.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  for (const item of [manifest.timeline, ...manifest.renderer, ...manifest.media]) {
    const path = resolve(root, item.snapshot_path || item.path)
    const content = await readFile(path)
    if (content.length !== item.sizeBytes || hash(content) !== item.sha256) throw new Error(`候选输入已变化：${item.snapshot_path || item.path}`)
  }
  return manifest
}

async function main() {
  const [command, root, episode, candidate, timeline, remotion] = process.argv.slice(2)
  if (command === '--self-check') {
    if (!EPISODE.test('ep-001') || !CANDIDATE.test('v001-review') || CANDIDATE.test('../bad')) throw new Error('格式门禁自检失败')
    return console.log('ok')
  }
  if (command === 'create') return console.log(await freezeCandidate(root, episode, candidate, timeline, remotion))
  if (command === 'verify') return console.log(JSON.stringify(await verifyCandidate(root, episode, candidate)))
  throw new Error('用法：freeze-edit-candidate.mjs create <项目> <ep-001> <v001-name> <timeline> <remotion目录> | verify <项目> <ep-001> <v001-name>')
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((error) => { console.error(error.message); process.exitCode = 1 })
