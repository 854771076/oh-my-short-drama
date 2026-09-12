#!/usr/bin/env node
// 宫格/分屏启发式检测：在降采样灰度帧上寻找位于分数位置、贯穿全幅且多帧持续的分割线。
// ponytail: 启发式而非语义识别，门框/地平线可能误报；所以只产生 grid_suspect 标记，强制人工复核，不自动判死。
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

// 编译后的视频提示词必须原样包含的反宫格声明（validator 按归一化子串匹配，模板必须原样引用）。
export const ANTI_GRID_CLAIM_ZH = '成片必须是单一连续的电影画面并铺满整个屏幕，严禁宫格、分屏、分框、拼贴、分割线、分镜编号或任何多画面构图'
export const ANTI_GRID_CLAIM_EN = 'The final video must be one single continuous cinematic frame filling the entire screen; no grid, split screen, panels, collage, dividing lines, panel numbers, or any multi-image composition'

// 整张多格分镜板直接作为语义参考时，必须额外原样包含的条款：格子=时间顺序，不是成片布局
export const PANEL_BOARD_CLAIM_ZH = '参考分镜板中的画格只表示动作的时间顺序与叙事关键帧，禁止把画格边框、分割线、编号或多格并排构图拍进成片'
export const PANEL_BOARD_CLAIM_EN = 'The panels in the reference storyboard indicate only the chronological order of actions and narrative keyframes; never render panel borders, dividing lines, numbers, or side-by-side multiple panels in the final video'

function normalize(text) { return String(text || '').replace(/[\s\p{P}\p{S}]/gu, '').toLowerCase() }
const ZH_MARK = normalize('单一连续的电影画面')
const ZH_BAN = normalize('宫格分屏分框')
const EN_MARK = normalize('single continuous cinematic frame')
const EN_BAN = normalize('grid split screen panels')

export function hasAntiGridClaim(prompt) {
  const text = normalize(prompt)
  return (text.includes(ZH_MARK) && text.includes(ZH_BAN.slice(0, 2))) || (text.includes(EN_MARK) && text.includes('gridsplitscreen'))
}

const PANEL_ZH_MARK = normalize('画格只表示动作的时间顺序')
const PANEL_ZH_BAN = normalize('画格边框')
const PANEL_EN_MARK = normalize('chronological order of actions')
const PANEL_EN_BAN = normalize('panel borders')

export function hasPanelBoardClaim(prompt) {
  const text = normalize(prompt)
  return (text.includes(PANEL_ZH_MARK) && text.includes(PANEL_ZH_BAN)) || (text.includes(PANEL_EN_MARK) && text.includes(PANEL_EN_BAN))
}

const CANONICAL = [0.5, 1 / 3, 2 / 3, 0.25, 0.75]
const TOLERANCE = 0.03 // 分数位置容差（缩放宽的比例）
const SCALE_WIDTH = 240

function stats(values) {
  const mean = values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length)
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(1, values.length)
  return { mean, std: Math.sqrt(variance) }
}

function globalThreshold(frame) {
  const { data, width, height } = frame
  const samples = []
  for (let y = 1; y < height - 1; y += 4) {
    for (let x = 1; x < width - 1; x += 4) {
      const index = y * width + x
      samples.push(Math.abs(data[index] - data[index - 1]), Math.abs(data[index] - data[index - width]))
    }
  }
  return Math.max(22, stats(samples).mean * 4)
}

// gutter 形态：分数位置上一条细而均匀、贯穿全幅的色带（亮缝或黑缝），至少一侧紧贴内容边沿。
// 黑缝邻接暗内容时单帧边沿很弱甚至缺失，所以：色带均匀多帧持续 + 侧翼边沿只需在部分帧出现。
const BAND_MAX_WIDTH = 10 // 240px 缩放下真实 gutter 约 1–10px
const FLAT_ALONG_STD = 20 // 沿幅方向允许的压缩噪声
const FLAT_ACROSS_STD = 12 // 带内各行之间允许的差异
const EDGE_SCALE = 0.7 // 侧翼边沿相对自适应阈值的放宽比例
const EDGE_SUPPORT = 0.5 // 单帧侧翼贯穿才算边沿证据

// 每个位置一行：沿幅均值/标准差，以及与前一行之间的横向差分（侧翼边沿）。
function lineProfiles(frame, orientation, threshold) {
  const { data, width, height } = frame
  const vertical = orientation === 'v'
  const span = vertical ? width : height
  const depth = vertical ? height : width
  const edgeThr = threshold * EDGE_SCALE
  const rows = []
  for (let p = 0; p < span; p += 1) {
    const values = []
    for (let d = 2; d < depth - 2; d += 1) {
      const index = vertical ? d * width + p : p * width + d
      values.push(data[index])
    }
    const { mean, std } = stats(values)
    let support = 0
    let edgeMean = 0
    if (p > 0) {
      const grads = values.map((value, i) => {
        const d = i + 2
        const index = vertical ? d * width + p : p * width + d
        const back = vertical ? index - 1 : index - width
        return Math.abs(data[index] - data[back])
      })
      support = grads.filter((value) => value >= edgeThr).length / grads.length
      edgeMean = stats(grads).mean
    }
    rows.push({ mean, std, edgeSupport: support, edgeStrength: edgeMean / threshold })
  }
  return rows
}

// 每个分数位置返回最像 gutter 的均匀色带（不管侧翼强弱，弱侧翼交给多帧聚合裁决）。
function scanBands(frame, orientation, threshold) {
  const vertical = orientation === 'v'
  const span = vertical ? frame.width : frame.height
  const rows = lineProfiles(frame, orientation, threshold)
  const found = []
  for (const fraction of CANONICAL) {
    const center = Math.round(fraction * span)
    const window = Math.max(1, Math.round(TOLERANCE * span))
    let best = null
    for (let start = Math.max(1, center - window); start <= center; start += 1) {
      for (let bandWidth = 1; bandWidth <= BAND_MAX_WIDTH; bandWidth += 1) {
        const end = start + bandWidth - 1
        if (end > Math.min(span - 2, center + window)) break
        const slice = rows.slice(start, end + 1)
        if (slice.some((row) => row.std > FLAT_ALONG_STD)) continue
        if (stats(slice.map((row) => row.mean)).std > FLAT_ACROSS_STD) continue
        const flanks = [start - 1, end + 1].filter((p) => p >= 1 && p < span - 1).map((p) => rows[p])
        const edge = flanks.reduce((a, b) => (b.edgeSupport + b.edgeStrength * 0.2 > a.edgeSupport + a.edgeStrength * 0.2 ? b : a), { edgeSupport: 0, edgeStrength: 0 })
        const candidate = { fraction, position: Math.round((start + end) / 2), bandWidth, flankSupport: edge.edgeSupport, flankStrength: edge.edgeStrength }
        if (!best || candidate.flankSupport + candidate.flankStrength * 0.2 > best.flankSupport + best.flankStrength * 0.2) best = candidate
      }
    }
    if (best) found.push(best)
  }
  return found
}

function edgeFrame(line) {
  return line.flankSupport >= EDGE_SUPPORT || line.flankStrength >= 1
}

function fractionLabel(fraction) {
  const hit = CANONICAL.find((value) => Math.abs(value - fraction) <= TOLERANCE)
  if (hit === 0.5) return '1/2'
  if (hit === 1 / 3) return '1/3'
  if (hit === 2 / 3) return '2/3'
  if (hit === 0.25) return '1/4'
  if (hit === 0.75) return '3/4'
  return null
}

export function detectGridInFrames(frames) {
  if (!Array.isArray(frames) || !frames.length) throw new Error('检测帧为空')
  const image = frames.length === 1
  // 每帧每方向只保留最强色带，按“方向@分数位置”分桶累计平坦帧与边沿帧。
  const buckets = new Map()
  for (const frame of frames) {
    const threshold = globalThreshold(frame)
    for (const [orientation, candidates] of [['vertical', scanBands(frame, 'v', threshold)], ['horizontal', scanBands(frame, 'h', threshold)]]) {
      const line = candidates.sort((a, b) => (b.flankSupport + b.flankStrength * 0.2) - (a.flankSupport + a.flankStrength * 0.2))[0]
      if (!line) continue
      const label = fractionLabel(line.fraction)
      if (!label) continue
      const key = `${orientation}@${label}`
      const bucket = buckets.get(key) || { key, fraction: line.fraction, flat: 0, edge: 0, support: 0, strength: 0 }
      bucket.flat += 1
      if (edgeFrame(line)) {
        bucket.edge += 1
        bucket.support += line.flankSupport
        bucket.strength += line.flankStrength
      }
      buckets.set(key, bucket)
    }
  }
  // 图片：单帧必须自带强边沿；视频：色带 >=75% 帧持续，且 >=25% 帧能看到侧翼边沿（黑缝兜底）。
  const lines = []
  for (const bucket of buckets.values()) {
    const flatRate = bucket.flat / frames.length
    const edgeRate = bucket.edge / frames.length
    const support = bucket.edge ? bucket.support / bucket.edge : 0
    const strength = bucket.edge ? bucket.strength / bucket.edge : 0
    const pass = image
      ? bucket.flat === 1 && support >= 0.85 && strength >= 1.5
      : flatRate >= 0.75 && edgeRate >= 0.25 && strength >= 1
    if (pass) lines.push({ line: bucket.key, frames: bucket.flat, edge_frames: bucket.edge, support: Number(support.toFixed(2)), strength: Number(strength.toFixed(2)) })
  }
  // 单轴命中只接受正中位（2 格）或 1/3+2/3（3 格）；其余必须双轴（真宫格）。
  const axes = new Set(lines.map((line) => line.line.split('@')[0]))
  let kept = []
  if (axes.size === 2) kept = lines
  else if (lines.some((line) => line.line.endsWith('@1/2'))) kept = lines.filter((line) => line.line.endsWith('@1/2'))
  else if (lines.some((line) => line.line.endsWith('@1/3')) && lines.some((line) => line.line.endsWith('@2/3'))) kept = lines
  const bothAxis = new Set(kept.map((line) => line.line.split('@')[0])).size === 2
  const strong = kept.some((line) => line.edge_frames / frames.length >= 0.75 && line.strength >= 1.8)
  return {
    detected: kept.length > 0,
    confidence: kept.length ? (bothAxis || strong || image) ? 'high' : 'medium' : 'none',
    hit_frames: Math.max(0, ...kept.map((line) => line.frames)),
    total_frames: frames.length,
    lines: kept.sort((a, b) => b.frames - a.frames),
  }
}

function run(command, args, encoding = 'utf8') {
  const result = spawnSync(command, args, { encoding, maxBuffer: 256 * 1024 * 1024 })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} 执行失败：${String(result.stderr || result.status)}`)
  return result
}

function probe(file) {
  const result = run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height:format=duration', '-of', 'json', file])
  const data = JSON.parse(result.stdout)
  const stream = data.streams?.[0]
  if (!stream?.width || !stream.height) throw new Error('无法读取媒体尺寸')
  return { width: stream.width, height: stream.height, duration: Number(data.format?.duration || 0) }
}

export function extractGrayFrames(file, { samples = 8 } = {}) {
  const input = resolve(file)
  const info = probe(input)
  const width = SCALE_WIDTH
  const height = Math.max(2, Math.round(info.height / info.width * width / 2) * 2)
  const isVideo = info.duration > 1.5
  const args = ['-nostdin', '-loglevel', 'error', '-i', input]
  if (isVideo) {
    const frames = Math.min(Math.max(2, samples), 12)
    args.push('-vf', `fps=${(frames / info.duration).toFixed(4)},scale=${width}:${height},format=gray`)
  } else args.push('-vf', `scale=${width}:${height},format=gray`, '-frames:v', '1')
  args.push('-f', 'rawvideo', '-')
  // 必须 Buffer 接收：rawvideo 按 utf8 解码会破坏像素（非法序列变 U+FFFD）
  const bytes = run('ffmpeg', args, 'buffer').stdout
  const frameSize = width * height
  const frames = []
  for (let offset = 0; offset + frameSize <= bytes.length; offset += frameSize) frames.push({ width, height, data: bytes.subarray(offset, offset + frameSize) })
  if (!frames.length) throw new Error('未提取到可检测帧')
  return frames
}

export function detectMedia(file, options) {
  return detectGridInFrames(extractGrayFrames(file, options || {}))
}

async function selfCheck() {
  const width = 240
  const height = 320
  const natural = Buffer.alloc(width * height)
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) natural[y * width + x] = Math.max(0, Math.min(255, 40 + x * 0.2 + y * 0.15 + ((x * 7 + y * 13) % 11)))
  const grid = Buffer.from(natural)
  for (let y = 0; y < height; y += 1) { grid[y * width + 120] = 248; grid[y * width + 121] = 248 }
  for (let x = 0; x < width; x += 1) grid[160 * width + x] = 248
  const imageHit = detectGridInFrames([{ width, height, data: grid }])
  if (!imageHit.detected || imageHit.confidence !== 'high' || imageHit.lines.length < 2) throw new Error('宫格图片自检失败')
  const clean = detectGridInFrames([{ width, height, data: natural }])
  if (clean.detected) throw new Error('自然画面误报宫格')
  // 黑色暗缝（只有一侧邻接亮内容）单轴正中位也必须命中
  const seam = Buffer.from(natural)
  for (let x = 0; x < width; x += 1) { seam[160 * width + x] = 0; seam[161 * width + x] = 0 }
  const seamHit = detectGridInFrames([{ width, height, data: seam }])
  if (!seamHit.detected || !seamHit.lines.some((line) => line.line === 'horizontal@1/2')) throw new Error('黑缝分割自检失败')
  const video = detectGridInFrames(Array.from({ length: 8 }, (_, index) => ({ width, height, data: index === 4 ? natural : grid })))
  if (!video.detected || video.lines[0].frames < 7) throw new Error('宫格视频持续性自检失败')
  if (!hasAntiGridClaim(`${ANTI_GRID_CLAIM_ZH}，其他内容`) || !hasAntiGridClaim(`intro. ${ANTI_GRID_CLAIM_EN}.`) || hasAntiGridClaim('成片是一个好看的宫格')) throw new Error('反宫格声明匹配自检失败')
  if (!hasPanelBoardClaim(`${PANEL_BOARD_CLAIM_ZH}。`) || !hasPanelBoardClaim(`${PANEL_BOARD_CLAIM_EN}.`) || hasPanelBoardClaim('画格表示构图参考，画格边框很好看') || hasPanelBoardClaim('the panels show a nice grid layout with borders')) throw new Error('分镜板条款匹配自检失败')
  console.log('ok')
}

async function main() {
  const [command, file] = process.argv.slice(2)
  if (command === '--self-check') return selfCheck()
  if (command !== 'detect' || !file) throw new Error('用法：grid-detect.mjs detect <图片或视频> [抽样帧数]')
  const samples = Number(process.argv[3] || 8)
  console.log(JSON.stringify(detectMedia(file, { samples: Number.isFinite(samples) ? samples : 8 }), null, 2))
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((error) => { console.error(error.message); process.exitCode = 1 })
