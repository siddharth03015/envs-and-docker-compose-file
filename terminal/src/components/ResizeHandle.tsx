'use client'
import { useRef } from 'react'

interface Props {
  direction: 'col' | 'row'
  onDelta: (delta: number) => void
  onCollapse?: () => void
  collapsed?: boolean
}

export default function ResizeHandle({ direction, onDelta, onCollapse, collapsed }: Props) {
  const dragging = useRef(false)
  const last = useRef(0)

  const onMouseDown = (e: React.MouseEvent) => {
    dragging.current = true
    last.current = direction === 'col' ? e.clientX : e.clientY
    e.preventDefault()

    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return
      const curr = direction === 'col' ? e.clientX : e.clientY
      onDelta(curr - last.current)
      last.current = curr
    }
    const onUp = () => {
      dragging.current = false
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    document.body.style.cursor = direction === 'col' ? 'col-resize' : 'row-resize'
    document.body.style.userSelect = 'none'
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const isCol = direction === 'col'

  // Pill arrow: for col handles show ‹/› depending on collapse; for row show ▲/▼
  const pillIcon = isCol
    ? (collapsed ? '›' : '‹')
    : (collapsed ? '▲' : '▼')

  return (
    <div
      className="rh-wrap"
      onMouseDown={onMouseDown}
      style={{
        flexShrink: 0,
        width:  isCol ? 8  : '100%',
        height: isCol ? '100%' : 8,
        cursor: isCol ? 'col-resize' : 'row-resize',
        background: 'transparent',
        position: 'relative',
        zIndex: 10,
      }}
    >
      {/* Visual line */}
      <div
        className="rh-line"
        style={{
          position: 'absolute',
          ...(isCol
            ? { top: 0, bottom: 0, left: 3, width: 2 }
            : { left: 0, right: 0,  top: 3, height: 2 }),
          background: 'var(--border-dim)',
          transition: 'background 0.15s',
          pointerEvents: 'none',
        }}
      />

      {/* Collapse pill — only show when onCollapse provided */}
      {onCollapse && (
        <div
          className="rh-pill"
          onMouseDown={e => e.stopPropagation()}
          onClick={e => { e.stopPropagation(); onCollapse() }}
          title={collapsed ? 'Expand' : 'Collapse'}
          style={{
            position: 'absolute',
            ...(isCol
              ? { top: '50%', left: '50%', transform: 'translate(-50%,-50%)', width: 16, height: 36 }
              : { left: '50%', top: '50%', transform: 'translate(-50%,-50%)', width: 36, height: 16 }),
            background: 'var(--bg-surface-elevated)',
            border: '1px solid var(--border-dim)',
            borderRadius: 4,
            cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 9, color: 'var(--text-muted)',
            zIndex: 11,
            transition: 'opacity 0.15s, background 0.15s, color 0.15s',
          }}
        >
          {pillIcon}
        </div>
      )}
    </div>
  )
}
