'use client'
import { useEffect } from 'react'
import { useTerminalStore } from '@/store/terminal'
import { fetchMyTrades } from '@/lib/market'
import { fmtPrice, fmtQty, fmtDateTime } from '@/lib/formatters'

export default function MyTrades() {
  const myTrades   = useTerminalStore(s => s.myTrades)
  const setMyTrades = useTerminalStore(s => s.setMyTrades)

  useEffect(() => {
    fetchMyTrades(200).then(setMyTrades).catch(() => {})
  }, [setMyTrades])

  if (myTrades.length === 0) {
    return <div className="empty-state">No trade history yet</div>
  }

  return (
    <table className="orders-table">
      <thead>
        <tr>
          <th>Time</th>
          <th>Symbol</th>
          <th>Side</th>
          <th style={{ textAlign: 'right' }}>Price</th>
          <th style={{ textAlign: 'right' }}>Qty</th>
          <th style={{ textAlign: 'right' }}>Value</th>
        </tr>
      </thead>
      <tbody>
        {myTrades.map(t => (
          <tr key={t.id}>
            <td className="text-muted">{fmtDateTime(t.timestamp)}</td>
            <td style={{ fontWeight: 600 }}>{t.symbol}</td>
            <td className={t.side === 'BUY' ? 'text-buy' : 'text-sell'} style={{ fontWeight: 600 }}>{t.side}</td>
            <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>${fmtPrice(t.price, 2)}</td>
            <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{fmtQty(t.quantity, 4)}</td>
            <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
              ${fmtPrice(t.price * t.quantity, 2)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
