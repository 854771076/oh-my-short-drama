const REASONS = {
  speech_intelligibility: 'speech-intelligibility-failed',
  speaker_identity: 'voice-identity-drift',
  narration_performance: 'narration-performance-failed',
  ambience_action_sync: 'native-ambience-failed',
  lip_sync: 'audio-sync-failed',
  technical_audio: 'audio-sync-failed',
  undeclared_music: 'native-ambience-failed',
}

function validRange(range) {
  return Number.isInteger(range?.start_ms) && Number.isInteger(range?.end_ms) && range.start_ms >= 0 && range.end_ms > range.start_ms
}

function overlaps(left, right) {
  return left.start_ms < right.end_ms && left.end_ms > right.start_ms
}

export function planAudioFallback(report, lines = []) {
  if (!report?.dimensions || !validRange(report.full_range)) throw new Error('原生音频报告缺少完整时间范围或审核维度')
  const replacements = []
  const seen = new Set()
  for (const [dimension, value] of Object.entries(report.dimensions)) {
    if (value?.passed !== false) continue
    const ranges = Array.isArray(value.ranges) && value.ranges.length ? value.ranges : [report.full_range]
    for (const range of ranges) {
      if (!validRange(range) || range.end_ms > report.full_range.end_ms) throw new Error(`原生音频 ${dimension} 失败范围无效`)
      const reason = REASONS[dimension] || 'audio-sync-failed'
      const identity = `${reason}:${range.start_ms}:${range.end_ms}`
      if (seen.has(identity)) continue
      seen.add(identity)
      replacements.push({ dimension, reason, range: { ...range }, line_indexes: lines.filter((line) => validRange(line.range) && overlaps(line.range, range)).map((line) => line.line_index) })
    }
  }
  const preserved_ranges = report.dimensions.ambience_action_sync?.passed === true ? [{ kind: 'native-ambience-action', range: { ...report.full_range } }] : []
  return { replacements, preserved_ranges }
}

