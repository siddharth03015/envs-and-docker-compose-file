'use client'
import { useEffect } from 'react'
import { useTerminalStore } from '@/store/terminal'
import { fetchOpenOrders, cancelOrder } from '@/lib/market'
import { fmtPrice, fmtQty, fmtDateTime } from '@/lib/formatters'

export default function OpenOrders() {
  const { openOrders, setOpenOrders, removeOrder } = useTerminalStore()

  useEffect(() => {
    fetchOpenOrders().then(setOpenOrders).catch(() => {})
  }, [setOpenOrders])

  if (openOrders.length === 0) {
    return <div className="empty-state">No open orders</div>
  }

  const cancel = async (id: string, sym: string) => {
    try { await cancelOrder(id, sym); removeOrder(id) } catch { /* */ }
  }

  return (
    <table className="orders-table">
      <thead>
        <tr>
          <th>Symbol</th><th>Side</th><th>Type</th>
          <th style={{ textAlign: 'right' }}>Price</th>
          <th style={{ textAlign: 'right' }}>Qty</th>
          <th style={{ textAlign: 'right' }}>Filled</th>
          <th>Status</th><th>Created</th><th></th>
        </tr>
      </thead>
      <tbody>
        {openOrders.map(o => (
          <tr key={o.id}>
            <td style={{ fontWeight: 600 }}>{o.symbol}</td>
            <td className={o.side === 'BUY' ? 'text-buy' : 'text-sell'} style={{ fontWeight: 600 }}>{o.side}</td>
            <td className="text-muted">{o.type}</td>
            <td style={{ textAlign: 'right' }}>{o.price > 0 ? fmtPrice(o.price, 2) : 'MKT'}</td>
            <td style={{ textAlign: 'right' }}>{fmtQty(o.quantity, 4)}</td>
            <td style={{ textAlign: 'right' }}>{fmtQty(o.filled ?? 0, 4)}</td>
            <td>
              <span className={`badge ${o.status === 'OPEN' ? 'badge-open' : o.status === 'PARTIAL' ? 'badge-partial' : 'badge-filled'}`}>
                {o.status}
              </span>
            </td>
            <td className="text-muted">{fmtDateTime(new Date(o.created_at).getTime())}</td>
            <td>
              <button className="cancel-btn" onClick={() => cancel(o.id, o.symbol)}>✕</button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
