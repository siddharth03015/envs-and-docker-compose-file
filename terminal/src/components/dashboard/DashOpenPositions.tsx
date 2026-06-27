'use client'
import type { Portfolio } from '@/types'
import { fmtUSD } from '@/lib/formatters'

interface Props {
  portfolio: Portfolio | null
}

export default function DashOpenPositions({ portfolio }: Props) {
  const positions = portfolio ? Object.values(portfolio.positions ?? {}) : []

  return (
    <div style={{
      background: 'var(--bg-surface)', border: '1px solid var(--border-dim)',
      borderRadius: 8, overflow: 'hidden', display: 'flex', flexDirection: 'column',
    }}>
      {/* Header */}
      <div style={{
        padding: '11px 16px', borderBottom: '1px solid var(--border-dim)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0,
      }}>
        <span style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 500 }}>
          Open Positions
        </span>
        <span style={{
          fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)',
          background: 'var(--bg-surface-elevated)', padding: '2px 7px', borderRadius: 3,
        }}>
          {positions.length}
        </span>
      </div>

      {/* Table */}
      <div style={{ overflow: 'auto', flex: 1 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: 'var(--bg-surface-elevated)' }}>
              {['Open Time', 'Symbol', 'Order', 'Net P&L'].map(h => (
                <th key={h} style={{
                  padding: '8px 14px',
                  textAlign: h === 'Order' || h === 'Net P&L' ? 'right' : 'left',
                  fontSize: 10, color: 'var(--text-muted)',
                  textTransform: 'uppercase', letterSpacing: '0.07em',
                  fontWeight: 500, whiteSpace: 'nowrap',
                }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {positions.length === 0 ? (
              <tr>
                <td colSpan={4} style={{ padding: '28px 14px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
                  No open positions
                </td>
              </tr>
            ) : positions.map(p => (
              <tr key={p.symbol} style={{ borderTop: '1px solid var(--border-dim)', transition: 'background 0.1s' }}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.02)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <td style={{ padding: '11px 14px', color: 'var(--text-muted)', fontSize: 11, fontFamily: 'var(--font-mono)' }}>
                  —
                </td>
                <td style={{ padding: '11px 14px', fontWeight: 700, color: 'var(--text-main)', fontSize: 12 }}>
                  {p.symbol}
                </td>
                <td style={{ padding: '11px 14px', textAlign: 'right' }}>
                  <span style={{
                    color: p.quantity >= 0 ? 'var(--buy)' : 'var(--sell)',
                    fontWeight: 700, fontSize: 11, fontFamily: 'var(--font-mono)',
                    background: p.quantity >= 0 ? 'rgba(52,211,153,0.08)' : 'rgba(248,113,113,0.08)',
                    padding: '2px 7px', borderRadius: 3,
                  }}>
                    {p.quantity >= 0 ? 'BUY' : 'SELL'}
                  </span>
                </td>
                <td style={{
                  padding: '11px 14px', textAlign: 'right',
                  fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 12,
                  color: p.unrealized_pnl >= 0 ? 'var(--buy)' : 'var(--sell)',
                }}>
                  {p.unrealized_pnl >= 0 ? '+' : ''}{fmtUSD(p.unrealized_pnl)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
