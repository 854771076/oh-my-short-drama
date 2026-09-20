import { Easing, interpolate } from 'remotion'

export const msToFrame = (ms: number, fps: number) => Math.round((ms / 1000) * fps)
export const dbToLinear = (db: number) => Math.pow(10, db / 20)

// 时间线把源素材窗口（source_in/out_ms）映射到时间线窗口（timeline_start/end_ms）；
// 两者时长不一致时按比例调整播放速率，保证整段源素材刚好铺满时间线窗口。
export const segmentRate = (seg: {
  source_in_ms: number
  source_out_ms: number
  timeline_start_ms: number
  timeline_end_ms: number
}): number | undefined => {
  const sourceSpan = seg.source_out_ms - seg.source_in_ms
  const timelineSpan = seg.timeline_end_ms - seg.timeline_start_ms
  return timelineSpan > 0 && Math.abs(sourceSpan / timelineSpan - 1) > 0.001 ? sourceSpan / timelineSpan : undefined
}

export function envelopeGain(points: { time_ms: number; gain_db: number }[] | undefined, timeMs: number): number {
  if (!points || points.length === 0) return 0
  const sorted = [...points].sort((a, b) => a.time_ms - b.time_ms)
  if (timeMs <= sorted[0].time_ms) return sorted[0].gain_db
  const last = sorted[sorted.length - 1]
  if (timeMs >= last.time_ms) return last.gain_db
  for (let i = 0; i < sorted.length - 1; i += 1) {
    const a = sorted[i]
    const b = sorted[i + 1]
    if (timeMs >= a.time_ms && timeMs <= b.time_ms) {
      const t = (timeMs - a.time_ms) / (b.time_ms - a.time_ms)
      return a.gain_db + (b.gain_db - a.gain_db) * t
    }
  }
  return sorted[0].gain_db
}

export const fadeInCurve = (frame: number, frames: number) =>
  frames > 0 ? interpolate(frame, [0, frames], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.ease) }) : 1

export const fadeOutCurve = (frame: number, frames: number) =>
  frames > 0 ? interpolate(frame, [0, frames], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.inOut(Easing.ease) }) : 1
