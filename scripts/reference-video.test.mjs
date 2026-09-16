import test from 'node:test'
import assert from 'node:assert/strict'
import { createReadStream } from 'node:fs'
import { createHash } from 'node:crypto'
import { access, copyFile, mkdir, mkdtemp, readFile, stat, symlink, unlink, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { prepareReferenceVideo, probeReferenceVideo, validatePreparedReferenceVideo } from './reference-video.mjs'

async function sha256(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

async function videoFixture(root) {
  const path = resolve(root, 'fixture.mp4')
  const result = spawnSync('ffmpeg', [
    '-nostdin', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'color=c=red:s=320x240:d=1:r=10',
    '-f', 'lavfi', '-i', 'color=c=blue:s=320x240:d=1:r=10',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2',
    '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0[v]',
    '-map', '[v]', '-map', '2:a', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', path,
  ], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  return path
}

async function solidVideoFixture(root) {
  const path = resolve(root, 'solid.mp4')
  const result = spawnSync('ffmpeg', [
    '-nostdin', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'color=c=red:s=320x240:d=3:r=10',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path,
  ], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  return path
}

async function projectFixture(kind = 'reference-video', fixture = videoFixture) {
  const root = await mkdtemp(resolve(tmpdir(), 'reference-video-'))
  const original = await fixture(root)
  const localPath = 'source/src-reference-video/v001.mp4'
  await mkdir(resolve(root, 'source/src-reference-video'), { recursive: true })
  await mkdir(resolve(root, '.short-drama'), { recursive: true })
  await copyFile(original, resolve(root, localPath))
  const digest = await sha256(resolve(root, localPath))
  const manifest = {
    version: 1,
    sources: {
      'src-reference-video': {
        key: 'src-reference-video', kind, selectedVersionId: 'v001',
        versions: [{ id: 'v001', localPath, sizeBytes: 1, sha256: digest, createdAt: '2026-09-16T00:00:00.000Z' }],
      },
    },
  }
  await writeFile(resolve(root, 'source/manifest.json'), `${JSON.stringify(manifest)}\n`)
  return { root, digest, original }
}

test('probe 返回稳定的视频与音频技术合同', async () => {
  const { original } = await projectFixture()
  const probe = await probeReferenceVideo(original)
  assert.equal(probe.width, 320)
  assert.equal(probe.height, 240)
  assert.equal(probe.has_audio, true)
  assert.ok(probe.duration_ms >= 1900 && probe.duration_ms <= 2100)
  assert.ok(probe.fps >= 9.9 && probe.fps <= 10.1)
})

test('prepare 绑定 selected 来源并落盘镜头、关键帧和音轨', async () => {
  const { root, digest } = await projectFixture()
  const prepared = await prepareReferenceVideo(root, { sourceKey: 'src-reference-video', versionId: 'v001', sceneThreshold: 0.2, maxShots: 10 })
  assert.equal(prepared.source_ref.sha256, digest)
  assert.ok(prepared.shots.length >= 2)
  assert.equal(prepared.shots[0].start_ms, 0)
  assert.ok(prepared.shots.every((shot) => shot.end_ms > shot.start_ms && shot.keyframe.local_path.startsWith('.short-drama/reference-video/')))
  await access(resolve(root, prepared.audio.local_path))
  const saved = JSON.parse(await readFile(resolve(root, '.short-drama/reference-video/prepared.json'), 'utf8'))
  assert.deepEqual(saved, prepared)
})

test('prepare 拒绝非视频来源、未选版本和来源哈希漂移', async () => {
  const document = await projectFixture('document')
  await assert.rejects(prepareReferenceVideo(document.root, { sourceKey: 'src-reference-video', versionId: 'v001' }), /reference-video/)

  const unselected = await projectFixture()
  const manifestPath = resolve(unselected.root, 'source/manifest.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  manifest.sources['src-reference-video'].selectedVersionId = null
  await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`)
  await assert.rejects(prepareReferenceVideo(unselected.root, { sourceKey: 'src-reference-video', versionId: 'v001' }), /selected/)

  const changed = await projectFixture()
  await writeFile(resolve(changed.root, 'source/src-reference-video/v001.mp4'), Buffer.from('changed'))
  await assert.rejects(prepareReferenceVideo(changed.root, { sourceKey: 'src-reference-video', versionId: 'v001' }), /SHA-256/)
})

test('prepared 校验重新计算关键帧和音轨哈希', async () => {
  const { root } = await projectFixture()
  const prepared = await prepareReferenceVideo(root, { sourceKey: 'src-reference-video', versionId: 'v001' })
  await validatePreparedReferenceVideo(root, prepared)
  await writeFile(resolve(root, prepared.shots[0].keyframe.local_path), Buffer.from('tampered'))
  await assert.rejects(validatePreparedReferenceVideo(root, prepared), /关键帧 SHA-256/)
})

test('prepare 在写入前拒绝符号链接输出目录', async () => {
  const { root } = await projectFixture()
  const outside = await mkdtemp(resolve(tmpdir(), 'reference-video-outside-'))
  const outputParent = resolve(root, '.short-drama/reference-video/src-reference-video')
  await mkdir(outputParent, { recursive: true })
  await symlink(outside, resolve(outputParent, 'v001'))

  await assert.rejects(
    prepareReferenceVideo(root, { sourceKey: 'src-reference-video', versionId: 'v001' }),
    /符号链接|项目目录/,
  )
  await assert.rejects(access(resolve(outside, 'frames/shot-001.png')))
})

test('prepare 在 ffmpeg 启动前拒绝文件级符号链接', async () => {
  const { root } = await projectFixture()
  const outside = resolve(await mkdtemp(resolve(tmpdir(), 'reference-video-file-link-')), 'outside.png')
  await writeFile(outside, Buffer.from('outside-original'))
  const frameRoot = resolve(root, '.short-drama/reference-video/src-reference-video/v001/frames')
  await mkdir(frameRoot, { recursive: true })
  await symlink(outside, resolve(frameRoot, 'shot-001.png'))

  await assert.rejects(
    prepareReferenceVideo(root, { sourceKey: 'src-reference-video', versionId: 'v001' }),
    /符号链接|项目目录/,
  )
  assert.equal((await readFile(outside)).toString(), 'outside-original')
})

test('prepare 中途失败时不改写上一份有效媒体和清单', async () => {
  const { root } = await projectFixture()
  const first = await prepareReferenceVideo(root, { sourceKey: 'src-reference-video', versionId: 'v001' })
  const framePath = resolve(root, first.shots[0].keyframe.local_path)
  const manifestPath = resolve(root, '.short-drama/reference-video/prepared.json')
  const oldManifest = await readFile(manifestPath, 'utf8')
  const oldTime = new Date('2000-01-01T00:00:00.000Z')
  await utimes(framePath, oldTime, oldTime)
  const audioPath = resolve(root, first.audio.local_path)
  const outside = resolve(await mkdtemp(resolve(tmpdir(), 'reference-video-atomic-')), 'outside.wav')
  await writeFile(outside, Buffer.from('outside'))
  await unlink(audioPath)
  await symlink(outside, audioPath)

  await assert.rejects(prepareReferenceVideo(root, { sourceKey: 'src-reference-video', versionId: 'v001' }), /符号链接/)
  assert.equal((await stat(framePath)).mtimeMs, oldTime.getTime())
  assert.equal(await readFile(manifestPath, 'utf8'), oldManifest)
  assert.equal((await readFile(outside)).toString(), 'outside')
})

test('prepare 对长单镜按固定间隔兜底并记录失败项', async () => {
  const { root } = await projectFixture('reference-video', solidVideoFixture)
  const prepared = await prepareReferenceVideo(root, {
    sourceKey: 'src-reference-video',
    versionId: 'v001',
    maxShotDurationMs: 1000,
  })
  assert.equal(prepared.shots.length, 3)
  assert.deepEqual(prepared.shots.map((shot) => shot.start_ms), [0, 1000, 2000])
  assert.deepEqual(prepared.failures, [])
})
