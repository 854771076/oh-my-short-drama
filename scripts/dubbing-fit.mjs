import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, extname, resolve } from 'node:path'

function plainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function finiteNumber(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label} 必须是有限数字`)
  return value
}

function integer(value, label, minimum = 0) {
  if (!Number.isInteger(value) || value < minimum) throw new Error(`${label} 必须是不小于 ${minimum} 的整数`)
  return value
}

function targetRange(contract) {
  const range = contract?.target_range
  if (!plainObject(range)) throw new Error('配音合同缺少目标区间')
  const start = integer(range.start_ms, 'dubbing_contract.target_range.start_ms')
  const end = integer(range.end_ms, 'dubbing_contract.target_range.end_ms')
  if (end <= start) throw new Error('dubbing_contract.target_range 无效')
  return { start_ms: start, end_ms: end }
}

function actualBounds(alignment) {
  if (!plainObject(alignment)) throw new Error('最终 alignment 必填')
  if (alignment.actual_start_ms !== undefined || alignment.actual_end_ms !== undefined) {
    return {
      start_ms: finiteNumber(alignment.actual_start_ms, 'alignment.actual_start_ms'),
      end_ms: finiteNumber(alignment.actual_end_ms, 'alignment.actual_end_ms'),
    }
  }
  const start = alignment.start_ms ?? alignment.actual_start
  const end = alignment.end_ms ?? alignment.actual_end
  const offset = alignment.timeline_offset_ms === undefined ? 0 : finiteNumber(alignment.timeline_offset_ms, 'alignment.timeline_offset_ms')
  return {
    start_ms: finiteNumber(start, 'alignment.start_ms') + offset,
    end_ms: finiteNumber(end, 'alignment.end_ms') + offset,
  }
}

export function evaluateDubbingFit({ contract, alignment, timeline_fps } = {}) {
  const range = targetRange(contract)
  const actual = actualBounds(alignment)
  if (actual.end_ms <= actual.start_ms) throw new Error('最终 alignment 发声边界无效')
  const fps = finiteNumber(timeline_fps, 'timeline_fps')
  if (fps <= 0) throw new Error('timeline_fps 必须大于 0')
  const toleranceMs = Math.ceil(1000 / fps)
  const startError = actual.start_ms - range.start_ms
  const endError = actual.end_ms - range.end_ms
  const passed = Math.abs(startError) <= toleranceMs && Math.abs(endError) <= toleranceMs
  return {
    passed,
    tolerance_ms: toleranceMs,
    start_error_ms: startError,
    end_error_ms: endError,
    // 该值仅供下一轮生成参数诊断，不能被解释为允许平移或裁断发声段。
    correction: passed ? null : { start_ms: -startError, end_ms: -endError },
  }
}

export function nextDubbingAttempt({ attempts, fit, adaptation } = {}) {
  if (!Array.isArray(attempts)) throw new Error('attempts 必须是数组')
  if (fit?.passed) return { state: 'ready-for-review' }
  if (attempts.length === 0) return { state: 'generate-original', attempt: 1 }
  if (attempts.length === 1) return { state: 'regenerate-parameters', attempt: 2 }
  if (attempts.length === 2 && adaptation?.approved === true) return { state: 'regenerate-adapted', attempt: 3 }
  return { state: 'blocked', reason: attempts.length >= 3 ? 'paid-generation-limit' : 'adaptation-not-approved' }
}

function pausePlan(contract) {
  const pauses = contract?.performance?.pause_plan
  if (!Array.isArray(pauses)) throw new Error('配音合同缺少停顿合同')
  return pauses.map((pause, index) => {
    if (!plainObject(pause) || typeof pause.after !== 'string' || !pause.after.trim() || !Number.isInteger(pause.duration_ms) || pause.duration_ms <= 0) throw new Error(`停顿合同[${index}] 无效`)
    return { after: pause.after, duration_ms: pause.duration_ms }
  })
}

function tempoLimit(contract) {
  const policyLimit = contract?.fit_policy?.max_post_tempo_percent
  if (typeof policyLimit !== 'number' || !Number.isFinite(policyLimit) || policyLimit < 0 || policyLimit > 3) throw new Error('配音合同的后处理 tempo 上限不得超过 3%')
  return policyLimit
}

function alignmentWords(alignment) {
  if (!plainObject(alignment) || !Array.isArray(alignment.words) || alignment.words.length === 0) throw new Error('插入静音必须提供最终 alignment 词级锚点')
  let previousEnd = -1
  return alignment.words.map((word, index) => {
    if (!plainObject(word) || typeof word.text !== 'string' || !word.text.trim()) throw new Error(`alignment.words[${index}] 无效`)
    const start = integer(word.start_ms, `alignment.words[${index}].start_ms`)
    const end = integer(word.end_ms, `alignment.words[${index}].end_ms`, 1)
    if (end <= start || start < previousEnd) throw new Error(`alignment.words[${index}] 时间边界无效`)
    previousEnd = end
    return { text: word.text, start_ms: start, end_ms: end }
  })
}

function pauseAnchors(declaredPauses, alignment) {
  const words = alignmentWords(alignment)
  const consumedWords = new Set()
  return declaredPauses.map((pause, pauseIndex) => {
    const matches = words
      .map((word, wordIndex) => ({ word, wordIndex }))
      .filter(({ word }) => word.text === pause.after)
    if (matches.length !== 1 || consumedWords.has(matches[0]?.wordIndex)) throw new Error(`停顿合同[${pauseIndex}] 缺少唯一 alignment 锚点`)
    consumedWords.add(matches[0].wordIndex)
    return { pause_index: pauseIndex, after: pause.after, at_ms: matches[0].word.end_ms }
  })
}

export function buildFinalizationPlan({ contract, alignment, tempo_percent = 0, silence = [] } = {}) {
  if (!plainObject(contract)) throw new Error('配音合同必填')
  const limit = tempoLimit(contract)
  const tempoPercent = finiteNumber(tempo_percent, 'tempo_percent')
  if (Math.abs(tempoPercent) > limit) throw new Error(`tempo 修正不得超过 ${limit}%`)
  if (!Array.isArray(silence)) throw new Error('silence 必须是数组')
  const declaredPauses = pausePlan(contract)
  const anchors = silence.length === 0 ? [] : pauseAnchors(declaredPauses, alignment)
  const consumedPauseIndexes = new Set()
  let previousAt = -1
  const normalizedSilence = silence.map((item, index) => {
    if (!plainObject(item) || !Number.isInteger(item.pause_index) || item.pause_index < 0) throw new Error(`silence[${index}] 无效`)
    const declared = declaredPauses[item.pause_index]
    const anchor = anchors[item.pause_index]
    if (!declared || !anchor) throw new Error(`silence[${index}] 不在停顿合同中`)
    if (consumedPauseIndexes.has(item.pause_index)) throw new Error(`silence[${index}] 重复锚点会重复消费同一停顿合同`)
    consumedPauseIndexes.add(item.pause_index)
    const duration = integer(item.duration_ms, `silence[${index}].duration_ms`, 1)
    if (duration > declared.duration_ms) throw new Error(`silence[${index}] 超出停顿合同声明时长`)
    const at = integer(item.at_ms, `silence[${index}].at_ms`, 1)
    if (at !== anchor.at_ms) throw new Error(`silence[${index}] 必须等于最终 alignment 锚点`)
    if (at <= previousAt) throw new Error('静音插入位置必须严格递增')
    previousAt = at
    return { pause_index: item.pause_index, after: declared.after, duration_ms: duration, at_ms: at }
  })
  const atempo = Number((1 + tempoPercent / 100).toFixed(6))
  if (atempo < 0.97 || atempo > 1.03) throw new Error('atempo 必须位于 0.97–1.03')
  return {
    contract: structuredClone(contract),
    ...(silence.length ? { alignment: structuredClone(alignment) } : {}),
    tempo_percent: tempoPercent,
    atempo,
    silence: normalizedSilence,
  }
}

function run(command, args, label) {
  const result = spawnSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${label}失败：${result.stderr?.trim() || result.status}`)
  return result.stdout || ''
}

function probeAudio(path) {
  const output = run('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration:stream=index,codec_type,duration,sample_rate,channels,channel_layout', '-of', 'json', path,
  ], 'FFprobe')
  let probe
  try {
    probe = JSON.parse(output)
  } catch {
    throw new Error('FFprobe 输出无效')
  }
  const audio = probe.streams?.find((stream) => stream.codec_type === 'audio')
  const containerDuration = Number(probe.format?.duration)
  const streamDuration = Number(audio?.duration)
  if (!audio || !Number.isFinite(containerDuration) || containerDuration <= 0 || !Number.isFinite(streamDuration) || streamDuration <= 0) throw new Error('FFprobe 未验证到有效音频流和容器时长')
  return {
    has_audio: true,
    duration_ms: Math.round(containerDuration * 1000),
    audio_stream_duration_ms: Math.round(streamDuration * 1000),
    sample_rate: Number(audio.sample_rate) || 48000,
    channel_layout: audio.channel_layout || (Number(audio.channels) === 1 ? 'mono' : 'stereo'),
  }
}

function seconds(milliseconds) {
  return (milliseconds / 1000).toFixed(6)
}

function finalizationFilter(plan, probe) {
  if (plan.silence.length === 0) return { option: '-af', value: `atempo=${plan.atempo}`, output: null }
  const tempoDuration = probe.audio_stream_duration_ms / plan.atempo
  for (const item of plan.silence) {
    if (item.at_ms >= tempoDuration) throw new Error('静音插入位置必须位于实际音频发声段内')
  }
  const count = plan.silence.length + 1
  const segments = []
  let start = 0
  for (const [index, item] of plan.silence.entries()) {
    segments.push(`[part${index}]atrim=start=${seconds(start)}:end=${seconds(item.at_ms)},asetpts=PTS-STARTPTS[segment${index}]`)
    start = item.at_ms
  }
  segments.push(`[part${count - 1}]atrim=start=${seconds(start)},asetpts=PTS-STARTPTS[segment${count - 1}]`)
  const silences = plan.silence.map((item, index) => `anullsrc=channel_layout=${probe.channel_layout}:sample_rate=${probe.sample_rate},atrim=duration=${seconds(item.duration_ms)},asetpts=N/SR/TB[silence${index}]`)
  const concatInputs = []
  for (let index = 0; index < count; index += 1) {
    concatInputs.push(`[segment${index}]`)
    if (index < plan.silence.length) concatInputs.push(`[silence${index}]`)
  }
  return {
    option: '-filter_complex',
    value: [`[0:a]atempo=${plan.atempo},asplit=${count}${Array.from({ length: count }, (_, index) => `[part${index}]`).join('')}`, ...segments, ...silences, `${concatInputs.join('')}concat=n=${concatInputs.length}:v=0:a=1[a]`].join(';'),
    output: '[a]',
  }
}

export function finalizeDubbingAudio({ input, output, plan } = {}) {
  if (typeof input !== 'string' || !input.trim() || typeof output !== 'string' || !output.trim()) throw new Error('input 和 output 必填')
  const source = resolve(input)
  const destination = resolve(output)
  if (source === destination) throw new Error('输出路径不得覆盖输入')
  if (extname(destination).toLowerCase() !== '.wav') throw new Error('最终配音必须输出 WAV')
  // 部分 FFmpeg 构建在 -n 拒绝覆盖时仍返回 0，必须先阻断已有成品以保留不可变候选。
  if (existsSync(destination)) throw new Error('输出路径已存在，收口不得覆盖已有音频')
  const normalizedPlan = buildFinalizationPlan(plan)
  const sourceProbe = probeAudio(source)
  const filter = finalizationFilter(normalizedPlan, sourceProbe)
  mkdirSync(dirname(destination), { recursive: true })
  const args = ['-nostdin', '-loglevel', 'error', '-n', '-i', source, filter.option, filter.value, '-map', filter.output || '0:a:0', '-c:a', 'pcm_s16le', destination]
  run('ffmpeg', args, 'FFmpeg 配音收口')
  const outputProbe = probeAudio(destination)
  return {
    output: destination,
    probe: { has_audio: outputProbe.has_audio, duration_ms: outputProbe.duration_ms, audio_stream_duration_ms: outputProbe.audio_stream_duration_ms },
    // 容器探测只能确认技术输出；是否合格仍必须由最终词级 alignment 判断。
    requires_alignment: true,
  }
}
