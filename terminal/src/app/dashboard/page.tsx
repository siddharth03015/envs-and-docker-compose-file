'use client'
import { useEffect, useState, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Header from '@/components/Header'
import DashStats         from '@/components/dashboard/DashStats'
import DashNotesPanel    from '@/components/dashboard/DashNotesPanel'
import DashCalendar      from '@/components/dashboard/DashCalendar'
import DashOpenPositions from '@/components/dashboard/DashOpenPositions'
import DashCumPnL        from '@/components/dashboard/DashCumPnL'
import DashDailyPnL      from '@/components/dashboard/DashDailyPnL'
import { fetchPortfolio, fetchPnLHistory, fetchMyTrades } from '@/lib/market'
import { fetchNotes } from '@/lib/notes'
import { buildDailyData, computeStats, toDay } from '@/lib/dashboard'
import { useAuthModal } from '@/context/AuthModalContext'
import type { Portfolio, PnLPoint, MyTrade, Note } from '@/types'

// ── Live refresh every 30s ────────────────────────────────────────────────────
const REFRESH_INTERVAL_MS = 30_000

export default function DashboardPage() {
  const router = useRouter()
  const { user } = useAuthModal()

  const [portfolio,   setPortfolio]   = useState<Portfolio | null>(null)
  const [pnlHistory,  setPnlHistory]  = useState<PnLPoint[]>([])
  const [myTrades,    setMyTrades]    = useState<MyTrade[]>([])
  const [notes,       setNotes]       = useState<Note[]>([])
  const [loading,     setLoading]     = useState(true)
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const [port, hist, trades, noteList] = await Promise.all([
        fetchPortfolio(),
        fetchPnLHistory(2000),
        fetchMyTrades(1000),
        fetchNotes(),
      ])
      setPortfolio(port)
      setPnlHistory(hist)
      setMyTrades(trades)
      setNotes(noteList)
      setLastRefresh(new Date())
    } catch {
      // If 401, user likely not logged in
    } finally {
      if (!silent) setLoading(false)
    }
  }, [])

  // Initial load + periodic refresh
  useEffect(() => {
    load()
    const id = setInterval(() => load(true), REFRESH_INTERVAL_MS)
    return () => clearInterval(id)
  }, [load])

  // Derived data (memoised)
  const notesByDay = useMemo(() => (
    notes.reduce<Record<string, number>>((acc, n) => {
      const day = toDay(n.created_at)
      acc[day] = (acc[day] ?? 0) + 1
      return acc
    }, {})
  ), [notes])

  const dailyData = useMemo(() => buildDailyData(pnlHistory, myTrades, notesByDay), [pnlHistory, myTrades, notesByDay])
  const stats     = useMemo(() => computeStats(pnlHistory, myTrades),               [pnlHistory, myTrades])

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg-base)' }}>
      <Header />

      {/* ── Scrollable content area ── */}
      <div style={{ flex: 1, overflow: 'auto', marginTop: 56, padding: '20px 24px 32px' }}>

        {/* ── Page header ── */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
            <h1 style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.5px', color: 'var(--text-main)', margin: 0 }}>
              Dashboard
            </h1>
            {!loading && lastRefresh && (
              <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                Updated {lastRefresh.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {!user && (
              <span style={{ fontSize: 11, color: 'var(--sell)', fontFamily: 'var(--font-mono)' }}>
                Sign in to view your dashboard
              </span>
            )}
            <button onClick={() => router.push('/trade')} style={{
              padding: '6px 14px', background: 'transparent',
              border: '1px solid var(--border-dim)', color: 'var(--text-muted)',
              borderRadius: 5, fontSize: 12, cursor: 'pointer', transition: 'all 0.15s',
            }}
              onMouseEnter={e => { e.currentTarget.style.color = 'var(--text-main)'; e.currentTarget.style.borderColor = 'var(--text-muted)' }}
              onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.borderColor = 'var(--border-dim)' }}
            >
              ← Terminal
            </button>
            <button onClick={() => load()} style={{
              padding: '6px 14px', background: 'var(--bg-surface)',
              border: '1px solid var(--border-dim)', color: 'var(--text-muted)',
              borderRadius: 5, fontSize: 12, cursor: 'pointer', transition: 'all 0.15s',
            }}
              onMouseEnter={e => { e.currentTarget.style.color = 'var(--text-main)' }}
              onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)' }}
            >
              ↻ Refresh
            </button>
          </div>
        </div>

        {/* ── Stats row ── */}
        <DashStats stats={stats} loading={loading} />

        {/* ── Middle section: Notes | Calendar ── */}
        <div style={{ display: 'grid', gridTemplateColumns: '34% 1fr', gap: 14, marginTop: 14 }}>
          <DashNotesPanel
            notes={notes}
            trades={myTrades.slice(0, 30)}
            onNotesChange={setNotes}
          />
          <DashCalendar dailyData={dailyData} />
        </div>

        {/* ── Bottom section: Positions | Cum P&L | Daily P&L ── */}
        <div style={{ display: 'grid', gridTemplateColumns: '34% 1fr 1fr', gap: 14, marginTop: 14 }}>
          <DashOpenPositions portfolio={portfolio} />
          <DashCumPnL  dailyData={dailyData} />
          <DashDailyPnL dailyData={dailyData} />
        </div>

      </div>
    </div>
  )
}
