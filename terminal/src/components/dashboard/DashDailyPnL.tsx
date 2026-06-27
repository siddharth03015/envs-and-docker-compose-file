'use client'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, Cell, ReferenceLine,
} from 'recharts'
import type { DailyData } from '@/lib/dashboard'
import { fmtUSD } from '@/lib/formatters'

interface Props { dailyData: DailyData[] }

function TooltipContent({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  const val: number = payload[0]?.value ?? 0
  return (
    <div style={{
      background: '#0d0d0d', border: '1px solid #1d1d1f',
      borderRadius: 6, padding: '8px 12px', fontSize: 11,
    }}>
      <div style={{ color: '#86868b', marginBottom: 3 }}>{label}</div>
      <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: val >= 0 ? '#34d399' : '#f87171' }}>
        {val >= 0 ? '+' : ''}{fmtUSD(val)}
      </div>
    </div>
  )
}

export default function DashDailyPnL({ dailyData }: Props) {
  const chartData = dailyData.map(d => ({ label: d.date.slice(5), value: d.pnl }))
  const tickInterval = Math.max(1, Math.floor(chartData.length / 5))

  return (
    <div style={{
      background: 'var(--bg-surface)', border: '1px solid var(--border-dim)',
      borderRadius: 8, overflow: 'hidden', display: 'flex', flexDirection: 'column',
    }}>
      <div style={{ padding: '11px 16px 8px', borderBottom: '1px solid var(--border-dim)', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 500 }}>
          Net Daily P&amp;L
        </span>
        {chartData.length > 0 && (
          <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
            {chartData.length}d
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
            <BarChart data={chartData} margin={{ top: 6, right: 12, left: 0, bottom: 0 }} barCategoryGap="20%">
              <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" strokeDasharray="3 3" />
              <XAxis dataKey="label" tick={{ fontSize: 9, fill: '#86868b' }} axisLine={false} tickLine={false} interval={tickInterval} />
              <YAxis
                tick={{ fontSize: 9, fill: '#86868b' }} axisLine={false} tickLine={false}
                width={52}
                tickFormatter={v => {
                  const a = Math.abs(v)
                  if (a >= 1000) return `${v >= 0 ? '' : '-'}$${(a / 1000).toFixed(1)}k`
                  return `${v >= 0 ? '' : '-'}$$trade{a.toFixed(0)}`
                }}
              />
              <Tooltip content={<TooltipContent />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
              <ReferenceLine y={0} stroke="rgba(255,255,255,0.15)" strokeWidth={1} />
              <Bar dataKey="value" maxBarSize={28} radius={[3, 3, 0, 0]}>
                {chartData.map((entry, idx) => (
                  <Cell
                    key={idx}
                    fill={entry.value >= 0 ? '#34d399' : '#f87171'}
                    fillOpacity={0.82}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  )
}
