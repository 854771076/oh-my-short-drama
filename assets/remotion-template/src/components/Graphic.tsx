import type React from 'react'
import type { Graphic, SubtitleLayout } from '../load-timeline'

export const GraphicOverlay: React.FC<{ graphic: Graphic; layout: SubtitleLayout }> = ({ graphic, layout }) => {
  const hud: React.CSSProperties = {
    position: 'absolute',
    top: layout.marginV,
    left: '50%',
    transform: 'translateX(-50%)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: '10px 22px',
    background: 'rgba(0,0,0,0.45)',
    borderRadius: 8,
    color: '#FFFFFF',
    fontFamily: '"PingFang SC", "Microsoft YaHei", sans-serif',
  }
  const titleStyle: React.CSSProperties = { fontSize: Math.round(layout.fontSize * 0.6), color: '#D9D9D9', marginBottom: 4, letterSpacing: '0.04em' }
  const textStyle: React.CSSProperties = { fontSize: Math.round(layout.fontSize * 0.9), fontWeight: 700, fontFamily: '"SF Mono", "Menlo", monospace', letterSpacing: '0.06em' }
  if (graphic.type === 'phone-call' || graphic.type === 'countdown') {
    return (
      <div style={hud}>
        {graphic.title ? <div style={titleStyle}>{graphic.title}</div> : null}
        <div style={textStyle}>{graphic.text}</div>
      </div>
    )
  }
  // message: side HUD bubble, kept clear of faces and key props
  const bubble: React.CSSProperties = {
    position: 'absolute',
    top: layout.marginV,
    right: layout.marginH,
    maxWidth: '42%',
    padding: '10px 16px',
    background: 'rgba(0,0,0,0.5)',
    borderRadius: 12,
    color: '#FFFFFF',
    fontFamily: '"PingFang SC", "Microsoft YaHei", sans-serif',
  }
  return (
    <div style={bubble}>
      {graphic.title ? <div style={{ fontSize: Math.round(layout.fontSize * 0.55), color: '#BFBFBF', marginBottom: 2 }}>{graphic.title}</div> : null}
      <div style={{ fontSize: Math.round(layout.fontSize * 0.7), lineHeight: 1.25 }}>{graphic.text}</div>
    </div>
  )
}
