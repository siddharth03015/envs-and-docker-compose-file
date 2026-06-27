'use client'
import { useTerminalStore } from '@/store/terminal'

export default function ToastStack() {
  const toasts     = useTerminalStore(s => s.toasts)
  const removeToast = useTerminalStore(s => s.removeToast)

  if (toasts.length === 0) return null

  return (
    <div style={{
      position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
      display: 'flex', flexDirection: 'column', gap: 8, pointerEvents: 'none',
    }}>
      {toasts.map(t => (
        <div key={t.id}
          onClick={() => removeToast(t.id)}
          style={{
            padding: '8px 14px', borderRadius: 4, fontSize: 12,
            fontFamily: 'var(--font-mono)', pointerEvents: 'auto',
            cursor: 'pointer', animation: 'fadeSlideUp 0.2s ease',
            background: t.ok ? 'rgba(52,211,153,0.12)' : 'rgba(248,113,113,0.12)',
            border: `1px solid ${t.ok ? 'rgba(52,211,153,0.3)' : 'rgba(248,113,113,0.3)'}`,
            color: t.ok ? '#34d399' : '#f87171',
            backdropFilter: 'blur(8px)',
          }}>
          {t.ok ? '✓' : '✕'} {t.text}
        </div>
      ))}
    </div>
  )
}
