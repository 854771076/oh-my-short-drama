import type React from 'react'
import { AbsoluteFill, OffthreadVideo, staticFile, useCurrentFrame, useVideoConfig } from 'remotion'
import type { Segment } from '../load-timeline'
import { fadeInCurve, fadeOutCurve, msToFrame, segmentRate } from './transitions'

export const SegmentClip: React.FC<{
  seg: Segment
  fadeInFrames?: number
  fadeOutFrames?: number
  // 把源素材窗口向前平移若干“源帧”：淡化/溶解的垫底层用它跳过已播完的正片部分，
  // 只重放切点前最后一段尾帧，而不是从素材开头重新播放。
  trimBeforeOffsetFrames?: number
}> = ({ seg, fadeInFrames = 0, fadeOutFrames = 0, trimBeforeOffsetFrames = 0 }) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const opacity = fadeOutFrames > 0 ? fadeOutCurve(frame, fadeOutFrames) : fadeInFrames > 0 ? fadeInCurve(frame, fadeInFrames) : 1
  const trimBefore = msToFrame(seg.source_in_ms, fps) + trimBeforeOffsetFrames
  const trimAfter = msToFrame(seg.source_out_ms, fps)
  const playbackRate = segmentRate(seg)
  return (
    <AbsoluteFill style={{ opacity, backgroundColor: 'black' }}>
      <OffthreadVideo
        src={staticFile(seg.file)}
        trimBefore={trimBefore}
        trimAfter={trimAfter}
        playbackRate={playbackRate}
        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
      />
    </AbsoluteFill>
  )
}
