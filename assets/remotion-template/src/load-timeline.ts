import { timeline as raw } from './timeline.generated'

export type Transition = { type: string; duration_frames: number }
export type Segment = {
  file: string
  source_in_ms: number
  source_out_ms: number
  timeline_start_ms: number
  timeline_end_ms: number
  transition: Transition
}
export type EnvelopePoint = { time_ms: number; gain_db: number }
export type AudioTrack = {
  file: string
  role?: string
  source_in_ms: number
  source_out_ms: number
  timeline_start_ms: number
  timeline_end_ms: number
  volume_envelope?: EnvelopePoint[]
}
export type Subtitle = {
  text: string
  startMs: number
  endMs: number
  timestampMs: number
  speaker?: string
  speakers?: string[]
  show_speaker?: boolean
}
export type Label = { type: string; text: string; startMs: number; endMs: number }
export type Graphic = { type: string; title: string; text: string; startMs: number; endMs: number }
export type SubtitleLayout = { fontSize: number; speakerFontSize: number; marginH: number; marginV: number }

export type Timeline = {
  fps: number
  width: number
  height: number
  episode_key: string
  duration_ms: number
  subtitle_layout: SubtitleLayout
  segments: Segment[]
  audio_tracks: AudioTrack[]
  subtitles: Subtitle[]
  labels: Label[]
  graphics: Graphic[]
}

export const timeline = raw as Timeline
