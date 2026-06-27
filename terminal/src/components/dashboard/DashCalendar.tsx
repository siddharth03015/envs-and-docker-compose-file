'use client'
import { useState, useMemo } from 'react'
import type { DailyData } from '@/lib/dashboard'

interface Props {
  dailyData: DailyData[]
}

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function fmtPnLShort(v: number) {
  const abs = Math.abs(v)
  const sign = v < 0 ? '-' : ''
  if (abs >= 10_000) return `${sign}$${(abs / 1000).toFixed(1)}k`
  if (abs >= 1_000)  return `${sign}$${(abs / 1000).toFixed(2)}k`
  if (abs >= 100)    return `${sign}$${abs.toFixed(0)}`
  return `${sign}$${abs.toFixed(1)}`
}

type Cell = { date: string | null; day: number; isCurrentMonth: boolean }

export default function DashCalendar({ dailyData }: Props) {
  const today = new Date()
  const [year,  setYear]  = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth()) // 0-indexed

  const dataMap = useMemo(() => (
    dailyData.reduce<Record<string, DailyData>>((acc, d) => { acc[d.date] = d; return acc }, {})
  ), [dailyData])

  // Build grid cells
  const cells = useMemo<Cell[]>(() => {
    const firstDow    = new Date(year, month, 1).getDay()
    const daysInMonth = new Date(year, month + 1, 0).getDate()
    const prevDays    = new Date(year, month, 0).getDate()
    const out: Cell[] = []

    for (let i = 0; i < firstDow; i++) {
      out.push({ date: null, day: prevDays - firstDow + 1 + i, isCurrentMonth: false })
    }
    for (let d = 1; d <= daysInMonth; d++) {
      out.push({
        date: `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
        day: d, isCurrentMonth: true,
      })
    }
    while (out.length % 7 !== 0) {
      out.push({ date: null, day: out.length - firstDow - daysInMonth + 1, isCurrentMonth: false })
    }
    return out
  }, [year, month])

  const prevMonth = () => month === 0 ? (setYear(y => y - 1), setMonth(11)) : setMonth(m => m - 1)
  const nextMonth = () => month === 11 ? (setYear(y => y + 1), setMonth(0))  : setMonth(m => m + 1)

  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  const monthLabel = new Date(year, month, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' })
  const rows = cells.length / 7

  return (
    <div style={{
      background: 'var(--bg-surface)', border: '1px solid var(--border-dim)',
      borderRadius: 8, overflow: 'hidden', display: 'flex', flexDirection: 'column',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '13px 20px', borderBottom: '1px solid var(--border-dim)', flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <NavBtn onClick={prevMonth}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="15 18 9 12 15 6"/></svg>
          </NavBtn>
          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-main)', minWidth: 172, textAlign: 'center' }}>
            {monthLabel}
          </span>
          <NavBtn onClick={nextMonth}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="9 18 15 12 9 6"/></svg>
          </NavBtn>
        </div>
        <button onClick={() => { setYear(today.getFullYear()); setMonth(today.getMonth()) }} style={{
          padding: '5px 14px', background: 'var(--buy)', color: '#000',
          border: 'none', borderRadius: 5, fontSize: 12, fontWeight: 700, cursor: 'pointer',
          transition: 'opacity 0.15s',
        }}>Today</button>
      </div>

      {/* DOW labels */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', borderBottom: '1px solid var(--border-dim)', flexShrink: 0 }}>
        {DOW.map(d => (
          <div key={d} style={{ padding: '7px 0', textAlign: 'center', fontSize: 10, color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            {d}
          </div>
        ))}
      </div>

      {/* Grid */}
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gridTemplateRows: `repeat(${rows}, 1fr)` }}>
        {cells.map((cell, idx) => {
          const data = cell.date ? dataMap[cell.date] : null
          const isToday = cell.date === todayStr
          const isPos   = data && data.pnl > 0
          const isNeg   = data && data.pnl < 0
          const col = idx % 7
          const row = Math.floor(idx / 7)
          const borderRight  = col < 6 ? '1px solid var(--border-dim)' : 'none'
          const borderBottom = row < rows - 1 ? '1px solid var(--border-dim)' : 'none'

          return (
            <div key={idx} style={{
              padding: '7px 8px', minHeight: 68,
              borderRight, borderBottom,
              background: isToday
                ? 'rgba(52,211,153,0.05)'
                : cell.isCurrentMonth ? 'transparent' : 'rgba(0,0,0,0.25)',
              cursor: data ? 'pointer' : 'default',
              transition: 'background 0.12s',
              display: 'flex', flexDirection: 'column',
            }}
              onMouseEnter={e => { if (data) e.currentTarget.style.background = 'rgba(255,255,255,0.03)' }}
              onMouseLeave={e => { e.currentTarget.style.background = isToday ? 'rgba(52,211,153,0.05)' : cell.isCurrentMonth ? 'transparent' : 'rgba(0,0,0,0.25)' }}
            >
              {/* Day number */}
              <div style={{
                fontSize: 11, fontWeight: isToday ? 700 : 400,
                color: isToday ? 'var(--buy)' : cell.isCurrentMonth ? 'var(--text-muted)' : '#333',
                marginBottom: 3,
              }}>
                {cell.day}
                {isToday && (
                  <span style={{
                    width: 4, height: 4, borderRadius: '50%', background: 'var(--buy)',
                    display: 'inline-block', marginLeft: 4, verticalAlign: 'middle', marginBottom: 1,
                  }} />
                )}
              </div>

              {/* P&L */}
              {data && (
                <div style={{ flex: 1 }}>
                  <div style={{
                    fontSize: 11, fontFamily: 'var(--font-mono)', fontWeight: 700, lineHeight: 1.2,
                    color: isPos ? 'var(--buy)' : isNeg ? 'var(--sell)' : 'var(--text-muted)',
                  }}>
                    {fmtPnLShort(data.pnl)}
                  </div>
                  {(data.notes > 0 || data.trades > 0) && (
                    <div style={{ marginTop: 3, display: 'flex', flexDirection: 'column', gap: 1 }}>
                      {data.notes > 0 && (
                        <span style={{ fontSize: 9, color: 'var(--text-muted)', lineHeight: 1.3 }}>
                          {data.notes} Note{data.notes > 1 ? 's' : ''}
                        </span>
                      )}
                      {data.trades > 0 && (
                        <span style={{ fontSize: 9, color: 'var(--text-muted)', lineHeight: 1.3 }}>
                          {data.trades} Trade{data.trades > 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function NavBtn({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} style={{
      background: 'transparent', border: 'none', color: 'var(--text-muted)',
      cursor: 'pointer', padding: '4px 6px', borderRadius: 4,
      display: 'flex', alignItems: 'center', transition: 'color 0.15s, background 0.15s',
    }}
      onMouseEnter={e => { e.currentTarget.style.color = 'var(--text-main)'; e.currentTarget.style.background = 'var(--bg-surface-elevated)' }}
      onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.background = 'transparent' }}
    >
      {children}
    </button>
  )
}
