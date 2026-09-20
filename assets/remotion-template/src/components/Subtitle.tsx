import type React from 'react'
import type { Subtitle, SubtitleLayout } from '../load-timeline'

const stripPunct = (line: string) => line.trim().replace(/[.。]+$/u, '')

const names = (subtitle: Subtitle): string[] => {
  if (Array.isArray(subtitle.speakers) && subtitle.speakers.length > 0) return subtitle.speakers
  return typeof subtitle.speaker === 'string' && subtitle.speaker.trim() ? [subtitle.speaker.trim()] : []
}

export const SubtitleOverlay: React.FC<{ subtitle: Subtitle; layout: SubtitleLayout }> = ({ subtitle, layout }) => {
  const lines = subtitle.text.split(/\r?\n/).map(stripPunct).filter(Boolean)
  if (lines.length === 0) return null
  const people = names(subtitle)
  const showSpeaker = subtitle.show_speaker === true && people.length === 1
  const dual = people.length >= 2
  const body = (dual ? lines.map((line) => `- ${line}`) : lines).join('\n')
  const base: React.CSSProperties = {
    fontFamily: '"PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif',
    fontWeight: 700,
    WebkitTextStroke: '2px rgba(0,0,0,0.92)',
    textShadow: '0 1px 2px rgba(0,0,0,0.4)',
    whiteSpace: 'pre-line',
    textAlign: 'center',
    lineHeight: 1.22,
    letterSpacing: '0.01em',
  }
  return (
    <div style={{ position: 'absolute', left: layout.marginH, right: layout.marginH, bottom: layout.marginV, display: 'flex', flexDirection: 'column', alignItems: 'center', pointerEvents: 'none' }}>
      {showSpeaker ? (
        <div style={{ ...base, fontSize: layout.speakerFontSize, color: '#D9D9D9', WebkitTextStroke: '1px rgba(0,0,0,0.7)', textShadow: 'none', marginBottom: Math.round(layout.fontSize * 0.08) }}>{people[0]}</div>
      ) : null}
      <div style={{ ...base, fontSize: layout.fontSize, color: '#FFFFFF' }}>{body}</div>
    </div>
  )
}
