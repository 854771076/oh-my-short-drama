#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const pad = (value, length = 2) => String(value).padStart(length, '0')
const clock = (ms, separator) => {
  const hours = Math.floor(ms / 3600000)
  const minutes = Math.floor((ms % 3600000) / 60000)
  const seconds = Math.floor((ms % 60000) / 1000)
  const fraction = ms % 1000
  const hour = separator === ',' ? pad(hours) : String(hours)
  return `${hour}:${pad(minutes)}:${pad(seconds)}${separator}${separator === ',' ? pad(fraction, 3) : pad(Math.round(fraction / 10), 2)}`
}

export function renderSubtitles(timeline) {
  if (!Array.isArray(timeline?.subtitles)) throw new Error('timeline.subtitles[] 必填')
  const subtitles = timeline.subtitles.map((item, index) => {
    if (typeof item.text !== 'string' || !item.text.trim() || !Number.isInteger(item.startMs) || !Number.isInteger(item.endMs) || item.endMs <= item.startMs) throw new Error(`字幕 ${index + 1} 时间或正文无效`)
    return item
  })
  const srt = subtitles.map((item, index) => `${index + 1}\n${clock(item.startMs, ',')} --> ${clock(item.endMs, ',')}\n${item.speaker ? `${item.speaker}\n` : ''}${item.text}\n`).join('\n')
  const events = subtitles.map((item) => {
    const speaker = item.speaker ? `{\\fs24\\c&H00CABDB0&}${item.speaker}{\\rDialogue}\\N` : ''
    return `Dialogue: 0,${clock(item.startMs, '.')},${clock(item.endMs, '.')},Dialogue,,0,0,0,,${speaker}${item.text.replaceAll('\n', '\\N')}`
  }).join('\n')
  const ass = `[Script Info]\nScriptType: v4.00+\nPlayResX: 1080\nPlayResY: 1920\nWrapStyle: 0\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Dialogue,PingFang SC,46,&H00FFFFFF,&H00FFFFFF,&HCC000000,&H66000000,-1,0,0,0,100,100,1,0,1,2,1,1,90,90,180,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n${events}\n`
  return { srt, ass }
}

async function main() {
  const [command, timelineArg, srtArg, assArg] = process.argv.slice(2)
  if (command === '--self-check') {
    const result = renderSubtitles({ subtitles: [{ text: '第一行\n第二行', startMs: 1234, endMs: 3456, speaker: '甲' }] })
    if (!result.srt.includes('00:00:01,234 --> 00:00:03,456') || !result.ass.includes('0:00:01.23,0:00:03.46') || !result.ass.includes('甲')) throw new Error('字幕导出自检失败')
    return console.log('ok')
  }
  if (command !== 'export' || !timelineArg || !srtArg || !assArg) throw new Error('用法：export-edit-subtitles.mjs export <timeline.json> <output.srt> <output.ass>')
  const result = renderSubtitles(JSON.parse(await readFile(resolve(timelineArg), 'utf8')))
  await writeFile(resolve(srtArg), result.srt, { flag: 'wx' })
  await writeFile(resolve(assArg), result.ass, { flag: 'wx' })
  console.log(JSON.stringify({ srt: resolve(srtArg), ass: resolve(assArg) }))
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((error) => { console.error(error.message); process.exitCode = 1 })
