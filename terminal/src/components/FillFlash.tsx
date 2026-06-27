'use client'
import { useEffect, useState } from 'react'
import wsManager from '@/ws/manager'
import { WS_EVT } from '@/constants'

export default function FillFlash() {
  const [flash, setFlash] = useState<'buy' | 'sell' | null>(null)

  useEffect(() => {
    const onFill = (p: unknown) => {
      const msg = p as { payload?: { side?: string } }
      const side = (msg.payload?.side ?? '').toUpperCase()
      setFlash(side === 'BUY' ? 'buy' : 'sell')
      setTimeout(() => setFlash(null), 500)
    }
    wsManager.on(WS_EVT.ORDER_FILL, onFill)
    return () => wsManager.off(WS_EVT.ORDER_FILL, onFill)
  }, [])

  if (!flash) return null

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 9000, pointerEvents: 'none',
        background: flash === 'buy'
          ? 'rgba(52,211,153,0.07)'
          : 'rgba(248,113,113,0.07)',
        animation: 'fillFlash 0.5s ease-out forwards',
      }}
    />
  )
}
