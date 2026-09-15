import test from 'node:test'
import assert from 'node:assert/strict'
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { musetalk } from './musetalk.mjs'

const media = (path, kind) => {
  const args = kind === 'video'
    ? ['-f', 'lavfi', '-i', 'color=c=blue:s=320x180:r=24:d=1', '-c:v', 'mpeg4', '-pix_fmt', 'yuv420p']
    : ['-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:a', 'pcm_s16le']
  const result = spawnSync('ffmpeg', ['-nostdin', '-loglevel', 'error', ...args, '-y', path], { encoding: 'utf8' })
  if (result.error || result.status !== 0) throw new Error(result.stderr || '媒体夹具生成失败')
}

test('MuseTalk 只接受唯一可见脸的 lip-sync', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'short-drama-musetalk-'))
  const previous = { root: process.env.MUSETALK_ROOT, python: process.env.MUSETALK_PYTHON, entry: process.env.MUSETALK_ENTRYPOINT }
  try {
    const entry = resolve(root, 'fake.mjs')
    await writeFile(entry, `import { copyFile } from 'node:fs/promises'\nconst value=(name)=>process.argv[process.argv.indexOf(name)+1]\nawait copyFile(value('--video'),value('--output'))\n`)
    await chmod(entry, 0o755)
    const video = resolve(root, 'source.mp4'), audio = resolve(root, 'speech.wav'), output = resolve(root, 'output.mp4')
    media(video, 'video'); media(audio, 'audio')
    process.env.MUSETALK_ROOT = root
    process.env.MUSETALK_PYTHON = process.execPath
    process.env.MUSETALK_ENTRYPOINT = 'fake.mjs'
    const result = await musetalk.transform({ operation: 'lip-sync', source_video_path: video, source_audio_path: audio, output_path: output, range: { start_ms: 0, end_ms: 900 }, face_selector: { mode: 'single-visible-face' }, confirmed: true })
    assert.equal(result.outputs[0].path, output)
    await assert.rejects(musetalk.transform({ operation: 'video-upscale', confirmed: true }), /lip-sync/)
    await assert.rejects(musetalk.transform({ operation: 'lip-sync', face_selector: { mode: 'multiple' }, confirmed: true }), /唯一可见人脸/)
  } finally {
    if (previous.root === undefined) delete process.env.MUSETALK_ROOT; else process.env.MUSETALK_ROOT = previous.root
    if (previous.python === undefined) delete process.env.MUSETALK_PYTHON; else process.env.MUSETALK_PYTHON = previous.python
    if (previous.entry === undefined) delete process.env.MUSETALK_ENTRYPOINT; else process.env.MUSETALK_ENTRYPOINT = previous.entry
    await rm(root, { recursive: true, force: true })
  }
})
