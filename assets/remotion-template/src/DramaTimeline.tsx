import type React from 'react'
import { AbsoluteFill, Sequence, useVideoConfig } from 'remotion'
import { timeline } from './load-timeline'
import { SegmentClip } from './components/SegmentVideo'
import { AudioTrackClip } from './components/AudioTrack'
import { SubtitleOverlay } from './components/Subtitle'
import { LabelOverlay } from './components/Label'
import { GraphicOverlay } from './components/Graphic'
import { msToFrame, segmentRate } from './components/transitions'

export const DramaTimeline: React.FC = () => {
  const { fps } = useVideoConfig()
  const layout = timeline.subtitle_layout

  const segments = timeline.segments.map((seg, index) => {
    const startFrame = msToFrame(seg.timeline_start_ms, fps)
    const endFrame = msToFrame(seg.timeline_end_ms, fps)
    const len = Math.max(endFrame - startFrame, 1)
    const prevTransition = timeline.segments[index - 1]?.transition
    const fadeInFrames = (prevTransition?.type === 'fade' || prevTransition?.type === 'dissolve') && prevTransition.duration_frames > 0 ? prevTransition.duration_frames : 0
    const out = seg.transition
    const outFrames = (out?.type === 'fade' || out?.type === 'dissolve') && out.duration_frames > 0 ? out.duration_frames : 0
    // 垫底层只重放切点前最后 outFrames 的尾帧：源窗口从 len-outFrames 处起，到 source_out 结束。
    const rate = segmentRate(seg) ?? 1
    const tailOffsetFrames = outFrames > 0 ? Math.max(Math.round((len - outFrames) * rate), 0) : 0
    return { seg, startFrame, len, fadeInFrames, outFrames, tailOffsetFrames }
  })

  return (
    <AbsoluteFill style={{ backgroundColor: 'black' }}>
      {segments.map(({ seg, startFrame, len, fadeInFrames }) => (
        <Sequence key={`${seg.file}-${seg.timeline_start_ms}`} from={startFrame} durationInFrames={len}>
          <SegmentClip seg={seg} fadeInFrames={fadeInFrames} />
        </Sequence>
      ))}
      {segments
        .filter((item) => item.outFrames > 0)
        .map(({ seg, startFrame, len, outFrames, tailOffsetFrames }) => (
          <Sequence key={`out-${seg.file}-${seg.timeline_start_ms}`} from={startFrame + len} durationInFrames={outFrames}>
            <SegmentClip seg={seg} fadeOutFrames={outFrames} trimBeforeOffsetFrames={tailOffsetFrames} />
          </Sequence>
        ))}
      {timeline.audio_tracks.map((track, index) => {
        const startFrame = msToFrame(track.timeline_start_ms, fps)
        const endFrame = msToFrame(track.timeline_end_ms, fps)
        return (
          <Sequence key={`audio-${index}`} from={startFrame} durationInFrames={Math.max(endFrame - startFrame, 1)}>
            <AudioTrackClip track={track} />
          </Sequence>
        )
      })}
      {timeline.subtitles.map((subtitle, index) => {
        const startFrame = msToFrame(subtitle.startMs, fps)
        const endFrame = msToFrame(subtitle.endMs, fps)
        return (
          <Sequence key={`sub-${index}`} from={startFrame} durationInFrames={Math.max(endFrame - startFrame, 1)}>
            <SubtitleOverlay subtitle={subtitle} layout={layout} />
          </Sequence>
        )
      })}
      {timeline.labels.map((label, index) => {
        const startFrame = msToFrame(label.startMs, fps)
        const endFrame = msToFrame(label.endMs, fps)
        return (
          <Sequence key={`label-${index}`} from={startFrame} durationInFrames={Math.max(endFrame - startFrame, 1)}>
            <LabelOverlay label={label} layout={layout} />
          </Sequence>
        )
      })}
      {timeline.graphics.map((graphic, index) => {
        const startFrame = msToFrame(graphic.startMs, fps)
        const endFrame = msToFrame(graphic.endMs, fps)
        return (
          <Sequence key={`graphic-${index}`} from={startFrame} durationInFrames={Math.max(endFrame - startFrame, 1)}>
            <GraphicOverlay graphic={graphic} layout={layout} />
          </Sequence>
        )
      })}
    </AbsoluteFill>
  )
}
