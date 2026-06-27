'use client'
import { useState } from 'react'
import { useMarketStore } from '@/store/market'
import { fmtPrice, fmtQty, fmtTime } from '@/lib/formatters'
import DepthChart from './DepthChart'
import type { Trade } from '@/types'

const EMPTY_TRADES: Trade[] = []

interface Props { symbol: string }

export default function OrderBook({ symbol }: Props) {
  const ob       = useMarketStore(s => s.orderbooks[symbol])
  const tradeMap = useMarketStore(s => s.tradeMap)
  const trades   = tradeMap[symbol] ?? EMPTY_TRADES
  const [view, setView] = useState<'book' | 'depth'>('book')

  const asks = ob?.asks ?? []
  const bids = ob?.bids ?? []
  const spread = asks.length && bids.length ? asks[0].price - bids[0].price : null

  // Cumulative totals for depth display
  const asksWithTotal = [...asks].reverse().map((a, i, arr) => ({
    ...a,
    total: arr.slice(0, i + 1).reduce((s, x) => s + x.quantity, 0),
  }))
  const bidsWithTotal = bids.map((b, i, arr) => ({
    ...b,
    total: arr.slice(0, i + 1).reduce((s, x) => s + x.quantity, 0),
  }))
  const maxAskTotal = asksWithTotal.length ? asksWithTotal[asksWithTotal.length - 1].total : 0.001
  const maxBidTotal = bidsWithTotal.length ? bidsWithTotal[bidsWithTotal.length - 1].total : 0.001

  return (
    <div className="panel" style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column', flex: 1, height: '100%' }}>
      <div className="panel-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>Order Book</span>
        <div style={{ display: 'flex', gap: 4 }}>
          <button className={`toolbar-btn${view === 'book' ? ' active' : ''}`} style={{ padding: '2px 7px', fontSize: 10 }}
            onClick={() => setView('book')}>Book</button>
          <button className={`toolbar-btn${view === 'depth' ? ' active' : ''}`} style={{ padding: '2px 7px', fontSize: 10 }}
            onClick={() => setView('depth')}>Depth</button>
        </div>
      </div>

      {view === 'depth' ? (
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <DepthChart symbol={symbol} />
        </div>
      ) : (
        <div className="panel-body no-pad-body" style={{ padding: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', flex: 1 }}>

          {/* ── Asks (scrollable upward, anchored to spread) ── */}
          <div style={{ flex: 1, minHeight: 0, overflow: 'hidden auto', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
            <table className="clean-table" style={{ tableLayout: 'fixed' }}>
              <thead>
                <tr>
                  <th style={{ width: '38%' }}>Price</th>
                  <th>Size</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {asksWithTotal.map((a, i) => {
                  const pct = (a.total / maxAskTotal) * 100
                  return (
                    <tr key={i} className="ob-row depth-row">
                      <td className="text-sell">{fmtPrice(a.price, 2)}</td>
                      <td className="text-right font-mono">{fmtQty(a.quantity, 4)}</td>
                      <td className="text-right font-mono">
                        {fmtQty(a.total, 4)}
                        <div className="ob-depth-bar sell" style={{ width: `${pct}%` }} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* ── Spread row ── */}
          <div className="ob-spread" style={{ flexShrink: 0 }}>
            {asks.length && bids.length
              ? <><span className="text-main" style={{ fontWeight: 600 }}>{fmtPrice(asks[0].price, 2)}</span>{spread != null && <span style={{ marginLeft: 8, fontSize: 9 }}>Spread {fmtPrice(spread, 2)}</span>}</>
              : <span>—</span>
            }
          </div>

          {/* ── Bids ── */}
          <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
            <table className="clean-table" style={{ tableLayout: 'fixed' }}>
              <tbody>
                {bidsWithTotal.map((b, i) => {
                  const pct = (b.total / maxBidTotal) * 100
                  return (
                    <tr key={i} className="ob-row depth-row">
                      <td style={{ width: '38%' }} className="text-buy">{fmtPrice(b.price, 2)}</td>
                      <td className="text-right font-mono">{fmtQty(b.quantity, 4)}</td>
                      <td className="text-right font-mono">
                        {fmtQty(b.total, 4)}
                        <div className="ob-depth-bar buy" style={{ width: `${pct}%` }} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* ── Recent trades — fixed height, scrolls internally ── */}
          <div style={{ flexShrink: 0, height: 180, overflow: 'hidden', borderTop: '1px solid var(--border-dim)', display: 'flex', flexDirection: 'column' }}>
            <div className="stat-label" style={{ padding: '6px 16px 4px', flexShrink: 0 }}>Recent Trades</div>
            <div style={{ flex: 1, overflowY: 'auto' }}>
              <table className="clean-table" style={{ padding: '0 16px' }}>
                <tbody>
                  {trades.slice(0, 30).map((t, i) => (
                    <tr key={t.id ?? i} className="tape-row">
                      <td className="text-muted">{fmtTime(t.timestamp)}</td>
                      <td className={t.aggressor_side === 'BUY' ? 'text-buy text-right' : 'text-sell text-right'}>
                        {fmtPrice(t.price, 2)}
                      </td>
                      <td className="text-right font-mono">{fmtQty(t.quantity, 4)}</td>
                    </tr>
                  ))}
                  {trades.length === 0 && (
                    <tr><td colSpan={3} className="text-center" style={{ padding: '8px 0', color: 'var(--text-dark)', fontSize: 11 }}>Waiting…</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
