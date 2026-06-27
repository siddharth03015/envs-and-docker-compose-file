'use client'
import { useEffect, useRef, useState } from 'react'
import { useTerminalStore } from '@/store/terminal'
import { fetchPnLHistory } from '@/lib/market'
import { fmtUSD } from '@/lib/formatters'
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ReferenceLine,
} from 'recharts'

const fmt = (ms: number) => {
  const d = new Date(ms)
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const CustomTooltip = ({ active, payload, theme }: { active?: boolean; payload?: any[]; theme: 'dark' | 'light' }) => {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  const pnl = d.total_value - 100_000
  const bg = theme === 'light' ? '#ffffff' : '#111111'
  const border = theme === 'light' ? '#d1d5db' : '#222222'
  const muted = theme === 'light' ? '#6b7280' : '#86868b'
  return (
    <div style={{ background: bg, border: `1px solid ${border}`, padding: '6px 10px', borderRadius: 4, fontSize: 11 }}>
      <div style={{ color: muted, marginBottom: 2 }}>{fmt(d.timestamp)}</div>
      <div style={{ color: 'var(--text-main)', fontFamily: 'var(--font-mono)' }}>{fmtUSD(d.total_value)}</div>
      <div style={{ fontFamily: 'var(--font-mono)' }} className={pnl >= 0 ? 'text-buy' : 'text-sell'}>
        {pnl >= 0 ? '+' : ''}{fmtUSD(pnl)}
      </div>
    </div>
  )
}

interface Props { height?: number }

export default function PnLChart({ height = 160 }: Props) {
  const pnlHistory = useTerminalStore(s => s.pnlHistory)
  const setPnL     = useTerminalStore(s => s.setPnLHistory)
  const theme      = useTerminalStore(s => s.theme)
  const wrapRef    = useRef<HTMLDivElement>(null)
  const [w, setW]  = useState(0)

  useEffect(() => {
    fetchPnLHistory(1000).then(setPnL).catch(() => {})
    const id = setInterval(() => fetchPnLHistory(1000).then(setPnL).catch(() => {}), 30_000)
    return () => clearInterval(id)
  }, [setPnL])

  // Measure real width to avoid -1 issue
  useEffect(() => {
    if (!wrapRef.current) return
    const ro = new ResizeObserver(entries => {
      const w = entries[0]?.contentRect.width ?? 0
      if (w > 0) setW(w)
    })
    ro.observe(wrapRef.current)
    return () => ro.disconnect()
  }, [])

  if (pnlHistory.length === 0) {
    return (
      <div ref={wrapRef} style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span className="text-muted" style={{ fontSize: 12 }}>No P&L history yet — place your first trade</span>
      </div>
    )
  }

  const last    = pnlHistory[pnlHistory.length - 1]
  const overall = last.total_value - 100_000
  const minV    = Math.min(...pnlHistory.map(p => p.total_value))
  const maxV    = Math.max(...pnlHistory.map(p => p.total_value))
  const padding = (maxV - minV) * 0.1 || 200
  const isUp    = overall >= 0
  const axisColor = theme === 'light' ? '#6b7280' : '#86868b'

  return (
    <div ref={wrapRef} style={{ padding: '6px 12px', boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', gap: 16, marginBottom: 6, alignItems: 'baseline' }}>
        <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-main)', fontFamily: 'var(--font-mono)' }}>
          {fmtUSD(last.total_value)}
        </span>
        <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)' }} className={isUp ? 'text-buy' : 'text-sell'}>
          {isUp ? '+' : ''}{fmtUSD(overall)} all time
        </span>
      </div>

      {/* Only render Recharts when we have a real measured width */}
      {w > 0 && (
        <AreaChart key={`pnl-${theme}-${isUp ? 'up' : 'dn'}`} width={w - 24} height={height} data={pnlHistory}
          margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="pnlGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor={isUp ? '#34d399' : '#f87171'} stopOpacity={0.25} />
              <stop offset="95%" stopColor={isUp ? '#34d399' : '#f87171'} stopOpacity={0.01} />
            </linearGradient>
          </defs>
          <XAxis dataKey="timestamp" tickFormatter={fmt} tick={{ fill: axisColor, fontSize: 9 }}
            tickLine={false} axisLine={false} minTickGap={60} />
          <YAxis domain={[minV - padding, maxV + padding]}
            tickFormatter={v => `$${(v / 1000).toFixed(0)}k`}
            tick={{ fill: axisColor, fontSize: 9 }} tickLine={false} axisLine={false} width={44} />
          <Tooltip content={<CustomTooltip theme={theme} />} />
          <ReferenceLine y={100_000} stroke={axisColor} strokeDasharray="3 3" strokeOpacity={0.4} />
          <Area type="monotone" dataKey="total_value"
            stroke={isUp ? '#34d399' : '#f87171'} strokeWidth={1.5}
            fill="url(#pnlGrad)" dot={false} activeDot={{ r: 3 }} />
        </AreaChart>
      )}
    </div>
  )
}
