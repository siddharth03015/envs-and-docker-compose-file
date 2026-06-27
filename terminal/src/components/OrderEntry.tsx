'use client'
import { useState, useEffect } from 'react'
import { useTerminalStore } from '@/store/terminal'
import { useMarketStore } from '@/store/market'
import { submitOrder, fetchOpenOrders } from '@/lib/market'
import { fmtPrice, fmtUSD } from '@/lib/formatters'
import type { OrderSide, OrderType } from '@/types'

interface Props { symbol: string }

export default function OrderEntry({ symbol }: Props) {
  const tickers   = useMarketStore(s => s.tickers)
  const { portfolio, setOpenOrders } = useTerminalStore()
  const ticker    = tickers[symbol]

  const [side,  setSide]  = useState<OrderSide>('BUY')
  const [type,  setType]  = useState<OrderType>('LIMIT')
  const [price, setPrice] = useState('')
  const [stop,  setStop]  = useState('')
  const [qty,   setQty]   = useState('')
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null)

  // Respond to keyboard shortcuts B/S from useKeyboardShortcuts hook
  useEffect(() => {
    const onSide = (e: Event) => {
      const side = (e as CustomEvent<string>).detail as OrderSide
      if (side === 'BUY' || side === 'SELL') setSide(side)
    }
    document.addEventListener('kb:order-side', onSide)
    return () => document.removeEventListener('kb:order-side', onSide)
  }, [])

  const needPrice = type === 'LIMIT' || type === 'STOP_LIMIT'
  const needStop  = type === 'STOP_LIMIT'
  const mid       = ticker?.last_price ?? 0
  const estCost   = qty ? parseFloat(qty) * (needPrice && price ? parseFloat(price) : mid) : null

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!qty || parseFloat(qty) <= 0) return
    setLoading(true); setMsg(null)
    try {
      await submitOrder({
        symbol, side, type,
        quantity:   parseFloat(qty),
        price:      needPrice && price ? parseFloat(price) : undefined,
        stop_price: needStop  && stop  ? parseFloat(stop)  : undefined,
      })
      setMsg({ text: `${side} order placed`, ok: true })
      setQty(''); setPrice(''); setStop('')
      const orders = await fetchOpenOrders()
      setOpenOrders(orders)
    } catch (err: unknown) {
      const e = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
      setMsg({ text: e ?? 'Order failed', ok: false })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <div className="side-tabs">
        <div className={`side-tab buy ${side === 'BUY' ? 'active' : 'inactive'}`}
          onClick={() => setSide('BUY')}>Buy</div>
        <div className={`side-tab sell ${side === 'SELL' ? 'active' : 'inactive'}`}
          onClick={() => setSide('SELL')}>Sell</div>
      </div>

      <div className="type-tabs">
        {(['LIMIT', 'MARKET', 'STOP_LIMIT'] as OrderType[]).map(t => (
          <div key={t} className={`type-tab${type === t ? ' active' : ''}`}
            onClick={() => setType(t)}>
            {t === 'STOP_LIMIT' ? 'STOP' : t}
          </div>
        ))}
      </div>

      <form onSubmit={submit}>
        {needPrice && (
          <div className="input-row">
            <div className="input-label">Price (USD)</div>
            <div style={{ position: 'relative' }}>
              <input type="number" step="any" className="input-minimal" value={price}
                onChange={e => setPrice(e.target.value)} placeholder={mid > 0 ? fmtPrice(mid, 2) : '0.00'} />
              {mid > 0 && (
                <button type="button" onClick={() => setPrice(mid.toFixed(2))}
                  style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', fontSize: 9, color: 'var(--text-dark)', background: 'none', border: 'none', cursor: 'pointer' }}>
                  MKT
                </button>
              )}
            </div>
          </div>
        )}

        {needStop && (
          <div className="input-row">
            <div className="input-label">Stop Price (USD)</div>
            <input type="number" step="any" className="input-minimal" value={stop}
              onChange={e => setStop(e.target.value)} placeholder="0.00" />
          </div>
        )}

        <div className="input-row-lg">
          <div className="input-label">Quantity</div>
          <input type="number" step="any" className="input-minimal" value={qty}
            onChange={e => setQty(e.target.value)} placeholder="0.00000" />
        </div>

        {estCost != null && (
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-muted)', marginBottom: 12 }}>
            <span>Est. {side === 'BUY' ? 'Cost' : 'Proceeds'}</span>
            <span className="font-mono">{fmtUSD(estCost)}</span>
          </div>
        )}

        {portfolio && (
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-dark)', marginBottom: 16 }}>
            <span>Cash</span>
            <span className="font-mono">{fmtUSD(portfolio.cash)}</span>
          </div>
        )}

        <div className="action-buttons">
          <button type="submit" disabled={loading}
            className={`btn-minimal ${side === 'BUY' ? 'btn-buy' : 'btn-sell'}`}
            style={{ opacity: loading ? 0.6 : 1 }}>
            {loading ? '…' : `${side} ${symbol ? symbol.split('-')[0] : ''}`}
          </button>
        </div>
      </form>

      {msg && (
        <div style={{ fontSize: 11, padding: '6px 8px', borderRadius: 3, marginTop: 4, textAlign: 'center',
          background: msg.ok ? 'rgba(52,211,153,0.1)' : 'rgba(248,113,113,0.1)',
          color: msg.ok ? 'var(--buy)' : 'var(--sell)' }}>
          {msg.text}
        </div>
      )}
    </div>
  )
}
