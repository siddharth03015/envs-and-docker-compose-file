'use client'
import { AreaChart, Area, ResponsiveContainer } from 'recharts'
import type { DashStats } from '@/lib/dashboard'
import { fmtUSD } from '@/lib/formatters'

// ── SVG Arc Gauge ─────────────────────────────────────────────────────────────
function describeArc(cx: number, cy: number, r: number, startDeg: number, endDeg: number) {
  const toRad = (d: number) => (d - 90) * (Math.PI / 180)
  const x1 = cx + r * Math.cos(toRad(startDeg))
  const y1 = cy + r * Math.sin(toRad(startDeg))
  const x2 = cx + r * Math.cos(toRad(endDeg))
  const y2 = cy + r * Math.sin(toRad(endDeg))
  const large = endDeg - startDeg > 180 ? 1 : 0
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`
}

function ProfitGauge({ value }: { value: number }) {
  const cx = 44, cy = 46, r = 32
  const start = 225, sweep = 270
  const pct = Math.min(Math.max(value / 5, 0), 1)
  const color = value >= 2 ? '#34d399' : value >= 1 ? '#F59E0B' : '#f87171'
  return (
    <svg width="88" height="88" viewBox="0 0 88 88" style={{ flexShrink: 0 }}>
      <path d={describeArc(cx, cy, r, start, start + sweep)}
        fill="none" stroke="#1d1d1f" strokeWidth="6" strokeLinecap="round" />
      {pct > 0.01 && (
        <path d={describeArc(cx, cy, r, start, start + sweep * pct)}
          fill="none" stroke={color} strokeWidth="6" strokeLinecap="round" />
      )}
    </svg>
  )
}

// ── Stat card wrapper ─────────────────────────────────────────────────────────
function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{
      background: 'var(--bg-surface)', border: '1px solid var(--border-dim)',
      borderRadius: 8, padding: '16px 18px', overflow: 'hidden', position: 'relative',
      ...style,
    }}>
      {children}
    </div>
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6, fontWeight: 500 }}>
      {children}
    </div>
  )
}

function BigNum({ children, color }: { children: React.ReactNode; color?: string }) {
  return (
    <div style={{ fontSize: 24, fontFamily: 'var(--font-mono)', fontWeight: 700, color: color ?? 'var(--text-main)', lineHeight: 1.1 }}>
      {children}
    </div>
  )
}

// ── Props ─────────────────────────────────────────────────────────────────────
interface Props {
  stats:   DashStats
  loading: boolean
}

export default function DashStats({ stats, loading }: Props) {
  const { netPnL, profitFactor, tradeWinPct, dayWinPct, avgWin, avgLoss, sparklineData } = stats
  const isProfit = netPnL >= 0
  const pnlPct   = (netPnL / 100_000) * 100
  const maxWL    = Math.max(avgWin, avgLoss, 1)

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12 }}>

      {/* ── 1. Net P&L ── */}
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <Label>Net P&amp;L</Label>
          {!loading && (
            <span style={{
              background: isProfit ? 'rgba(52,211,153,0.12)' : 'rgba(248,113,113,0.12)',
              color: isProfit ? 'var(--buy)' : 'var(--sell)',
              fontSize: 10, fontFamily: 'var(--font-mono)', padding: '1px 6px', borderRadius: 3,
              marginBottom: 6,
            }}>
              {isProfit ? '+' : ''}{pnlPct.toFixed(2)}%
            </span>
          )}
        </div>
        <BigNum color={isProfit ? 'var(--buy)' : 'var(--sell)'}>
          {loading ? '—' : fmtUSD(netPnL)}
        </BigNum>
        {sparklineData.length > 2 && (
          <div style={{ height: 38, marginTop: 10, marginLeft: -4, marginRight: -4 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={sparklineData} margin={{ top: 2, right: 2, left: 2, bottom: 0 }}>
                <defs>
                  <linearGradient id="splGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={isProfit ? '#34d399' : '#f87171'} stopOpacity={0.35} />
                    <stop offset="100%" stopColor={isProfit ? '#34d399' : '#f87171'} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <Area type="monotone" dataKey="v" stroke={isProfit ? '#34d399' : '#f87171'}
                  strokeWidth={1.5} fill="url(#splGrad)" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>

      {/* ── 2. Profit Factor ── */}
      <Card style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div>
          <Label>Profit Factor</Label>
          <BigNum>
            {loading ? '—' : profitFactor >= 99 ? '∞' : profitFactor.toFixed(1)}
          </BigNum>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 6 }}>gross win / loss ratio</div>
        </div>
        <ProfitGauge value={loading ? 0 : profitFactor} />
      </Card>

      {/* ── 3. Trade Win% ── */}
      <Card>
        <Label>Trade Win%</Label>
        <BigNum>{loading ? '—' : `${tradeWinPct.toFixed(1)}%`}</BigNum>
        <div style={{ marginTop: 12 }}>
          <div style={{ height: 6, borderRadius: 3, background: 'var(--bg-surface-elevated)', overflow: 'hidden', marginBottom: 6 }}>
            <div style={{
              height: '100%', width: `${tradeWinPct}%`, borderRadius: 3,
              background: 'linear-gradient(90deg, #34d399, #059669)',
              transition: 'width 0.8s cubic-bezier(0.16,1,0.3,1)',
            }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, fontFamily: 'var(--font-mono)' }}>
            <span style={{ color: 'var(--buy)' }}>{tradeWinPct.toFixed(1)}%</span>
            <span style={{ color: 'var(--sell)' }}>{(100 - tradeWinPct).toFixed(1)}%</span>
          </div>
        </div>
      </Card>

      {/* ── 4. Day Win% ── */}
      <Card>
        <Label>Day Win%</Label>
        <BigNum>{loading ? '—' : `${dayWinPct.toFixed(1)}%`}</BigNum>
        <div style={{ display: 'flex', gap: 3, height: 28, alignItems: 'flex-end', marginTop: 10 }}>
          {Array.from({ length: 12 }).map((_, i) => {
            const threshold = ((i + 1) / 12) * 100
            const active = dayWinPct >= threshold
            return (
              <div key={i} style={{
                flex: 1,
                height: `${30 + i * 5.5}%`,
                background: active ? 'var(--buy)' : '#1d1d1f',
                borderRadius: '2px 2px 0 0',
                transition: 'background 0.4s ease',
              }} />
            )
          })}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 5, fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
          <span>0%</span>
          <span style={{ color: 'var(--sell)' }}>{(100 - dayWinPct).toFixed(0)}% loss days</span>
        </div>
      </Card>

      {/* ── 5. Avg Win / Loss ── */}
      <Card>
        <Label>Avg Win / Loss</Label>
        <BigNum color={(avgWin - avgLoss) >= 0 ? 'var(--buy)' : 'var(--sell)'}>
          {loading ? '—' : fmtUSD(avgWin - avgLoss)}
        </BigNum>
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div>
            <div style={{ height: 5, borderRadius: 2, background: 'var(--bg-surface-elevated)', overflow: 'hidden', marginBottom: 3 }}>
              <div style={{ height: '100%', width: `${(avgWin / maxWL) * 100}%`, background: 'var(--buy)', borderRadius: 2, transition: 'width 0.8s cubic-bezier(0.16,1,0.3,1)' }} />
            </div>
            <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--buy)' }}>
              Win {fmtUSD(avgWin)}
            </span>
          </div>
          <div>
            <div style={{ height: 5, borderRadius: 2, background: 'var(--bg-surface-elevated)', overflow: 'hidden', marginBottom: 3 }}>
              <div style={{ height: '100%', width: `${(avgLoss / maxWL) * 100}%`, background: 'var(--sell)', borderRadius: 2, transition: 'width 0.8s cubic-bezier(0.16,1,0.3,1)' }} />
            </div>
            <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--sell)' }}>
              Loss {fmtUSD(avgLoss)}
            </span>
          </div>
        </div>
      </Card>

    </div>
  )
}
