import { execFile } from 'node:child_process'
import { access, mkdir, realpath } from 'node:fs/promises'
import { promisify } from 'node:util'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { probeMedia } from '../media-tools.mjs'

const runFile = promisify(execFile)

function configuredPaths() {
  const configuredRoot = process.env.MUSETALK_ROOT?.trim()
  if (!configuredRoot) throw new Error('MUSETALK_ROOT 未配置；插件不会自动下载 MuseTalk 或模型权重')
  const root = resolve(configuredRoot)
  const configuredEntry = process.env.MUSETALK_ENTRYPOINT?.trim() || 'scripts/inference.py'
  const entry = isAbsolute(configuredEntry) ? resolve(configuredEntry) : resolve(root, configuredEntry)
  const python = process.env.MUSETALK_PYTHON?.trim() || resolve(root, '.venv/bin/python')
  return { root, entry, python }
}

async function verifiedConfig() {
  const paths = configuredPaths()
  const root = await realpath(paths.root).catch(() => { throw new Error('MUSETALK_ROOT 不存在或不可访问') })
  const entry = await realpath(paths.entry).catch(() => { throw new Error('MUSETALK_ENTRYPOINT 不存在或不可访问') })
  const location = relative(root, entry)
  if (location.startsWith('..') || isAbsolute(location)) throw new Error('MUSETALK_ENTRYPOINT 必须位于 MUSETALK_ROOT 内')
  await access(paths.python).catch(() => { throw new Error('MUSETALK_PYTHON 不存在或不可执行') })
  return { root, entry, python: paths.python }
}

function validateRequest(input) {
  if (input.confirmed !== true) throw new Error('运行本地对口型前必须取得用户确认，并传 confirmed=true')
  if (input.operation !== 'lip-sync') throw new Error('MuseTalk 只支持 lip-sync 变换')
  if (input.face_selector?.mode !== 'single-visible-face') throw new Error('MuseTalk 仅允许唯一可见人脸镜头，禁止多人脸歧义推断')
  const start = Number(input.range?.start_ms), end = Number(input.range?.end_ms)
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start) throw new Error('lip-sync 必须提供有效的毫秒时间范围')
  if (!input.source_video_path || !input.source_audio_path || !input.output_path) throw new Error('MuseTalk 必须提供源视频、源音频和输出路径')
}

async function validateMedia(input) {
  const video = await realpath(resolve(input.source_video_path)).catch(() => { throw new Error('MuseTalk 源视频不存在') })
  const audio = await realpath(resolve(input.source_audio_path)).catch(() => { throw new Error('MuseTalk 源音频不存在') })
  const output = resolve(input.output_path)
  if (output === video || output === audio) throw new Error('MuseTalk 输出路径不得覆盖输入资产')
  const videoProbe = probeMedia(video), audioProbe = probeMedia(audio)
  if (!videoProbe.has_video) throw new Error('MuseTalk 源视频必须包含可解码的视频流')
  if (!audioProbe.has_audio) throw new Error('MuseTalk 源音频必须包含可解码的音频流')
  if (input.range.end_ms > videoProbe.duration_ms) throw new Error('lip-sync 时间范围不得超过源视频时长')
  await mkdir(dirname(output), { recursive: true })
  return { video, audio, output }
}

export const musetalk = {
  label: 'MuseTalk（本地）', credentialEnv: null,
  catalog: { image: [], video: [], audio: [], transform: ['lip-sync'] },
  capabilities: { text: false, image: false, video: false, audio: false, 'video.native-audio': false, 'transform.lip-sync': true, 'transform.video-inpaint': false, 'transform.video-upscale': false },
  configured() { try { configuredPaths(); return true } catch { return false } },
  async models() { return { provider: 'musetalk', transforms: ['lip-sync'], local: true, configured: this.configured() } },
  async testConnection() { await verifiedConfig() },
  async text() { throw new Error('MuseTalk 不提供文本生成') },
  async image() { throw new Error('MuseTalk 不提供图片生成') },
  async audio() { throw new Error('MuseTalk 不提供音频生成') },
  async submitVideo() { throw new Error('MuseTalk 不提供视频生成，只支持 lip-sync 变换') },
  async transform(input) {
    validateRequest(input)
    const [{ entry, python }, media] = await Promise.all([verifiedConfig(), validateMedia(input)])
    const args = [entry, '--video', media.video, '--audio', media.audio, '--output', media.output, '--start-ms', String(input.range.start_ms), '--end-ms', String(input.range.end_ms)]
    try {
      await runFile(python, args, { timeout: 20 * 60_000, maxBuffer: 4 * 1024 * 1024 })
    } catch (error) {
      throw new Error(`MUSETALK_EXECUTION_FAILED: ${String(error.stderr || error.message).slice(0, 1000)}`)
    }
    const outputProbe = probeMedia(media.output)
    if (!outputProbe.has_video || outputProbe.duration_ms <= 0) throw new Error('MuseTalk 输出不包含有效视频流')
    return { provider: 'musetalk', model: 'musetalk-1.5', status: 'completed', outputs: [{ path: media.output, media_type: 'video' }] }
  },
  async task() { throw new Error('MuseTalk 为同步本地 Provider，不存在远端任务') },
}

export async function selfCheck() {
  if (!musetalk.capabilities['transform.lip-sync'] || musetalk.capabilities.video) throw new Error('MuseTalk 能力声明无效')
}
