'use client'
import { useEffect, useRef } from 'react'
import type { SymbolInfo as KlineSymInfo, Period, Datafeed, DatafeedSubscribeCallback } from '@klinecharts/pro'
import type { SymbolInfo as StoreSymbol } from '@/types'
import { WS_BASE } from '@/constants'
import { fetchOHLCVHistory } from '@/lib/market'
import { useMarketStore } from '@/store/market'
import { useTerminalStore } from '@/store/terminal'
import { fmtPrice, fmtPct } from '@/lib/formatters'

type KLineData = { timestamp: number; open: number; high: number; low: number; close: number; volume: number }

const PERIODS: Period[] = [
  { multiplier: 1, timespan: 'second', text: '1s' },
  { multiplier: 5, timespan: 'second', text: '5s' },
  { multiplier: 1, timespan: 'minute', text: '1m' },
  { multiplier: 5, timespan: 'minute', text: '5m' },
]

const INTERVAL_LIST = ['1s', '5s', '1m', '5m']

function storeToKline(s: StoreSymbol): KlineSymInfo {
  return {
    ticker:          s.symbol,
    name:            s.label ?? s.symbol,
    shortName:       s.base_asset ?? s.symbol.replace('-USD', ''),
    market:          s.category,
    exchange:        'Synthetic',
    pricePrecision:  s.price_dp ?? 2,
    volumePrecision: s.qty_dp  ?? 4,
  }
}

interface Props {
  symbol: string
  interval?: string
  onSymbolChange?: (s: string) => void
  onIntervalChange?: (i: string) => void
  onNavigate?: () => void
  onSplitHorizontally?: () => void
  onSplitVertically?: () => void
  onClosePanel?: () => void
}

export default function KlineProMiniInner({
  symbol,
  interval = '1m',
  onSymbolChange,
  onIntervalChange,
  onNavigate,
  onSplitHorizontally,
  onSplitVertically,
  onClosePanel,
}: Props) {
  const theme        = useTerminalStore(s => s.theme)
  const themeRef     = useRef(theme)
  themeRef.current = theme
  const storeSymbols = useMarketStore(s => s.symbols)
  const tickers      = useMarketStore(s => s.tickers)
  const ticker       = tickers[symbol]
  const symMeta      = storeSymbols.find(s => s.symbol === symbol)
  const change       = ticker?.change_24h_pct ?? symMeta?.change_24h_pct ?? 0
  const symbolList   = storeSymbols.length > 0 ? storeSymbols.map(s => s.symbol) : ['BTC-USD', 'ETH-USD', 'SOL-USD']

  // Keep a ref so datafeed closure always reads the latest list
  const storeSymbolsRef = useRef<StoreSymbol[]>(storeSymbols)
  storeSymbolsRef.current = storeSymbols

  const containerRef = useRef<HTMLDivElement>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chartRef = useRef<any>(null)
  const wsRef    = useRef<WebSocket | null>(null)
  const cbRef    = useRef<DatafeedSubscribeCallback | null>(null)

  const period = PERIODS.find(p => p.text === interval) ?? PERIODS[2]

  useEffect(() => {
    if (!containerRef.current || typeof ResizeObserver === 'undefined') return

    let rafId: number | null = null
    const container = containerRef.current

    const forceResize = () => {
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId)
      }

      rafId = window.requestAnimationFrame(() => {
        rafId = null
        try {
          const internalChart = chartRef.current?._chartApi
          if (internalChart && typeof internalChart.resize === 'function') {
            internalChart.resize()
            return
          }
        } catch {
          // Fall through to global event fallback.
        }
        window.dispatchEvent(new Event('resize'))
      })
    }

    const observer = new ResizeObserver(() => {
      forceResize()
    })

    observer.observe(container)

    return () => {
      observer.disconnect()
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId)
      }
    }
  }, [])

  // ── Create / recreate chart when symbol or interval changes ───────────────
  useEffect(() => {
    if (!containerRef.current) return
    let disposed = false

    // Teardown previous
    if (wsRef.current) { wsRef.current.close(); wsRef.current = null }
    if (containerRef.current) containerRef.current.innerHTML = ''
    chartRef.current = null

    const sym = storeSymbolsRef.current.find(s => s.symbol === symbol)

    const datafeed: Datafeed = {
      async searchSymbols(_search?: string): Promise<KlineSymInfo[]> {
        return storeSymbolsRef.current.length > 0
          ? storeSymbolsRef.current.map(storeToKline)
          : [{ ticker: 'BTC-USD', name: 'BTC-USD', shortName: 'BTC', market: 'crypto', exchange: 'Synthetic' }]
      },

      async getHistoryKLineData(
        s: KlineSymInfo,
        per: Period,
        _from: number,
        _to: number,
      ): Promise<KLineData[]> {
        try {
          const candles = await fetchOHLCVHistory(s.ticker, per.text, 500)
          return candles.map(c => ({
            timestamp: Number(c.time) * 1000,
            open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume,
          }))
        } catch {
          return []
        }
      },

      subscribe(s: KlineSymInfo, per: Period, callback: DatafeedSubscribeCallback) {
        if (wsRef.current) { wsRef.current.close(); wsRef.current = null }
        cbRef.current = callback
        const token  = (typeof window !== 'undefined' ? localStorage.getItem('token') : null) ?? ''
        const params = new URLSearchParams({ token, symbol: s.ticker })
        const ws     = new WebSocket(`${WS_BASE}/ws?${params}`)
        wsRef.current = ws
        ws.onmessage = (e) => {
          try {
            const msg = JSON.parse(e.data)
            if (msg.type !== 'ohlcv') return
            const msgInterval = msg.interval ?? msg.candle?.interval ?? ''
            if (msgInterval && msgInterval !== per.text) return
            const c = msg.candle
            if (!c) return
            cbRef.current?.({
              timestamp: Number(c.time) * 1000,
              open:   Number(c.open),
              high:   Number(c.high),
              low:    Number(c.low),
              close:  Number(c.close),
              volume: Number(c.volume ?? 0),
            })
          } catch { /* ignore */ }
        }
      },

      unsubscribe(_s: KlineSymInfo, _per: Period) {
        if (wsRef.current) { wsRef.current.close(); wsRef.current = null }
        cbRef.current = null
      },
    }

    const createPro = async () => {
      const { KLineChartPro } = await import('@klinecharts/pro')
      if (disposed || !containerRef.current) return

      const chart = new KLineChartPro({
        container:         containerRef.current!,
        theme:             themeRef.current,
        locale:            'en-US',
        drawingBarVisible: false,
        symbol:            sym ? storeToKline(sym) : {
          ticker: symbol, name: symbol, shortName: symbol.replace('-USD', ''),
          market: 'crypto', exchange: 'Synthetic',
          pricePrecision: symMeta?.price_dp ?? 2, volumePrecision: 4,
        },
        period,
        periods:           PERIODS,
        mainIndicators:    ['EMA'],
        subIndicators:     [],
        datafeed,
      })
      chartRef.current = chart
      chartRef.current.setTheme(themeRef.current)
    }

    createPro().catch(() => {})

    return () => {
      disposed = true
      if (wsRef.current) { wsRef.current.close(); wsRef.current = null }
      if (containerRef.current) containerRef.current.innerHTML = ''
      chartRef.current = null
    }
  }, [symbol, interval]) // eslint-disable-line

  useEffect(() => {
    if (!chartRef.current) return
    try { chartRef.current.setTheme(theme) } catch { /* ignore */ }
  }, [theme])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', background: 'var(--chart-shell-bg)', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '4px 8px', borderBottom: '1px solid var(--chart-shell-border)',
        background: 'var(--chart-shell-elevated)',
        flexShrink: 0, flexWrap: 'wrap', minHeight: 32,
      }}>
        {/* Symbol pills — from the store */}
        <div style={{ display: 'flex', gap: 2 }} onClick={e => e.stopPropagation()}>
          {symbolList.map(s => (
            <button
              key={s}
              onClick={() => onSymbolChange?.(s)}
              style={{
                padding: '2px 6px', fontSize: 9, fontFamily: 'var(--font-mono)',
                background: s === symbol ? 'rgba(52,211,153,0.15)' : 'transparent',
                border: `1px solid ${s === symbol ? 'rgba(52,211,153,0.4)' : 'var(--chart-shell-border)'}`,
                color: s === symbol ? '#34d399' : 'var(--chart-control-text-muted)',
                borderRadius: 2, cursor: 'pointer', transition: 'all 0.15s',
              }}
            >
              {s.replace('-USD', '')}
            </button>
          ))}
        </div>

        <div style={{ width: 1, height: 12, background: 'var(--chart-shell-border)', flexShrink: 0 }} />

        {/* Interval pills */}
        <div style={{ display: 'flex', gap: 2 }} onClick={e => e.stopPropagation()}>
          {INTERVAL_LIST.map(iv => (
            <button
              key={iv}
              onClick={() => onIntervalChange?.(iv)}
              style={{
                padding: '2px 5px', fontSize: 9, fontFamily: 'var(--font-mono)',
                background: iv === interval ? 'var(--chart-toolbar-btn-bg)' : 'transparent',
                border: `1px solid ${iv === interval ? 'var(--nav-border-strong)' : 'transparent'}`,
                color: iv === interval ? 'var(--text-main)' : 'var(--chart-control-text-muted)',
                borderRadius: 2, cursor: 'pointer', transition: 'all 0.15s',
              }}
            >
              {iv}
            </button>
          ))}
        </div>

        <div style={{ width: 1, height: 12, background: 'var(--chart-shell-border)', flexShrink: 0 }} />

        {/* Panel controls */}
        <div style={{ display: 'flex', gap: 4 }} onClick={e => e.stopPropagation()}>
          <button
            onClick={() => onSplitHorizontally?.()}
            title="Split Horizontally"
            className="panel-action-btn"
          >
            ◫
          </button>
          <button
            onClick={() => onSplitVertically?.()}
            title="Split Vertically"
            className="panel-action-btn"
          >
            ⊟
          </button>
          {onClosePanel && (
            <button
              onClick={() => onClosePanel()}
              title="Close Panel"
              className="panel-action-btn close-btn"
            >
              ✕
            </button>
          )}
        </div>

        {/* Right: price + change + navigate */}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'baseline' }}>
          {ticker && (
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-main)' }}>
              ${fmtPrice(ticker.last_price, symMeta?.price_dp ?? 2)}
            </span>
          )}
          <span
            style={{ fontFamily: 'var(--font-mono)', fontSize: 10 }}
            className={change >= 0 ? 'text-buy' : 'text-sell'}
          >
            {fmtPct(change)}
          </span>
          {onNavigate && (
            <button
              onClick={e => { e.stopPropagation(); onNavigate() }}
              style={{
                fontSize: 9, padding: '1px 6px',
                background: 'rgba(52,211,153,0.1)', border: '1px solid rgba(52,211,153,0.25)',
                color: '#34d399', borderRadius: 2, cursor: 'pointer',
              }}
            >
              ↗
            </button>
          )}
        </div>
      </div>

      {/* KLineChartPro container */}
      <div
        ref={containerRef}
        style={{
          flex: 1,
          minWidth: 0,
          minHeight: 0,
          width: '100%',
          height: '100%',
          overflow: 'hidden',
          position: 'relative',
        }}
      />
    </div>
  )
}
