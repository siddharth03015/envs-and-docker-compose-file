'use client'
import { useCallback, useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useAuthModal } from '@/context/AuthModalContext'
import { useShortcutsModal } from '@/context/ShortcutsModalContext'
import { useMarketStore } from '@/store/market'
import { useTerminalStore } from '@/store/terminal'
import { useWS } from '@/hooks/useWS'
import { useKeyboardShortcuts, KB_EVENT_SHORTCUTS } from '@/hooks/useKeyboardShortcuts'
import { fetchSymbols } from '@/lib/market'
import wsManager from '@/ws/manager'

export default function AppBoot() {
  const { user } = useAuthModal()
  const { openModal: openShortcutsModal } = useShortcutsModal()
  const router = useRouter()
  const pathname = usePathname()

  const symbol = useTerminalStore(s => s.symbol)
  const theme = useTerminalStore(s => s.theme)
  const setTheme = useTerminalStore(s => s.setTheme)
  const setSymbol = useTerminalStore(s => s.setSymbol)
  const setActiveTab = useTerminalStore(s => s.setActiveTab)

  const symbols = useMarketStore(s => s.symbols)

  const goTo = useCallback((path: string) => {
    router.push(path)
  }, [router])

  useKeyboardShortcuts({
    symbols,
    pathname,
    goTo,
    setSymbol,
    setActiveTab,
    theme,
    setTheme,
  })

  // Listen for shortcuts modal event
  useEffect(() => {
    const handleShortcutsEvent = () => {
      openShortcutsModal()
    }
    document.addEventListener(KB_EVENT_SHORTCUTS, handleShortcutsEvent)
    return () => {
      document.removeEventListener(KB_EVENT_SHORTCUTS, handleShortcutsEvent)
    }
  }, [openShortcutsModal])

  // Derive token from user state — reactive to login/logout
  const token = user ? (typeof window !== 'undefined' ? localStorage.getItem('token') : null) : null

  useWS(token, symbol)

  // Disconnect WS on logout
  useEffect(() => {
    if (!user) wsManager.disconnect()
  }, [user])

  useEffect(() => {
    if (typeof document !== 'undefined') {
      const domTheme = document.documentElement.getAttribute('data-theme')
      if (domTheme === 'light' || domTheme === 'dark') {
        setTheme(domTheme)
        return
      }
    }

    const saved = typeof window !== 'undefined' ? localStorage.getItem('theme') : null
    setTheme(saved === 'light' ? 'light' : 'dark')
  }, [setTheme])

  useEffect(() => {
    const load = async () => {
      try { useMarketStore.getState().setSymbols(await fetchSymbols()) } catch { /* */ }
    }
    load()
    const id = setInterval(load, 30_000)
    return () => clearInterval(id)
  }, [])

  return null
}
