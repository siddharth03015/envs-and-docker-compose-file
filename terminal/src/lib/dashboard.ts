import type { PnLPoint, MyTrade } from '@/types'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DailyData {
  date:   string  // YYYY-MM-DD
  pnl:    number
  trades: number
  notes:  number
  cumPnL: number
}

export interface DashStats {
  netPnL:         number
  profitFactor:   number
  tradeWinPct:    number
  dayWinPct:      number
  avgWin:         number
  avgLoss:        number
  sparklineData:  { v: number }[]
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function toDay(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// ── Build per-day aggregated data ─────────────────────────────────────────────

export function buildDailyData(
  pnlHistory:  PnLPoint[],
  myTrades:    MyTrade[],
  notesByDay:  Record<string, number>,
): DailyData[] {
  if (pnlHistory.length === 0) return []

  const sorted = [...pnlHistory].sort((a, b) => a.timestamp - b.timestamp)

  // Group snapshots by day: track first and last total_value per day
  const dayMap = new Map<string, { first: number; last: number }>()
  for (const snap of sorted) {
    const day = toDay(snap.timestamp)
    if (!dayMap.has(day)) {
      dayMap.set(day, { first: snap.total_value, last: snap.total_value })
    } else {
      dayMap.get(day)!.last = snap.total_value
    }
  }

  // Count trades per day
  const tradesByDay = new Map<string, number>()
  for (const t of myTrades) {
    const day = toDay(t.timestamp)
    tradesByDay.set(day, (tradesByDay.get(day) ?? 0) + 1)
  }

  // Sort days and compute running cumulative P&L
  const days = [...dayMap.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  let cumPnL = 0

  return days.map(([date, { first, last }]) => {
    const pnl = last - first
    cumPnL += pnl
    return {
      date,
      pnl,
      trades:  tradesByDay.get(date) ?? 0,
      notes:   notesByDay[date]      ?? 0,
      cumPnL,
    }
  })
}

// ── Compute top-level stats ───────────────────────────────────────────────────

const ZERO_STATS: DashStats = {
  netPnL: 0, profitFactor: 0, tradeWinPct: 0,
  dayWinPct: 0, avgWin: 0, avgLoss: 0, sparklineData: [],
}

export function computeStats(pnlHistory: PnLPoint[], myTrades: MyTrade[]): DashStats {
  if (pnlHistory.length === 0) return ZERO_STATS

  const sorted = [...pnlHistory].sort((a, b) => a.timestamp - b.timestamp)
  const netPnL = sorted[sorted.length - 1].total_value - 100_000

  // Sparkline: last 30 snapshots
  const sparklineData = sorted.slice(-30).map(p => ({ v: p.total_value - 100_000 }))

  // Daily P&L
  const dayMap = new Map<string, { first: number; last: number }>()
  for (const snap of sorted) {
    const day = toDay(snap.timestamp)
    if (!dayMap.has(day)) dayMap.set(day, { first: snap.total_value, last: snap.total_value })
    else dayMap.get(day)!.last = snap.total_value
  }

  const dailyPnLs   = [...dayMap.values()].map(d => d.last - d.first)
  const winDays     = dailyPnLs.filter(p => p > 0)
  const lossDays    = dailyPnLs.filter(p => p < 0)
  const grossProfit = winDays.reduce((s, v) => s + v, 0)
  const grossLoss   = Math.abs(lossDays.reduce((s, v) => s + v, 0))

  const profitFactor = grossLoss > 0.01 ? grossProfit / grossLoss : (grossProfit > 0 ? 99 : 0)
  const dayWinPct    = dailyPnLs.length > 0 ? (winDays.length / dailyPnLs.length) * 100 : 0

  // Per-trade win/loss: compare snapshots immediately before & after each trade
  let tradeWins = 0, tradeLosses = 0
  for (const trade of myTrades) {
    const before = sorted.filter(s => s.timestamp <= trade.timestamp).at(-1)
    const after  = sorted.find(s => s.timestamp  >  trade.timestamp)
    if (before && after) {
      const delta = after.total_value - before.total_value
      if (delta >  0.01) tradeWins++
      else if (delta < -0.01) tradeLosses++
    }
  }
  const tradeTotal  = tradeWins + tradeLosses
  const tradeWinPct = tradeTotal > 0 ? (tradeWins / tradeTotal) * 100 : dayWinPct

  const avgWin  = winDays.length  > 0 ? grossProfit / winDays.length  : 0
  const avgLoss = lossDays.length > 0 ? grossLoss   / lossDays.length : 0

  return { netPnL, profitFactor, tradeWinPct, dayWinPct, avgWin, avgLoss, sparklineData }
}
