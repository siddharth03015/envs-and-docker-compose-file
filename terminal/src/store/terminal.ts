'use client'
import { create } from 'zustand'
import type { Interval } from '@/constants'
import { DEFAULT_SYMBOL } from '@/constants'
import type { Order, Portfolio, PnLPoint, LeaderboardEntry, MyTrade, Toast } from '@/types'

type ActiveTab = 'orders' | 'portfolio' | 'leaderboard' | 'mytrades'
export type ThemeMode = 'dark' | 'light'

const THEME_STORAGE_KEY = 'theme'

function normalizeTheme(value: string | null | undefined): ThemeMode {
  return value === 'light' ? 'light' : 'dark'
}

function getInitialTheme(): ThemeMode {
  if (typeof document !== 'undefined') {
    const domTheme = document.documentElement.getAttribute('data-theme')
    if (domTheme === 'light' || domTheme === 'dark') return domTheme
  }
  if (typeof window !== 'undefined') {
    return normalizeTheme(window.localStorage.getItem(THEME_STORAGE_KEY))
  }
  return 'dark'
}

function applyTheme(theme: ThemeMode) {
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-theme', theme)
  }
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme)
  }
}

interface TerminalState {
  symbol:      string
  interval:    Interval
  activeTab:   ActiveTab
  theme:       ThemeMode

  openOrders:  Order[]
  portfolio:   Portfolio | null
  pnlHistory:  PnLPoint[]
  leaderboard: LeaderboardEntry[]
  myTrades:    MyTrade[]
  toasts:      Toast[]

  setSymbol:      (s: string) => void
  setInterval:    (i: Interval) => void
  setActiveTab:   (t: ActiveTab) => void
  setTheme:       (t: ThemeMode) => void
  setOpenOrders:  (o: Order[]) => void
  removeOrder:    (id: string) => void
  setPortfolio:   (p: Portfolio) => void
  setPnLHistory:  (h: PnLPoint[]) => void
  setLeaderboard: (l: LeaderboardEntry[]) => void
  setMyTrades:    (t: MyTrade[]) => void
  pushToast:      (text: string, ok: boolean) => void
  removeToast:    (id: string) => void
}

export const useTerminalStore = create<TerminalState>((set) => ({
  symbol:      DEFAULT_SYMBOL,
  interval:    '1s',
  activeTab:   'orders',
  theme:       getInitialTheme(),

  openOrders:  [],
  portfolio:   null,
  pnlHistory:  [],
  leaderboard: [],
  myTrades:    [],
  toasts:      [],

  setSymbol:      (symbol)      => set({ symbol }),
  setInterval:    (interval)    => set({ interval }),
  setActiveTab:   (activeTab)   => set({ activeTab }),
  setTheme:       (theme)       => {
    applyTheme(theme)
    set({ theme })
  },
  setOpenOrders:  (openOrders)  => set({ openOrders }),
  removeOrder:    (id)          => set(s => ({ openOrders: s.openOrders.filter(o => o.id !== id) })),
  setPortfolio:   (portfolio)   => set({ portfolio }),
  setPnLHistory:  (pnlHistory)  => set({ pnlHistory }),
  setLeaderboard: (leaderboard) => set({ leaderboard }),
  setMyTrades:    (myTrades)    => set({ myTrades }),
  pushToast:      (text, ok) => {
    const id = Math.random().toString(36).slice(2)
    set(s => ({ toasts: [...s.toasts.slice(-4), { id, text, ok }] }))
    setTimeout(() => set(s => ({ toasts: s.toasts.filter(t => t.id !== id) })), 4000)
  },
  removeToast: (id) => set(s => ({ toasts: s.toasts.filter(t => t.id !== id) })),
}))
