'use client'
import { useEffect, useState, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useAuthModal } from '@/context/AuthModalContext'
import { useTerminalStore } from '@/store/terminal'
import { useMarketStore } from '@/store/market'
import Header from '@/components/Header'
import ChartArea from '@/components/ChartArea'
import OrderBook from '@/components/OrderBook'
import OrderEntry from '@/components/OrderEntry'
import PortfolioSummary from '@/components/PortfolioSummary'
import PnLChart from '@/components/PnLChart'
import OpenOrders from '@/components/OpenOrders'
import LeaderboardPanel from '@/components/LeaderboardPanel'
import MyTrades from '@/components/MyTrades'
import ToastStack from '@/components/ToastStack'
import FillFlash from '@/components/FillFlash'
import ResizeHandle from '@/components/ResizeHandle'
import { KB_EVENT_CHART_FULLSCREEN } from '@/hooks/useKeyboardShortcuts'
import { fmtPrice, fmtPct, fmtVol } from '@/lib/formatters'
import { fetchOpenOrders, fetchPortfolio, fetchMyTrades } from '@/lib/market'
import wsManager from '@/ws/manager'

const MIN_SIDE   = 180   // minimum width when open
const MIN_CENTER = 320   // center column minimum
const MIN_BOTTOM = 32    // collapsed bottom = just the tab bar height

export default function TradePage() {
  const router                = useRouter()
  const { user, initialized } = useAuthModal()
  const { symbol, setSymbol, activeTab, setActiveTab } = useTerminalStore()
  const symbols = useMarketStore(s => s.symbols)
  const tickers = useMarketStore(s => s.tickers)
  const ticker  = tickers[symbol]
  const symInfo = symbols.find(s => s.symbol === symbol)
  const change  = ticker?.change_24h_pct ?? symInfo?.change_24h_pct ?? 0

  // ── Panel dimensions ─────────────────────────────────────────────────────
  const [leftW,         setLeftW]         = useState(280)
  const [rightW,        setRightW]        = useState(300)
  const [bottomH,       setBottomH]       = useState(230)
  const [portfolioLeft, setPortfolioLeft] = useState(360)

  // ── Collapse state ────────────────────────────────────────────────────────
  const [leftCollapsed,   setLeftCollapsed]   = useState(false)
  const [rightCollapsed,  setRightCollapsed]  = useState(false)
  const [bottomCollapsed, setBottomCollapsed] = useState(false)

  // Remember pre-collapse sizes so we can restore
  const savedLeft   = useRef(280)
  const savedRight  = useRef(300)
  const savedBottom = useRef(230)

  // ── Toolbar height ref (so ghost strips start below it) ───────────────────
  const toolbarRef = useRef<HTMLDivElement>(null)
  const tradeChartFullscreenRef = useRef<HTMLDivElement>(null)
  const [toolbarH, setToolbarH] = useState(132) // header(60)+tabs(28)+statbar(36)+8 approx
  useEffect(() => {
    const toolbarEl = toolbarRef.current
    if (!toolbarEl) return

    let isDisposed = false
    const updateToolbarHeight = () => {
      if (isDisposed || !toolbarEl.isConnected) return
      setToolbarH(toolbarEl.getBoundingClientRect().bottom)
    }

    updateToolbarHeight()
    const obs = new ResizeObserver(updateToolbarHeight)
    obs.observe(toolbarEl)

    return () => {
      isDisposed = true
      obs.disconnect()
    }
  }, [])

  useEffect(() => {
    if (initialized && !user) router.replace('/')
  }, [initialized, user, router])

  useEffect(() => {
    if (!user) return
    const { setOpenOrders, setPortfolio, setMyTrades } = useTerminalStore.getState()
    fetchOpenOrders().then(setOpenOrders).catch(() => {})
    fetchPortfolio().then(setPortfolio).catch(() => {})
    fetchMyTrades(200).then(setMyTrades).catch(() => {})
  }, [user])

  // ── Resize deltas ─────────────────────────────────────────────────────────
  const onLeftDelta = useCallback((d: number) => {
    if (leftCollapsed) return
    setLeftW(w => Math.max(MIN_SIDE, Math.min(600, w + d)))
  }, [leftCollapsed])

  const onRightDelta = useCallback((d: number) => {
    if (rightCollapsed) return
    setRightW(w => Math.max(MIN_SIDE, Math.min(600, w - d)))
  }, [rightCollapsed])

  const onBottomDelta = useCallback((d: number) => {
    if (bottomCollapsed) return
    setBottomH(h => Math.max(MIN_BOTTOM + 40, Math.min(700, h - d)))
  }, [bottomCollapsed])

  // ── Collapse toggles (save/restore size) ─────────────────────────────────
  const toggleLeft = useCallback(() => {
    setLeftCollapsed(v => {
      if (!v) savedLeft.current = leftW          // about to collapse — save
      else setLeftW(savedLeft.current)            // about to expand  — restore
      return !v
    })
  }, [leftW])

  const toggleRight = useCallback(() => {
    setRightCollapsed(v => {
      if (!v) savedRight.current = rightW
      else setRightW(savedRight.current)
      return !v
    })
  }, [rightW])

  const toggleBottom = useCallback(() => {
    setBottomCollapsed(v => {
      if (!v) savedBottom.current = bottomH
      else setBottomH(savedBottom.current)
      return !v
    })
  }, [bottomH])

  const toggleTradeChartFullscreen = useCallback(() => {
    const chartEl = tradeChartFullscreenRef.current
    if (!chartEl) return

    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {})
      return
    }

    void chartEl.requestFullscreen().catch(() => {})
  }, [])

  useEffect(() => {
    const onChartFullscreen = () => {
      toggleTradeChartFullscreen()
    }

    document.addEventListener(KB_EVENT_CHART_FULLSCREEN, onChartFullscreen)
    return () => document.removeEventListener(KB_EVENT_CHART_FULLSCREEN, onChartFullscreen)
  }, [toggleTradeChartFullscreen])

  if (!initialized || !user) return null

  const tabs = [
    { id: 'orders'      as const, label: 'Open Orders' },
    { id: 'portfolio'   as const, label: 'Portfolio' },
    { id: 'mytrades'    as const, label: 'My Trades' },
    { id: 'leaderboard' as const, label: 'Leaderboard' },
  ]

  const effectiveLeft   = leftCollapsed   ? 0 : leftW
  const effectiveRight  = rightCollapsed  ? 0 : rightW
  const effectiveBottom = bottomCollapsed ? MIN_BOTTOM : bottomH

  return (
    <div className="app-container" style={{ paddingTop: 56 }}>
      <Header />

      {/* Toolbar block — measured for ghost strip positioning */}
      <div ref={toolbarRef}>
        {/* Symbol tabs */}
        <div className="symbol-tabs">
          {symbols.map(s => {
            const t = tickers[s.symbol]
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

        {/* Price stat bar */}
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
            <div className="price-stat"><span className="ps-label">Bid</span><span className="ps-value text-buy">${fmtPrice(ticker.best_bid, 2)}</span></div>
            <div className="price-stat"><span className="ps-label">Ask</span><span className="ps-value text-sell">${fmtPrice(ticker.best_ask, 2)}</span></div>
            <div className="price-stat"><span className="ps-label">Spread</span><span className="ps-value">${fmtPrice(ticker.spread, 4)}</span></div>
          </div>
        )}
      </div>

      {/* ── Resizable main layout ─────────────────────────────────────────── */}
      <main className="main-content" style={{ flexDirection: 'row', overflow: 'hidden' }}>

        {/* LEFT: Order Book */}
        <div style={{
          width: effectiveLeft,
          minWidth: 0,
          flexShrink: 0,
          overflow: 'hidden',
          transition: 'width 0.18s cubic-bezier(0.4,0,0.2,1)',
          display: 'flex', flexDirection: 'column',
          background: 'var(--bg-surface)',
        }}>
          <OrderBook symbol={symbol} />
        </div>

        {/* HANDLE: left ↔ center */}
        <ResizeHandle direction="col" onDelta={onLeftDelta} onCollapse={toggleLeft} collapsed={leftCollapsed} />

        {/* CENTER: Chart + bottom panel */}
        <div style={{ flex: 1, minWidth: MIN_CENTER, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

          {/* Chart — always full remaining height */}
          <div ref={tradeChartFullscreenRef} style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex' }}>
            <ChartArea symbol={symbol} />
          </div>

          {/* HANDLE: chart ↕ bottom */}
          <ResizeHandle direction="row" onDelta={onBottomDelta} onCollapse={toggleBottom} collapsed={bottomCollapsed} />

          {/* Bottom panel */}
          <div style={{
            height: effectiveBottom,
            minHeight: MIN_BOTTOM,
            flexShrink: 0,
            display: 'flex', flexDirection: 'column',
            overflow: 'hidden',
            transition: 'height 0.18s cubic-bezier(0.4,0,0.2,1)',
          }}>
            {/* Tab bar — always visible even when collapsed */}
            <div className="bottom-tabs" style={{ flexShrink: 0 }}>
              {tabs.map(t => (
                <div key={t.id}
                  className={`bottom-tab${activeTab === t.id ? ' active' : ''}`}
                  onClick={() => {
                    if (bottomCollapsed) toggleBottom()
                    setActiveTab(t.id)
                  }}>
                  {t.label}
                </div>
              ))}
              {/* Collapse/expand toggle in the tab bar */}
              <div
                onClick={toggleBottom}
                title={bottomCollapsed ? 'Expand panel' : 'Collapse panel'}
                style={{
                  marginLeft: 'auto', padding: '0 12px', cursor: 'pointer',
                  color: 'var(--text-dark)', fontSize: 16, display: 'flex',
                  alignItems: 'center', userSelect: 'none', transition: 'color 0.15s',
                }}
                onMouseEnter={e => (e.currentTarget.style.color = 'var(--text-main)')}
                onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-dark)')}
              >
                {bottomCollapsed ? '▲' : '▼'}
              </div>
            </div>

            {/* Body — hidden when collapsed */}
            <div className="bottom-panel-body" style={{ flex: 1, overflow: 'hidden auto', display: bottomCollapsed ? 'none' : undefined }}>
              {activeTab === 'orders'      && <OpenOrders />}
              {activeTab === 'portfolio'   && (
                <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
                  <div style={{ width: portfolioLeft, minWidth: 160, flexShrink: 0, overflowY: 'auto' }}>
                    <PortfolioSummary />
                  </div>
                  <ResizeHandle
                    direction="col"
                    onDelta={d => setPortfolioLeft(w => Math.max(160, Math.min(700, w + d)))}
                  />
                  <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                    <div style={{ padding: '4px 12px', fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', borderBottom: '1px solid var(--border-dim)', flexShrink: 0 }}>
                      Equity Curve
                    </div>
                    <div style={{ flex: 1, minHeight: 0 }}>
                      <PnLChart height={180} />
                    </div>
                  </div>
                </div>
              )}
              {activeTab === 'mytrades'    && <MyTrades />}
              {activeTab === 'leaderboard' && <LeaderboardPanel />}
            </div>
          </div>
        </div>

        {/* HANDLE: center ↔ right */}
        <ResizeHandle direction="col" onDelta={onRightDelta} onCollapse={toggleRight} collapsed={rightCollapsed} />

        {/* RIGHT: Order Entry */}
        <div style={{
          width: effectiveRight,
          minWidth: 0,
          flexShrink: 0,
          overflow: 'hidden',
          transition: 'width 0.18s cubic-bezier(0.4,0,0.2,1)',
          display: 'flex', flexDirection: 'column',
          background: 'var(--bg-surface)',
        }}>
          <div className="panel-header">Order Entry</div>
          <div className="panel-body">
            <OrderEntry symbol={symbol} />
          </div>
        </div>

      </main>

      {/* ── Collapsed ghost strips — click to re-expand ───────────────────── */}
      {leftCollapsed && (
        <div
          onClick={toggleLeft}
          title="Expand Order Book"
          style={{
            position: 'fixed', left: 0, top: toolbarH, bottom: 0, width: 18, zIndex: 20,
            background: 'var(--bg-surface-elevated)',
            borderRight: '1px solid var(--border-dim)',
            cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            writingMode: 'vertical-rl', fontSize: 9, color: 'var(--text-muted)',
            letterSpacing: '1px', textTransform: 'uppercase', gap: 6,
          }}
        >
          <span style={{ transform: 'rotate(180deg)' }}>▲</span> Book
        </div>
      )}
      {rightCollapsed && (
        <div
          onClick={toggleRight}
          title="Expand Order Entry"
          style={{
            position: 'fixed', right: 0, top: toolbarH, bottom: 0, width: 18, zIndex: 20,
            background: 'var(--bg-surface-elevated)',
            borderLeft: '1px solid var(--border-dim)',
            cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            writingMode: 'vertical-rl', fontSize: 9, color: 'var(--text-muted)',
            letterSpacing: '1px', textTransform: 'uppercase',
          }}
        >
          Order ▲
        </div>
      )}

      <FillFlash />
      <ToastStack />
    </div>
  )
}
