import type React from 'react'
import { Audio, staticFile, useCurrentFrame, useVideoConfig } from 'remotion'
import type { AudioTrack } from '../load-timeline'
import { dbToLinear, envelopeGain, msToFrame } from './transitions'

export const AudioTrackClip: React.FC<{ track: AudioTrack }> = ({ track }) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const timeMs = track.timeline_start_ms + (frame / fps) * 1000
  const gainDb = envelopeGain(track.volume_envelope, timeMs)
  const trimBefore = msToFrame(track.source_in_ms, fps)
  const trimAfter = msToFrame(track.source_out_ms, fps)
  return <Audio src={staticFile(track.file)} trimBefore={trimBefore} trimAfter={trimAfter} volume={dbToLinear(gainDb)} />
}
