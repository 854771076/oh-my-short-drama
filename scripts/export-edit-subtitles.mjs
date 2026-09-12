#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

// 电影字幕常量：6–12 字/秒是创作目标，导出只拦截读不完的上限；短台词为反应镜头停留不拦
const MIN_DWELL_MS = 700
const MAX_CPS = 12
const MAX_LINES = 2

const pad = (value, length = 2) => String(value).padStart(length, '0')
const clock = (ms, separator) => {
  const hours = Math.floor(ms / 3600000)
  const minutes = Math.floor((ms % 3600000) / 60000)
  const seconds = Math.floor((ms % 60000) / 1000)
  const fraction = ms % 1000
  const hour = separator === ',' ? pad(hours) : String(hours)
  return `${hour}:${pad(minutes)}:${pad(seconds)}${separator}${separator === ',' ? pad(fraction, 3) : pad(Math.round(fraction / 10), 2)}`
}
const charCount = (text) => Array.from(text.replace(/\s/g, '')).length

// 布局按时间线实际分辨率缩放：字号约画面高 1/28，边距约 8%，每行容量按字面推进估算
export function subtitleLayout({ width, height }) {
  const fontSize = Math.round(height / 28)
  const marginH = Math.round(width * 0.08)
  const maxCharsPerLine = Math.min(20, Math.floor((width - marginH * 2) / fontSize))
  return { fontSize, speakerFontSize: Math.round(fontSize * 0.56), marginH, marginV: Math.round(height * 0.08), maxCharsPerLine }
}

const speakerNames = (item) => {
  if (Array.isArray(item.speakers)) return item.speakers
  return typeof item.speaker === 'string' && item.speaker.trim() ? [item.speaker.trim()] : []
}

// 逐条归一化并报错：结构性问题只登记不抛异常，保证一次导出列出全部问题
function normalizeCaption(item, index, fps, layout, totalMs) {
  const n = index + 1
  const errors = []
  const warnings = []
  const fail = (code, message) => errors.push({ index: n, code, message })
  if (!item || typeof item !== 'object') return { errors: [{ index: n, code: 'invalid_item', message: `字幕 ${n} 不是对象` }], warnings }
  if ('show_speaker' in item && typeof item.show_speaker !== 'boolean') fail('invalid_show_speaker', `字幕 ${n} show_speaker 必须是布尔值`)
  let names = []
  try {
    names = speakerNames(item)
    if ('speakers' in item && (!Array.isArray(item.speakers) || item.speakers.length === 0 || item.speakers.length > 2 || item.speakers.some((name) => typeof name !== 'string' || !name.trim()))) fail('invalid_speakers', `字幕 ${n} speakers 必须是 1–2 个非空字符串`)
    if ('speaker' in item && (typeof item.speaker !== 'string' || !item.speaker.trim())) fail('invalid_speaker', `字幕 ${n} speaker 必须是非空字符串`)
  } catch { fail('invalid_speaker', `字幕 ${n} speaker 无效`) }
  const validTime = Number.isInteger(item.startMs) && item.startMs >= 0 && Number.isInteger(item.endMs) && item.endMs > item.startMs
  if (!Number.isInteger(item.startMs) || item.startMs < 0) fail('invalid_start', `字幕 ${n} startMs 必须是非负整数`)
  if (!Number.isInteger(item.endMs) || item.endMs <= (Number.isInteger(item.startMs) ? item.startMs : -1)) fail('invalid_end', `字幕 ${n} endMs 必须是晚于 startMs 的整数`)
  const lines = typeof item.text === 'string'
    ? item.text.split(/\r?\n/).map((line) => line.trim().replace(/[.。]+$/u, '')).filter(Boolean)
    : []
  if (typeof item.text !== 'string' || !item.text.trim() || lines.length === 0) fail('empty_text', `字幕 ${n} 正文为空`)
  else {
    // 句末句号（。/.）在电影字幕中省略；ASR 文本里的花括号会被误判为 ASS 覆写，转全角
    if (lines.length > MAX_LINES) fail('too_many_lines', `字幕 ${n} 最多 ${MAX_LINES} 行，实际 ${lines.length} 行，需在时间线写语义换行`)
    for (const line of lines) {
      if (Array.from(line).length > layout.maxCharsPerLine) fail('line_too_long', `字幕 ${n} 单行 ${Array.from(line).length} 字超过 ${layout.maxCharsPerLine} 字上限：${line}`)
    }
  }
  if (validTime) {
    const durationMs = item.endMs - item.startMs
    if (durationMs < MIN_DWELL_MS) fail('dwell_too_short', `字幕 ${n} 停留 ${durationMs}ms 短于 ${MIN_DWELL_MS}ms`)
    if (lines.length > 0) {
      const cps = charCount(lines.join('')) / (durationMs / 1000)
      if (cps > MAX_CPS) fail('cps_too_high', `字幕 ${n} 阅读速度 ${cps.toFixed(1)} 字/秒超过 ${MAX_CPS}，需等义压缩或延长时间`)
    }
    if (Number.isInteger(totalMs) && item.endMs > totalMs) fail('beyond_timeline', `字幕 ${n} 结束点 ${item.endMs}ms 超出时间线总时长 ${totalMs}ms`)
    // 入出点应对齐帧栅格，方便按语音起止留 2–4 帧余量；不对齐只警告，由人工复核修时间线
    const frameMs = 1000 / fps
    const onGrid = (ms) => Math.abs(ms - Math.round(ms / frameMs) * frameMs) <= 1
    if (!onGrid(item.startMs) || !onGrid(item.endMs)) warnings.push({ index: n, code: 'off_frame_grid', message: `字幕 ${n} 入出点未对齐 ${fps}fps 帧栅格，复核 2–4 帧余量` })
  }
  return {
    index: n,
    startMs: validTime ? item.startMs : null,
    endMs: validTime ? item.endMs : null,
    names,
    dual: names.length >= 2,
    show: item.show_speaker === true,
    lines: lines.map((line) => line.replaceAll('{', '｛').replaceAll('}', '｝')),
    errors,
    warnings,
  }
}

export function renderSubtitles(timeline) {
  if (!timeline || typeof timeline !== 'object') throw new Error('timeline 必填')
  for (const field of ['fps', 'width', 'height']) if (!Number.isInteger(timeline[field]) || timeline[field] <= 0) throw new Error(`timeline.${field} 必须是正整数`)
  if (!Array.isArray(timeline.subtitles)) throw new Error('timeline.subtitles[] 必填')
  const layout = subtitleLayout(timeline)
  const totalMs = Array.isArray(timeline.segments) && timeline.segments.length > 0 && Number.isInteger(timeline.segments.at(-1).timeline_end_ms) ? timeline.segments.at(-1).timeline_end_ms : null
  const captions = timeline.subtitles.map((item, index) => normalizeCaption(item, index, timeline.fps, layout, totalMs))
  for (let i = 1; i < captions.length; i += 1) {
    const previous = captions[i - 1]
    const current = captions[i]
    if (previous.startMs !== null && current.startMs !== null && current.startMs < previous.endMs) {
      current.errors.push({ index: current.index, code: 'overlap', message: `字幕 ${current.index} 与字幕 ${previous.index} 时间重叠（连续对白按说话人切换，首尾相接）` })
    }
  }
  const errors = captions.flatMap((caption) => caption.errors)
  const warnings = captions.flatMap((caption) => caption.warnings)
  const renderable = captions.filter((caption) => caption.startMs !== null && caption.lines.length > 0)

  const srt = renderable.map((caption, index) => {
    const speakerMeta = caption.names.length > 0 ? `${caption.names.join('／')}\n` : ''
    const body = (caption.dual ? caption.lines.map((line) => `- ${line}`) : caption.lines).join('\n')
    return `${index + 1}\n${clock(caption.startMs, ',')} --> ${clock(caption.endMs, ',')}\n${speakerMeta}${body}\n`
  }).join('\n')

  const events = renderable.map((caption) => {
    const body = (caption.dual ? caption.lines.map((line) => `- ${line}`) : caption.lines).join('\\N')
    // 电影式：默认不显示说话人；show_speaker 仅用于画外音/电话等需要辨识的镜头，双人对白带“- ”不带名条
    const speakerPrefix = caption.show && !caption.dual && caption.names.length === 1 ? `{\\rSpeaker}${caption.names[0]}{\\rDialogue}\\N` : ''
    return `Dialogue: 0,${clock(caption.startMs, '.')},${clock(caption.endMs, '.')},Dialogue,,0,0,0,,${speakerPrefix}${body}`
  }).join('\n')
  const ass = `[Script Info]\nScriptType: v4.00+\nPlayResX: ${timeline.width}\nPlayResY: ${timeline.height}\nScaledBorderAndShadow: yes\nWrapStyle: 0\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Dialogue,PingFang SC,${layout.fontSize},&H00FFFFFF,&H00FFFFFF,&H00000000,&H64000000,-1,0,0,0,100,100,0,0,1,2,1,2,${layout.marginH},${layout.marginH},${layout.marginV},1\nStyle: Speaker,PingFang SC,${layout.speakerFontSize},&H00D9D9D9,&H00FFFFFF,&H00000000,&H64000000,0,0,0,0,100,100,0,0,1,1,0,2,${layout.marginH},${layout.marginH},${layout.marginV},1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n${events}\n`
  return { srt, ass, errors, warnings }
}

async function main() {
  const [command, timelineArg, srtArg, assArg] = process.argv.slice(2)
  if (command === '--self-check') {
    const vertical = renderSubtitles({ fps: 24, width: 1080, height: 1920, segments: [{ timeline_end_ms: 10000 }], subtitles: [
      { text: '你先走。\n我掩护。', startMs: 240, endMs: 1680, timestampMs: 240, confidence: 1, speaker: '林晚' },
      { text: '知道了。', startMs: 1680, endMs: 2640, timestampMs: 1680, confidence: 1, speaker: '周潜', show_speaker: true },
      { text: '走吧。\n嗯。', startMs: 2640, endMs: 3600, timestampMs: 2640, confidence: 1, speakers: ['林晚', '周潜'], show_speaker: true },
    ] })
    if (vertical.errors.length) throw new Error(`电影字幕自检误报：${JSON.stringify(vertical.errors)}`)
    if (vertical.ass.includes('林晚')) throw new Error('默认应隐藏说话人')
    if (!vertical.srt.includes('林晚\n你先走')) throw new Error('SRT 必须保留说话人元数据')
    if (!/PlayResX: 1080\nPlayResY: 1920/.test(vertical.ass) || !vertical.ass.includes('Style: Dialogue,PingFang SC,69,')) throw new Error('ASS 分辨率或字号未按时间线缩放')
    if (!vertical.ass.includes('Style: Speaker,PingFang SC,39,')) throw new Error('说话人名条字号错误')
    if (!vertical.ass.includes('周潜{\\rDialogue}') || !vertical.ass.includes('- 走吧\\N- 嗯')) throw new Error('show_speaker 名条或双人对白格式错误')
    if (vertical.ass.includes('林晚{\\r') ) throw new Error('双人对白不得再叠加名条')
    if (vertical.ass.includes('。') || vertical.srt.includes('。')) throw new Error('句末句号必须省略')
    if (!vertical.ass.includes('BorderStyle') || !/Dialogue,PingFang SC,69,.*?,1,2,1,2,/.test(vertical.ass)) throw new Error('必须是细描边软投影的无底盒样式')
    const bad = renderSubtitles({ fps: 24, width: 1080, height: 1920, subtitles: [
      { text: '一二三四五六七八九十一二三四五六七', startMs: 0, endMs: 500, timestampMs: 0, confidence: 1 },
      { text: '短', startMs: 100, endMs: 200, timestampMs: 100, confidence: 1 },
      { text: '重叠', startMs: 150, endMs: 900, timestampMs: 150, confidence: 1 },
    ] })
    const codes = bad.errors.map((error) => error.code).sort()
    for (const code of ['line_too_long', 'dwell_too_short', 'cps_too_high', 'overlap']) if (!codes.includes(code)) throw new Error(`缺少逐字报错：${code}`)
    const landscape = renderSubtitles({ fps: 25, width: 1920, height: 1080, subtitles: [{ text: '横屏测试', startMs: 0, endMs: 800, timestampMs: 0, confidence: 1 }] })
    if (!landscape.ass.includes('PlayResX: 1920') || !landscape.ass.includes('Style: Dialogue,PingFang SC,39,')) throw new Error('横屏布局错误')
    const warned = renderSubtitles({ fps: 24, width: 1080, height: 1920, subtitles: [{ text: '帧偏移', startMs: 100, endMs: 900, timestampMs: 100, confidence: 1 }] })
    if (warned.errors.length || !warned.warnings.some((warning) => warning.code === 'off_frame_grid')) throw new Error('帧栅格应对齐警告而非报错')
    const injected = renderSubtitles({ fps: 24, width: 1080, height: 1920, subtitles: [{ text: '别{\\an8}跑', startMs: 0, endMs: 800, timestampMs: 0, confidence: 1 }] })
    if (injected.errors.length || !injected.ass.includes('｛\\an8｝') || injected.ass.includes('{\\an8}')) throw new Error('ASS 覆写注入未被转义')
    return console.log('ok')
  }
  if (command !== 'export' || !timelineArg || !srtArg || !assArg) throw new Error('用法：export-edit-subtitles.mjs export <timeline.json> <output.srt> <output.ass>')
  const result = renderSubtitles(JSON.parse(await readFile(resolve(timelineArg), 'utf8')))
  if (result.errors.length > 0) {
    console.error(JSON.stringify({ phase: 'rejected', errors: result.errors }, null, 2))
    process.exitCode = 1
    return
  }
  await writeFile(resolve(srtArg), result.srt, { flag: 'wx' })
  await writeFile(resolve(assArg), result.ass, { flag: 'wx' })
  console.log(JSON.stringify({ srt: resolve(srtArg), ass: resolve(assArg), warnings: result.warnings }))
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((error) => { console.error(error.message); process.exitCode = 1 })
