'use client'
import { useEffect, useRef, useState } from 'react'
import { useMarketStore } from '@/store/market'
import { useTerminalStore } from '@/store/terminal'
import { fmtPrice, fmtQty } from '@/lib/formatters'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ReferenceLine } from 'recharts'

interface Props { symbol: string }

const RANGES = [
  { label: '1%',  pct: 0.01 },
  { label: '2%',  pct: 0.02 },
  { label: '5%',  pct: 0.05 },
  { label: 'All', pct: 1.00 },
]

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const CustomTooltip = ({ active, payload, theme, totalBid, totalAsk }: { active?: boolean; payload?: any[]; theme: 'dark' | 'light'; totalBid: number; totalAsk: number }) => {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  const bg     = theme === 'light' ? '#ffffff' : '#131722'
  const border = theme === 'light' ? '#d1d5db' : '#2a2e3a'
  const total  = totalBid + totalAsk || 1
  return (
    <div style={{ background: bg, border: `1px solid ${border}`, padding: '7px 11px', borderRadius: 4, fontSize: 11, minWidth: 140 }}>
      <div style={{ color: 'var(--text-main)', fontFamily: 'var(--font-mono)', fontWeight: 600, marginBottom: 4 }}>
        ${fmtPrice(d.price, 2)}
      </div>
      {d.bidQty != null && (
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
          <span style={{ color: '#86868b' }}>Bid depth</span>
          <span style={{ color: '#34d399', fontFamily: 'var(--font-mono)' }}>
            {fmtQty(d.bidQty, 4)}
            <span style={{ color: '#86868b', marginLeft: 4, fontSize: 10 }}>
              ({((d.bidQty / total) * 100).toFixed(1)}%)
            </span>
          </span>
        </div>
      )}
      {d.askQty != null && (
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
          <span style={{ color: '#86868b' }}>Ask depth</span>
          <span style={{ color: '#f87171', fontFamily: 'var(--font-mono)' }}>
            {fmtQty(d.askQty, 4)}
            <span style={{ color: '#86868b', marginLeft: 4, fontSize: 10 }}>
              ({((d.askQty / total) * 100).toFixed(1)}%)
            </span>
          </span>
        </div>
      )}
      {d.bidQty != null && (
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginTop: 2, borderTop: `1px solid ${border}`, paddingTop: 4 }}>
          <span style={{ color: '#86868b' }}>Value</span>
          <span style={{ color: 'var(--text-main)', fontFamily: 'var(--font-mono)', fontSize: 10 }}>
            ${fmtPrice(d.price * d.bidQty, 0)}
          </span>
        </div>
      )}
      {d.askQty != null && (
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginTop: 2 }}>
          <span style={{ color: '#86868b' }}>Value</span>
          <span style={{ color: 'var(--text-main)', fontFamily: 'var(--font-mono)', fontSize: 10 }}>
            ${fmtPrice(d.price * d.askQty, 0)}
          </span>
        </div>
      )}
    </div>
  )
}

export default function DepthChart({ symbol }: Props) {
  const theme   = useTerminalStore(s => s.theme)
  const ob      = useMarketStore(s => s.orderbooks[symbol])
  const wrapRef = useRef<HTMLDivElement>(null)
  const [dims,     setDims]     = useState({ w: 0, h: 0 })
  const [rangeIdx, setRangeIdx] = useState(1)  // default ±2%

  useEffect(() => {
    if (!wrapRef.current) return
    const ro = new ResizeObserver(entries => {
      const { width, height } = entries[0]?.contentRect ?? {}
      if (width > 0 && height > 0) setDims({ w: width, h: height })
    })
    ro.observe(wrapRef.current)
    return () => ro.disconnect()
  }, [])

  if (!ob || (!ob.bids.length && !ob.asks.length)) {
    return (
      <div ref={wrapRef} style={{ width: '100%', flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ color: 'var(--text-dark)', fontSize: 12 }}>Waiting for order book…</span>
      </div>
    )
  }

  const bids = [...ob.bids].sort((a, b) => b.price - a.price)
  const asks = [...ob.asks].sort((a, b) => a.price - b.price)

  const bestBid = bids[0]?.price ?? 0
  const bestAsk = asks[0]?.price ?? 0
  const midPrice = bestAsk > 0 && bestBid > 0 ? (bestBid + bestAsk) / 2 : bestAsk || bestBid
  const spread    = bestAsk > 0 && bestBid > 0 ? bestAsk - bestBid : 0
  const spreadPct = midPrice > 0 ? (spread / midPrice) * 100 : 0

  // Apply price range filter
  const rangePct = RANGES[rangeIdx].pct
  const lo = rangePct < 1 ? midPrice * (1 - rangePct) : 0
  const hi = rangePct < 1 ? midPrice * (1 + rangePct) : Infinity

  const filteredBids = rangePct < 1 ? bids.filter(b => b.price >= lo) : bids
  const filteredAsks = rangePct < 1 ? asks.filter(a => a.price <= hi) : asks

  const bidPoints = filteredBids
    .reduce<Array<{ price: number; bidQty: number }>>((acc, b) => {
      const prev = acc[acc.length - 1]?.bidQty ?? 0
      acc.push({ price: b.price, bidQty: prev + b.quantity })
      return acc
    }, [])
    .reverse()

  const askPoints = filteredAsks.reduce<Array<{ price: number; askQty: number }>>((acc, a) => {
    const prev = acc[acc.length - 1]?.askQty ?? 0
    acc.push({ price: a.price, askQty: prev + a.quantity })
    return acc
  }, [])

  const totalBid = bidPoints[0]?.bidQty ?? 0
  const totalAsk = askPoints[askPoints.length - 1]?.askQty ?? 0
  const maxQty   = Math.max(totalBid, totalAsk, 0.001)

  // Merge into unified price series
  const allPrices = [...new Set([...bidPoints.map(p => p.price), ...askPoints.map(p => p.price)])].sort((a, b) => a - b)
  const data = allPrices.map(price => ({
    price,
    bidQty: bidPoints.find(p => p.price === price)?.bidQty,
    askQty: askPoints.find(p => p.price === price)?.askQty,
  }))

  // Imbalance: bid/(bid+ask)
  const totalDepth   = totalBid + totalAsk || 1
  const bidPct       = (totalBid / totalDepth) * 100
  const axisColor    = theme === 'light' ? '#6b7280' : '#86868b'
  const panelBg      = theme === 'light' ? '#f9fafb' : '#0d0f14'
  const borderColor  = theme === 'light' ? '#e5e7eb' : '#1e2230'

  // Chart height = total height minus stats rows
  const STATS_H    = 36
  const IMBAL_H    = 28
  const TOOLBAR_H  = 28
  const chartH     = Math.max(60, (dims.h || 300) - STATS_H - IMBAL_H - TOOLBAR_H)

  return (
    <div style={{ width: '100%', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', background: panelBg }}>

      {/* ── Stats row ─────────────────────────────────────────────────────── */}
      <div style={{
        height: STATS_H, flexShrink: 0, display: 'flex', alignItems: 'center',
        padding: '0 10px', gap: 0,
        borderBottom: `1px solid ${borderColor}`,
        fontFamily: 'var(--font-mono)', fontSize: 10,
      }}>
        <StatCell label="Best Bid" value={`$${fmtPrice(bestBid, 2)}`} color="#34d399" />
        <Divider />
        <StatCell label="Mid" value={`$${fmtPrice(midPrice, 2)}`} color="var(--text-main)" />
        <Divider />
        <StatCell label="Best Ask" value={`$${fmtPrice(bestAsk, 2)}`} color="#f87171" />
        <Divider />
        <StatCell label="Spread" value={`$${fmtPrice(spread, 2)}`} color="var(--text-muted)" />
        <Divider />
        <StatCell label="Sprd %" value={`${spreadPct.toFixed(3)}%`} color="var(--text-muted)" />
      </div>

      {/* ── Imbalance bar ─────────────────────────────────────────────────── */}
      <div style={{
        height: IMBAL_H, flexShrink: 0,
        display: 'flex', flexDirection: 'column', justifyContent: 'center',
        padding: '0 10px', gap: 4,
        borderBottom: `1px solid ${borderColor}`,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: axisColor, marginBottom: 2 }}>
          <span style={{ color: '#34d399' }}>BID {bidPct.toFixed(1)}%  {fmtQty(totalBid, 2)}</span>
          <span style={{ fontSize: 9, color: axisColor, fontFamily: 'var(--font-mono)' }}>DEPTH IMBALANCE</span>
          <span style={{ color: '#f87171' }}>{fmtQty(totalAsk, 2)}  {(100 - bidPct).toFixed(1)}% ASK</span>
        </div>
        <div style={{ display: 'flex', height: 6, borderRadius: 3, overflow: 'hidden', background: borderColor }}>
          <div style={{ width: `${bidPct}%`, background: '#34d399', transition: 'width 0.3s ease' }} />
          <div style={{ flex: 1, background: '#f87171' }} />
        </div>
      </div>

      {/* ── Range toolbar ─────────────────────────────────────────────────── */}
      <div style={{
        height: TOOLBAR_H, flexShrink: 0, display: 'flex', alignItems: 'center',
        padding: '0 8px', gap: 2,
        borderBottom: `1px solid ${borderColor}`,
      }}>
        <span style={{ fontSize: 9, color: axisColor, marginRight: 4, fontFamily: 'var(--font-mono)' }}>RANGE</span>
        {RANGES.map((r, i) => (
          <button key={r.label} onClick={() => setRangeIdx(i)}
            style={{
              padding: '2px 8px', fontSize: 9, borderRadius: 2, cursor: 'pointer',
              fontFamily: 'var(--font-mono)', border: 'none',
              background: rangeIdx === i ? 'rgba(52,211,153,0.15)' : 'transparent',
              color:      rangeIdx === i ? '#34d399' : axisColor,
              transition: 'all 0.15s',
            }}>
            {r.label}
          </button>
        ))}
      </div>

      {/* ── Chart ─────────────────────────────────────────────────────────── */}
      <div ref={wrapRef} style={{ flex: 1, minHeight: 0 }}>
        {dims.w > 0 && chartH > 0 && (
          <AreaChart
            key={`depth-${theme}-${rangeIdx}`}
            width={dims.w} height={chartH}
            data={data}
            margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
          >
            <defs>
              <linearGradient id="bidGrad3" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor="#34d399" stopOpacity={0.35} />
                <stop offset="95%" stopColor="#34d399" stopOpacity={0.02} />
              </linearGradient>
              <linearGradient id="askGrad3" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor="#f87171" stopOpacity={0.35} />
                <stop offset="95%" stopColor="#f87171" stopOpacity={0.02} />
              </linearGradient>
            </defs>

            <XAxis
              dataKey="price"
              tickFormatter={v => `$${fmtPrice(v, 0)}`}
              tick={{ fill: axisColor, fontSize: 9 }}
              tickLine={false} axisLine={false} minTickGap={40}
            />
            <YAxis
              domain={[0, maxQty * 1.08]}
              tickFormatter={v => fmtQty(v, 2)}
              tick={{ fill: axisColor, fontSize: 9 }}
              tickLine={false} axisLine={false} width={44}
            />
            <Tooltip content={<CustomTooltip theme={theme} totalBid={totalBid} totalAsk={totalAsk} />} />

            {/* Mid-price reference */}
            <ReferenceLine
              x={midPrice}
              stroke={axisColor}
              strokeDasharray="3 3"
              strokeOpacity={0.6}
              label={{ value: `Mid $${fmtPrice(midPrice, 0)}`, position: 'top', fill: axisColor, fontSize: 8 }}
            />

            <Area type="stepAfter"  dataKey="bidQty" stroke="#34d399" strokeWidth={1.5}
              fill="url(#bidGrad3)" dot={false} connectNulls={false} />
            <Area type="stepBefore" dataKey="askQty" stroke="#f87171" strokeWidth={1.5}
              fill="url(#askGrad3)" dot={false} connectNulls={false} />
          </AreaChart>
        )}
      </div>
    </div>
  )
}

function StatCell({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
      <span style={{ fontSize: 8, color: '#86868b', textTransform: 'uppercase', letterSpacing: '0.4px' }}>{label}</span>
      <span style={{ fontSize: 10, color, fontWeight: 500 }}>{value}</span>
    </div>
  )
}

function Divider() {
  return <div style={{ width: 1, height: 24, background: 'var(--border-dim)', flexShrink: 0 }} />
}
