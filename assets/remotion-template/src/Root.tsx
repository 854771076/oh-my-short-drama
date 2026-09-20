import type React from 'react'
import { Composition } from 'remotion'
import { DramaTimeline } from './DramaTimeline'
import { timeline } from './load-timeline'

export const RemotionRoot: React.FC = () => {
  const durationInFrames = Math.round((timeline.duration_ms / 1000) * timeline.fps)
  return (
    <Composition
      id="DramaTimeline"
      component={DramaTimeline}
      durationInFrames={Math.max(durationInFrames, 1)}
      fps={timeline.fps}
      width={timeline.width}
      height={timeline.height}
    />
  )
}
