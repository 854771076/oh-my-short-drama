import type React from 'react'
import type { Label, SubtitleLayout } from '../load-timeline'

export const LabelOverlay: React.FC<{ label: Label; layout: SubtitleLayout }> = ({ label, layout }) => {
  const font = { fontFamily: '"PingFang SC", "Microsoft YaHei", sans-serif' }
  const tag: React.CSSProperties = {
    ...font,
    position: 'absolute',
    top: layout.marginV,
    left: layout.marginH,
    fontSize: Math.round(layout.fontSize * 0.62),
    color: '#FFFFFF',
    background: 'rgba(0,0,0,0.55)',
    padding: '6px 14px',
    borderRadius: 4,
    letterSpacing: '0.04em',
  }
  const centered: React.CSSProperties = {
    ...font,
    position: 'absolute',
    top: '50%',
    left: layout.marginH,
    right: layout.marginH,
    transform: 'translateY(-50%)',
    textAlign: 'center',
    color: '#FFFFFF',
    fontSize: Math.round(layout.fontSize * 1.5),
    fontWeight: 700,
    WebkitTextStroke: '2px rgba(0,0,0,0.92)',
    textShadow: '0 1px 3px rgba(0,0,0,0.4)',
  }
  switch (label.type) {
    case 'character':
    case 'scene':
      return <div style={tag}>{label.text}</div>
    case 'title':
      return <div style={centered}>{label.text}</div>
    case 'chapter':
      return <div style={{ ...tag, left: undefined, right: undefined, width: '100%', textAlign: 'center', top: layout.marginV }}>{label.text}</div>
    case 'credit':
      return <div style={{ ...font, position: 'absolute', bottom: layout.marginV, left: layout.marginH, right: layout.marginH, textAlign: 'center', color: '#BFBFBF', fontSize: Math.round(layout.fontSize * 0.6) }}>{label.text}</div>
    default:
      return null
  }
}
