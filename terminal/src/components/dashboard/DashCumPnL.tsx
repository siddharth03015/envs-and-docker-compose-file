'use client'
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis,
  CartesianGrid, Tooltip, ReferenceLine,
} from 'recharts'
import type { DailyData } from '@/lib/dashboard'
import { fmtUSD } from '@/lib/formatters'

interface Props { dailyData: DailyData[] }

type ChartPoint = { label: string; pos: number; neg: number; raw: number }

function TooltipContent({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  const raw: number = payload[0]?.payload?.raw ?? 0
  return (
    <div style={{
      background: '#0d0d0d', border: '1px solid #1d1d1f',
      borderRadius: 6, padding: '8px 12px', fontSize: 11,
    }}>
      <div style={{ color: '#86868b', marginBottom: 3 }}>{label}</div>
      <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: raw >= 0 ? '#34d399' : '#f87171' }}>
        {raw >= 0 ? '+' : ''}{fmtUSD(raw)}
      </div>
    </div>
  )
}

export default function DashCumPnL({ dailyData }: Props) {
  const chartData: ChartPoint[] = dailyData.map(d => ({
    label: d.date.slice(5),
    pos:   Math.max(0, d.cumPnL),
    neg:   Math.min(0, d.cumPnL),
    raw:   d.cumPnL,
  }))

  const tickInterval = Math.max(1, Math.floor(chartData.length / 5))

  return (
    <div style={{
      background: 'var(--bg-surface)', border: '1px solid var(--border-dim)',
      borderRadius: 8, overflow: 'hidden', display: 'flex', flexDirection: 'column',
    }}>
      <div style={{ padding: '11px 16px 8px', borderBottom: '1px solid var(--border-dim)', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 500 }}>
          Daily Net Cumulative P&amp;L
        </span>
        {chartData.length > 0 && (
          <span style={{
            fontSize: 11, fontFamily: 'var(--font-mono)', fontWeight: 700,
            color: (chartData.at(-1)?.raw ?? 0) >= 0 ? 'var(--buy)' : 'var(--sell)',
          }}>
            {(chartData.at(-1)?.raw ?? 0) >= 0 ? '+' : ''}{fmtUSD(chartData.at(-1)?.raw ?? 0)}
          </span>
        )}
      </div>
      <div style={{ flex: 1, padding: '12px 4px 8px 0', minHeight: 200 }}>
        {chartData.length < 2 ? (
          <div style={{ height: 180, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
            Not enough data yet
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={210}>
            <AreaChart data={chartData} margin={{ top: 6, right: 12, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="cumGreen" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%"   stopColor="#34d399" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#34d399" stopOpacity={0.03} />
                </linearGradient>
                <linearGradient id="cumRed" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%"   stopColor="#f87171" stopOpacity={0.03} />
                  <stop offset="100%" stopColor="#f87171" stopOpacity={0.35} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" strokeDasharray="3 3" />
              <XAxis dataKey="label" tick={{ fontSize: 9, fill: '#86868b' }} axisLine={false} tickLine={false} interval={tickInterval} />
              <YAxis
                tick={{ fontSize: 9, fill: '#86868b' }} axisLine={false} tickLine={false}
                width={52}
                tickFormatter={v => {
                  const a = Math.abs(v)
                  if (a >= 1000) return `${v >= 0 ? '' : '-'}$${(a / 1000).toFixed(1)}k`
                  return `${v >= 0 ? '' : '-'}$${a.toFixed(0)}`
                }}
              />
              <Tooltip content={<TooltipContent />} />
              <ReferenceLine y={0} stroke="rgba(255,255,255,0.2)" strokeWidth={1} />
              {/* Positive area */}
              <Area type="monotone" dataKey="pos" stroke="#34d399" strokeWidth={2}
                fill="url(#cumGreen)" dot={false} activeDot={{ r: 3, fill: '#34d399', stroke: 'none' }} />
              {/* Negative area */}
              <Area type="monotone" dataKey="neg" stroke="#f87171" strokeWidth={2}
                fill="url(#cumRed)" dot={false} activeDot={{ r: 3, fill: '#f87171', stroke: 'none' }} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  )
}
