import { useEffect } from 'react'
import wsManager from '@/ws/manager'
import type { SymbolInfo } from '@/types'
import type { ThemeMode } from '@/store/terminal'

type ActiveTab = 'orders' | 'portfolio' | 'leaderboard' | 'mytrades'

export const KB_EVENT_ORDER_SIDE = 'kb:order-side'
export const KB_EVENT_ESCAPE = 'kb:escape'
export const KB_EVENT_CHART_FULLSCREEN = 'kb:chart-fullscreen'
export const KB_EVENT_CHARTS_UNDO = 'kb:charts-undo'
export const KB_EVENT_SHORTCUTS = 'kb:shortcuts'

interface UseKeyboardShortcutsOptions {
  symbols: SymbolInfo[]
  pathname: string
  goTo: (path: string) => void
  setSymbol: (s: string) => void
  setActiveTab: (tab: ActiveTab) => void
  theme: ThemeMode
  setTheme: (theme: ThemeMode) => void
}

/**
 * Global keyboard shortcuts for the trading terminal.
 *
 * Shortcuts (ignored when focus is inside an input/textarea/select):
 *
 *   G + T      -> go to /trade
 *   G + P      -> set tab='portfolio' and go to /trade
 *   G + O      -> set tab='orders' and go to /trade
 *   G + D      -> go to /dashboard
 *   Shift + D  -> toggle dark/light theme
 *   F          -> toggle chart fullscreen (trade/charts pages)
 *   Alt + Z    -> undo split in charts page
 *   B          → fire 'kb:order-side' custom event with detail='BUY'
 *   S          → fire 'kb:order-side' custom event with detail='SELL'
 *   1–9        → switch to symbols[n-1]
 *   ?          → show keyboard shortcuts modal
 *   Escape     → fire 'kb:escape' custom event
 */
export function useKeyboardShortcuts(
  {
    symbols,
    pathname,
    goTo,
    setSymbol,
    setActiveTab,
    theme,
    setTheme,
  }: UseKeyboardShortcutsOptions,
) {
  useEffect(() => {
    const G_CHORD_WINDOW_MS = 900
    let gChordArmed = false
    let gChordTimeoutId: number | null = null

    const clearGChord = () => {
      gChordArmed = false
      if (gChordTimeoutId !== null) {
        window.clearTimeout(gChordTimeoutId)
        gChordTimeoutId = null
      }
    }

    const armGChord = () => {
      clearGChord()
      gChordArmed = true
      gChordTimeoutId = window.setTimeout(() => {
        gChordArmed = false
        gChordTimeoutId = null
      }, G_CHORD_WINDOW_MS)
    }

    const handler = (e: KeyboardEvent) => {
      // Never hijack keypresses inside form fields
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if ((e.target as HTMLElement)?.isContentEditable) return
      if (e.repeat) return

      const key = e.key.toLowerCase()
      const isTradeRoute = pathname.startsWith('/trade')
      const isChartsRoute = pathname.startsWith('/charts')

      if (gChordArmed) {
        clearGChord()

        if ( key === 't' ) {
          e.preventDefault()
          goTo('/trade')
          return
        }


        if (key === 'p') {
          e.preventDefault()
          setActiveTab('portfolio')
          goTo('/trade')
          return
        }

        if (key === 'o') {
          e.preventDefault()
          setActiveTab('orders')
          goTo('/trade')
          return
        }

        if (key === 'd') {
          e.preventDefault()
          goTo('/dashboard')
          return
        }
      }

      if (key === 'g' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault()
        armGChord()
        return
      }

      if (key === 'd' && e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault()
        setTheme(theme === 'dark' ? 'light' : 'dark')
        return
      }

      if ((key === '?' || (key === '/' && e.shiftKey)) && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault()
        document.dispatchEvent(new CustomEvent(KB_EVENT_SHORTCUTS))
        return
      }

      if (key === 'f' && !e.ctrlKey && !e.metaKey && !e.altKey && (isTradeRoute || isChartsRoute)) {
        e.preventDefault()
        document.dispatchEvent(new CustomEvent(KB_EVENT_CHART_FULLSCREEN))
        return
      }

      if (key === 'z' && e.altKey && !e.ctrlKey && !e.metaKey && isChartsRoute) {
        e.preventDefault()
        document.dispatchEvent(new CustomEvent(KB_EVENT_CHARTS_UNDO))
        return
      }

      if (!isTradeRoute) {
        if (key === 'escape') {
          document.dispatchEvent(new CustomEvent(KB_EVENT_ESCAPE))
        }
        return
      }

      if (key === 'b') {
        e.preventDefault()
        document.dispatchEvent(new CustomEvent(KB_EVENT_ORDER_SIDE, { detail: 'BUY' }))
        return
      }

      if (key === 's') {
        e.preventDefault()
        document.dispatchEvent(new CustomEvent(KB_EVENT_ORDER_SIDE, { detail: 'SELL' }))
        return
      }

      if (key === 'escape') {
        document.dispatchEvent(new CustomEvent(KB_EVENT_ESCAPE))
        return
      }

      // 1-9 → switch symbol
      const num = parseInt(e.key, 10)
      if (!isNaN(num) && num >= 1 && num <= 9 && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        const sym = symbols[num - 1]
        if (sym) {
          e.preventDefault()
          setSymbol(sym.symbol)
          wsManager.changeSymbol(sym.symbol)
        }
      }
    }

    window.addEventListener('keydown', handler)
    return () => {
      clearGChord()
      window.removeEventListener('keydown', handler)
    }
  }, [goTo, pathname, setActiveTab, setSymbol, setTheme, symbols, theme])
}
