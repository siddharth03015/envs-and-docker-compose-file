'use client'
import { useEffect, useRef, useState } from 'react'

/**
 * Smoothly animates from the previous value to the new value.
 * Uses a simple exponential ease-out via requestAnimationFrame.
 */
export function useAnimatedNumber(target: number, duration = 600): number {
  const [display, setDisplay] = useState(target)
  const from    = useRef(target)
  const startTs = useRef<number | null>(null)
  const rafId   = useRef<number | null>(null)

  useEffect(() => {
    const startVal = from.current
    const diff     = target - startVal
    if (Math.abs(diff) < 0.001) return

    startTs.current = null
    if (rafId.current !== null) cancelAnimationFrame(rafId.current)

    const step = (ts: number) => {
      if (startTs.current === null) startTs.current = ts
      const elapsed = ts - startTs.current
      const progress = Math.min(elapsed / duration, 1)
      // ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3)
      const val = startVal + diff * eased
      setDisplay(val)
      if (progress < 1) {
        rafId.current = requestAnimationFrame(step)
      } else {
        from.current = target
        rafId.current = null
      }
    }

    rafId.current = requestAnimationFrame(step)
    return () => {
      if (rafId.current !== null) cancelAnimationFrame(rafId.current)
    }
  }, [target, duration])

  return display
}
