'use client'
import { useRouter } from 'next/navigation'
import { useAuthModal } from '@/context/AuthModalContext'
import { useTerminalStore } from '@/store/terminal'
import { useMarketStore } from '@/store/market'
import Header from '@/components/Header'
import ChartArea from '@/components/ChartArea'
import { fmtPrice, fmtPct, fmtCompact, fmtVol } from '@/lib/formatters'
import wsManager from '@/ws/manager'

export default function PublicMarketPage() {
  const router = useRouter()
  const { user, openModal } = useAuthModal()
  const { symbol, setSymbol } = useTerminalStore()
  const symbols = useMarketStore(s => s.symbols)
  const tickers = useMarketStore(s => s.tickers)
  const ticker  = tickers[symbol]
  const symInfo = symbols.find(s => s.symbol === symbol)

  const change = ticker?.change_24h_pct ?? symInfo?.change_24h_pct ?? 0

  return (
    <div className="public-market-layout">
      <Header variant="landing" />

      <div className="symbol-tabs">
        {symbols.map(s => {
          const t   = tickers[s.symbol]
          const chg = t?.change_24h_pct ?? s.change_24h_pct ?? 0
          return (
            <div key={s.symbol}
              className={`symbol-tab${symbol === s.symbol ? ' active' : ''}`}
              onClick={() => { setSymbol(s.symbol); wsManager.changeSymbol(s.symbol) }}>
              <span className="sym-name">{s.symbol}</span>
              <span className="sym-price">{t ? `$${fmtPrice(t.last_price, s.price_dp)}` : '—'}</span>
              <span className={`sym-chg ${chg >= 0 ? 'text-buy' : 'text-sell'}`}>{fmtPct(chg)}</span>
            </div>
          )
        })}
      </div>

      {ticker && (
        <div className="price-stat-bar">
          <span className={`price-main ${change >= 0 ? 'text-buy' : 'text-sell'}`}>
            ${fmtPrice(ticker.last_price, symInfo?.price_dp ?? 2)}
          </span>
          <span className={`price-change ${change >= 0 ? 'text-buy' : 'text-sell'}`}>{fmtPct(change)}</span>
          <div className="price-stat"><span className="ps-label">24h H</span><span className="ps-value">${fmtPrice(ticker.high_24h, 2)}</span></div>
          <div className="price-stat"><span className="ps-label">24h L</span><span className="ps-value">${fmtPrice(ticker.low_24h, 2)}</span></div>
          <div className="price-stat"><span className="ps-label">Vol</span><span className="ps-value">{fmtVol(ticker.volume_24h)}</span></div>
          <div className="price-stat"><span className="ps-label">VWAP</span><span className="ps-value">${fmtPrice(ticker.vwap, 2)}</span></div>
          <div className="price-stat"><span className="ps-label">Spread</span><span className="ps-value">${fmtPrice(ticker.spread, 4)}</span></div>
        </div>
      )}

      <div className="public-chart-wrap">
        <div className="public-chart-main" style={{ display: 'flex' }}>
          <ChartArea symbol={symbol} />
        </div>

        <div className="public-cta-panel">
          <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'rgba(52,211,153,0.1)', border: '1px solid rgba(52,211,153,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div className="status-indicator" />
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-main)', marginBottom: 6 }}>Trade This Market</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.6 }}>
              Sign up free and receive{' '}
              <span style={{ color: 'var(--buy)' }}>$100,000</span> in simulated capital.
            </div>
          </div>

          {user ? (
            <button className="btn-minimal btn-buy" onClick={() => router.push('/trade')}>
              Open Terminal →
            </button>
          ) : (
            <>
              <button className="btn-minimal btn-buy" onClick={() => openModal('register')}>
                Create Account
              </button>
              <button onClick={() => openModal('login')}
                style={{ fontSize: 11, color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer' }}>
                Sign in instead
              </button>
            </>
          )}

          {symInfo && (
            <div style={{ width: '100%', borderTop: '1px solid var(--border-dim)', paddingTop: 12 }}>
              {[
                { label: 'Category', value: symInfo.category },
                symInfo.market_cap ? { label: 'Mkt Cap', value: fmtCompact(symInfo.market_cap * 1e9) } : null,
              ].filter(Boolean).map(r => (
                <div key={r!.label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, marginBottom: 6 }}>
                  <span className="text-muted">{r!.label}</span>
                  <span style={{ color: 'var(--text-main)', textTransform: 'capitalize' }}>{r!.value}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
