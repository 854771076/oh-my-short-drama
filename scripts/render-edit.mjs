#!/usr/bin/env node
import { access, copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, extname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { subtitleLayout } from './export-edit-subtitles.mjs'

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const TEMPLATE_DIR = resolve(pluginRoot, 'assets/remotion-template')
const EPISODE = /^ep-\d{3}$/

async function exists(path) { try { await access(path); return true } catch { return false } }

function run(command, args, cwd) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit' })
    child.on('error', rejectPromise)
    child.on('exit', (code) => (code === 0 ? resolvePromise() : rejectPromise(new Error(`${command} ${args.join(' ')} 退出码 ${code}`))))
  })
}

async function copyTree(srcDir, destDir) {
  await mkdir(destDir, { recursive: true })
  for (const entry of await readdir(srcDir, { withFileTypes: true })) {
    const src = resolve(srcDir, entry.name)
    const dest = resolve(destDir, entry.name)
    if (entry.isDirectory()) await copyTree(src, dest)
    else await copyFile(src, dest)
  }
}

async function loadSelectedTimeline(root, episode) {
  const path = resolve(root, 'editing', episode, 'timeline.json')
  if (!await exists(path)) throw new Error(`缺少已落盘时间线：${path}（先 running editing-store.mjs put-timeline）`)
  const timeline = JSON.parse(await readFile(path, 'utf8'))
  if (timeline.episode_key !== episode || !Array.isArray(timeline.segments) || timeline.segments.length === 0) throw new Error('时间线 episode_key 或 segments 无效')
  return timeline
}

function resolveMedia(assets, assetKey, versionId) {
  const version = assets.assets?.[assetKey]?.versions?.find((item) => item.id === versionId)
  if (!version?.localPath) throw new Error(`无法解析媒体 ${assetKey}@${versionId}，请确认资产账本中已选版且存在 localPath`)
  return version.localPath
}

async function scaffold(root, episode) {
  if (!EPISODE.test(episode)) throw new Error('episode 必须为 ep-001 格式')
  const timeline = await loadSelectedTimeline(root, episode)
  const assets = JSON.parse(await readFile(resolve(root, '.short-drama/assets.json'), 'utf8'))
  const remotionDir = resolve(root, 'editing', episode, 'remotion')
  const publicDir = resolve(remotionDir, 'public')

  await copyTree(TEMPLATE_DIR, remotionDir)
  await mkdir(resolve(publicDir, 'media'), { recursive: true })

  const mediaFiles = []
  const copyMedia = async (localPath) => {
    const source = resolve(root, localPath)
    if (!await exists(source)) throw new Error(`媒体文件不存在：${source}`)
    const key = `media/${String(mediaFiles.length + 1).padStart(3, '0')}${extname(source) || '.mp4'}`
    await copyFile(source, resolve(publicDir, key))
    mediaFiles.push(key)
    return key
  }

  const renderSegments = []
  for (const seg of timeline.segments) {
    renderSegments.push({
      file: await copyMedia(resolveMedia(assets, seg.asset_key, seg.version_id)),
      source_in_ms: seg.source_in_ms,
      source_out_ms: seg.source_out_ms,
      timeline_start_ms: seg.timeline_start_ms,
      timeline_end_ms: seg.timeline_end_ms,
      transition: seg.transition,
    })
  }

  const renderAudio = []
  for (const track of timeline.audio_tracks || []) {
    renderAudio.push({
      file: await copyMedia(resolveMedia(assets, track.asset_key, track.version_id)),
      role: track.role,
      source_in_ms: track.source_in_ms,
      source_out_ms: track.source_out_ms,
      timeline_start_ms: track.timeline_start_ms,
      timeline_end_ms: track.timeline_end_ms,
      volume_envelope: track.volume_envelope || [],
    })
  }

  const rendererTimeline = {
    fps: timeline.fps,
    width: timeline.width,
    height: timeline.height,
    episode_key: timeline.episode_key,
    duration_ms: timeline.segments.at(-1).timeline_end_ms,
    subtitle_layout: subtitleLayout({ width: timeline.width, height: timeline.height }),
    segments: renderSegments,
    audio_tracks: renderAudio,
    subtitles: (timeline.subtitles || []).map((item) => {
      const out = { text: item.text, startMs: item.startMs, endMs: item.endMs, timestampMs: item.timestampMs }
      if (item.speaker !== undefined) out.speaker = item.speaker
      if (item.speakers !== undefined) out.speakers = item.speakers
      if (item.show_speaker !== undefined) out.show_speaker = item.show_speaker
      return out
    }),
    labels: (timeline.labels || []).map((item) => ({ type: item.type, text: item.text, startMs: item.startMs, endMs: item.endMs })),
    graphics: (timeline.graphics || []).map((item) => ({ type: item.type, title: item.title, text: item.text, startMs: item.startMs, endMs: item.endMs })),
    mix: timeline.mix || null,
  }

  await writeFile(resolve(publicDir, 'timeline.json'), `${JSON.stringify(rendererTimeline, null, 2)}\n`)
  await writeFile(resolve(remotionDir, 'src/timeline.generated.ts'), `// Auto-generated by render-edit.mjs scaffold — do not edit.\nexport const timeline = ${JSON.stringify(rendererTimeline, null, 2)}\n`)
  return { remotionDir, timelinePath: resolve(publicDir, 'timeline.json'), segments: renderSegments.length, audioTracks: renderAudio.length, mediaFiles: mediaFiles.length }
}

async function render(root, episode, args) {
  if (!EPISODE.test(episode)) throw new Error('episode 必须为 ep-001 格式')
  const remotionDir = resolve(root, 'editing', episode, 'remotion')
  if (!await exists(remotionDir)) throw new Error('缺少 Remotion 工程，先运行 scaffold')
  const preview = args.includes('--preview')
  const outIndex = args.indexOf('--out')
  const out = outIndex >= 0 ? resolve(args[outIndex + 1]) : resolve(root, 'delivery', episode, preview ? 'review.mp4' : 'final.mp4')
  await mkdir(dirname(out), { recursive: true })
  if (!await exists(resolve(remotionDir, 'node_modules'))) await run('npm', ['install', '--no-audit', '--no-fund'], remotionDir)
  if (preview) {
    await run('npx', ['remotion', 'studio', '--no-open'], remotionDir)
    return out
  }
  await run('npx', ['remotion', 'render', 'DramaTimeline', out], remotionDir)
  return out
}

async function loudness(root, episode, args) {
  if (!EPISODE.test(episode)) throw new Error('episode 必须为 ep-001 格式')
  const input = resolve(args[0] || resolve(root, 'delivery', episode, 'final.mp4'))
  const output = resolve(args[1] || resolve(root, 'delivery', episode, 'final-loudnorm.mp4'))
  let lufs = -15
  try {
    const timeline = JSON.parse(await readFile(resolve(root, 'editing', episode, 'remotion/public/timeline.json'), 'utf8'))
    if (typeof timeline.mix?.target_lufs === 'number') lufs = timeline.mix.target_lufs
  } catch { /* 用默认 -15 LUFS */ }
  await run('ffmpeg', ['-y', '-i', input, '-af', `loudnorm=I=${lufs}:TP=-1:LRA=11`, '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', output])
  return output
}

async function selfCheck() {
  const required = [
    'package.json', 'tsconfig.json', 'remotion.config.ts', '.gitignore',
    'src/index.ts', 'src/Root.tsx', 'src/load-timeline.ts', 'src/timeline.generated.ts', 'src/DramaTimeline.tsx',
    'src/components/SegmentVideo.tsx', 'src/components/AudioTrack.tsx', 'src/components/Subtitle.tsx', 'src/components/Label.tsx', 'src/components/Graphic.tsx', 'src/components/transitions.ts',
  ]
  for (const file of required) if (!await exists(resolve(TEMPLATE_DIR, file))) throw new Error(`模板缺失：assets/remotion-template/${file}`)
  const generated = await readFile(resolve(TEMPLATE_DIR, 'src/timeline.generated.ts'), 'utf8')
  if (!/export const timeline = \{/.test(generated)) throw new Error('模板 placeholder timeline 无效')
  const layout = subtitleLayout({ width: 1920, height: 1080 })
  if (!layout.fontSize || !layout.speakerFontSize || !layout.marginH || !layout.marginV) throw new Error('subtitleLayout 自检失败')
  return 'ok'
}

async function main() {
  const [command, rootArg, episode, ...args] = process.argv.slice(2)
  if (command === '--self-check') return console.log(await selfCheck())
  if (!rootArg) throw new Error('用法：render-edit.mjs scaffold|render|loudness <项目目录> <ep-001> [...]')
  const root = resolve(rootArg)
  if (command === 'scaffold') return console.log(JSON.stringify(await scaffold(root, episode), null, 2))
  if (command === 'render') return console.log(await render(root, episode, args))
  if (command === 'loudness') return console.log(await loudness(root, episode, args))
  throw new Error('用法：render-edit.mjs scaffold <项目> <ep> | render <项目> <ep> [--preview] [--out <path>] | loudness <项目> <ep> [输入] [输出]')
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((error) => { console.error(error.message); process.exitCode = 1 })
