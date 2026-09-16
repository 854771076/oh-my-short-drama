const VERSION = /^v\d{3}$/
const SHA256 = /^[0-9a-f]{64}$/

function integer(value, label) {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${label} 必须是非负整数`)
  return value
}

function audioFor(input, lineIndex) {
  const audio = Array.isArray(input.audio) ? input.audio.find((item) => item.line_index === lineIndex) : input.audio
  if (!audio || typeof audio.asset_key !== 'string' || !VERSION.test(audio.version_id || '') || !SHA256.test(audio.sha256 || '')) throw new Error(`第 ${lineIndex} 行缺少最终音频绑定`)
  return audio
}

function contractFor(input, lineIndex) {
  const entry = input.contracts?.find((item) => item.line_index === lineIndex)
  if (!entry || !VERSION.test(entry.dubbing_contract_version || '') || !entry.dubbing_contract?.target_range) throw new Error(`第 ${lineIndex} 行缺少配音合同绑定`)
  return entry
}

function speechRange(line) {
  const words = Array.isArray(line.words) ? line.words : []
  const start = words.length ? words[0].start_ms : line.start_ms
  const end = words.length ? words.at(-1).end_ms : line.end_ms
  integer(start, `speech-timing 第 ${line.line_index} 行起点`)
  integer(end, `speech-timing 第 ${line.line_index} 行终点`)
  if (end <= start) throw new Error(`speech-timing 第 ${line.line_index} 行边界无效`)
  return { start, end }
}

export function buildSubtitlesFromAudio(input) {
  if (!input || !Number.isFinite(input.fps) || input.fps <= 0 || !Number.isInteger(input.timeline_end_ms) || input.timeline_end_ms <= 0) throw new Error('fps 和 timeline_end_ms 无效')
  if (!input.timing || !VERSION.test(input.timing.version_id || '') || !Array.isArray(input.timing.lines) || !input.timing.lines.length || !Array.isArray(input.contracts)) throw new Error('timing 与 contracts 必填')
  const frameMs = 1000 / input.fps
  const ranges = input.timing.lines.map(speechRange)
  const captions = []
  for (const [index, line] of input.timing.lines.entries()) {
    const contract = contractFor(input, line.line_index)
    const target = contract.dubbing_contract.target_range
    integer(target.start_ms, '合同窗口起点')
    integer(target.end_ms, '合同窗口终点')
    const audio = audioFor(input, line.line_index)
    const previousEnd = captions.at(-1)?.endMs ?? 0
    const nextSpeechStart = ranges[index + 1]?.start ?? input.timeline_end_ms
    const startMs = Math.max(target.start_ms, previousEnd, Math.round(ranges[index].start - frameMs * 4), 0)
    const endMs = Math.min(target.end_ms, nextSpeechStart, input.timeline_end_ms, Math.round(ranges[index].end + frameMs * 4))
    if (endMs <= startMs) throw new Error(`第 ${line.line_index} 行无法在合同窗口内安排不重叠字幕`)
    const text = contract.text ?? contract.content
    if (typeof text !== 'string' || !text.trim()) throw new Error(`第 ${line.line_index} 行字幕文本缺失`)
    const durationSeconds = (endMs - startMs) / 1000
    const cps = Array.from(text.replace(/\s/g, '')).length / durationSeconds
    const errors = []
    if (durationSeconds < 0.7) errors.push({ code: 'dwell_too_short', message: `停留时间 ${endMs - startMs}ms 少于 700ms` })
    if (cps > 12) errors.push({ code: 'cps_too_high', message: `阅读速度 ${cps.toFixed(1)} 字/秒超过 12` })
    captions.push({
      text,
      startMs,
      endMs,
      timestampMs: ranges[index].start,
      confidence: typeof line.confidence === 'number' ? line.confidence : 1,
      ...(contract.speaker ? { speaker: contract.speaker } : {}),
      ...(errors.length ? { errors } : {}),
      audio_binding: {
        asset_key: audio.asset_key,
        version_id: audio.version_id,
        sha256: audio.sha256,
        line_index: line.line_index,
        speech_timing_version: input.timing.version_id,
        dubbing_contract_version: contract.dubbing_contract_version,
      },
    })
  }
  return captions
}
