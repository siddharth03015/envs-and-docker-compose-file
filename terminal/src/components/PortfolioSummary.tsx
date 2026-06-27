'use client'
import { useState } from 'react'
import { useTerminalStore } from '@/store/terminal'
import { fmtUSD, fmtPnL, fmtPct, fmtPrice } from '@/lib/formatters'
import { useAnimatedNumber } from '@/hooks/useAnimatedNumber'
import { submitOrder } from '@/lib/market'

export default function PortfolioSummary() {
  const portfolio = useTerminalStore(s => s.portfolio)
  const [closing, setClosing] = useState<string | null>(null)

  const positions = Object.values(portfolio?.positions ?? {})
  const totalUnrealized = positions.reduce((s, p) => s + p.unrealized_pnl, 0)
  const totalPnL = (portfolio?.realized_pnl ?? 0) + totalUnrealized
  const pnlPct   = (((portfolio?.total_value ?? 100_000) / 100_000) - 1) * 100

  // Animated values — hooks must be called unconditionally
  const animTotalValue = useAnimatedNumber(portfolio?.total_value ?? 0)
  const animCash       = useAnimatedNumber(portfolio?.cash ?? 0)
  const animTotalPnL   = useAnimatedNumber(totalPnL)

  if (!portfolio) {
    return (
      <div style={{ padding: '12px 16px' }}>
        <div className="empty-state">Loading portfolio…</div>
      </div>
    )
  }

  const closePosition = async (sym: string, qty: number) => {
    if (closing) return
    setClosing(sym)
    try {
      const side = qty > 0 ? 'SELL' : 'BUY'
      await submitOrder({ symbol: sym, side, type: 'MARKET', quantity: Math.abs(qty) })
    } catch { /* ignore */ } finally {
      setClosing(null)
    }
  }

  return (
    <div style={{ padding: '8px 16px', overflow: 'auto', height: '100%' }}>

      {/* Summary row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 16 }}>
        <div className="stat-block">
          <div className="stat-label">Total Value</div>
          <div className="stat-value text-main">{fmtUSD(animTotalValue)}</div>
          <div className={`stat-sub ${pnlPct >= 0 ? 'text-buy' : 'text-sell'}`}>{pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(2)}% from $100k</div>
        </div>
        <div className="stat-block">
          <div className="stat-label">Cash</div>
          <div className="stat-value text-main">{fmtUSD(animCash)}</div>
          <div className="stat-sub text-muted">{((portfolio.cash / portfolio.total_value) * 100).toFixed(1)}% of portfolio</div>
        </div>
        <div className="stat-block">
          <div className="stat-label">Total P&L</div>
          <div className={`stat-value ${totalPnL >= 0 ? 'text-buy' : 'text-sell'}`}>{fmtPnL(animTotalPnL)}</div>
          <div className="stat-sub text-muted">R: {fmtPnL(portfolio.realized_pnl)} / U: {fmtPnL(totalUnrealized)}</div>
        </div>
      </div>

      {/* Positions table */}
      {positions.length > 0 ? (
        <table className="orders-table">
          <thead>
            <tr>
              <th>Symbol</th>
              <th style={{ textAlign: 'right' }}>Qty</th>
              <th style={{ textAlign: 'right' }}>Avg Entry</th>
              <th style={{ textAlign: 'right' }}>Last Price</th>
              <th style={{ textAlign: 'right' }}>Mkt Value</th>
              <th style={{ textAlign: 'right' }}>Unrl. P&L</th>
              <th style={{ textAlign: 'right' }}>%</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {positions.map(p => (
              <tr key={p.symbol}>
                <td style={{ fontWeight: 600 }}>{p.symbol}</td>
                <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}
                  className={p.quantity >= 0 ? 'text-buy' : 'text-sell'}>
                  {p.quantity >= 0 ? '+' : ''}{p.quantity.toFixed(4)}
                </td>
                <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>${fmtPrice(p.avg_entry_price, 2)}</td>
                <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>${fmtPrice(p.current_price, 2)}</td>
                <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{fmtUSD(p.market_value)}</td>
                <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}
                  className={p.unrealized_pnl >= 0 ? 'text-buy' : 'text-sell'}>
                  {fmtPnL(p.unrealized_pnl)}
                </td>
                <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}
                  className={p.unrealized_pnl_pct >= 0 ? 'text-buy' : 'text-sell'}>
                  {fmtPct(p.unrealized_pnl_pct * 100)}
                </td>
                <td style={{ textAlign: 'right' }}>
                  <button
                    onClick={() => closePosition(p.symbol, p.quantity)}
                    disabled={closing === p.symbol}
                    style={{
                      padding: '2px 8px', fontSize: 11, borderRadius: 4, border: 'none', cursor: 'pointer',
                      background: closing === p.symbol ? 'var(--c-muted)' : 'rgba(239,83,80,0.15)',
                      color: closing === p.symbol ? 'var(--c-muted)' : 'var(--c-sell)',
                      fontWeight: 600, letterSpacing: '0.04em',
                    }}
                    title={`Close ${p.symbol} position at market`}
                  >
                    {closing === p.symbol ? '…' : 'CLOSE'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="empty-state">No open positions</div>
      )}
    </div>
  )
}
