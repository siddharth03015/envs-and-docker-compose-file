'use client'
import { useEffect, useRef } from 'react'
import { useMarketStore } from '@/store/market'
import { fetchOHLCVHistory } from '@/lib/market'
import { fmtPrice, fmtPct } from '@/lib/formatters'
import type { Candle } from '@/types'

const EMPTY: Candle[] = []
const INTERVALS = ['1s', '5s', '1m', '5m']

interface Props {
  symbol: string
  interval?: string
  onSymbolChange?: (s: string) => void
  onIntervalChange?: (i: string) => void
  onNavigate?: () => void
}

export default function MiniChartInner({
  symbol,
  interval = '1m',
  onSymbolChange,
  onIntervalChange,
  onNavigate,
}: Props) {
  const tickers   = useMarketStore(s => s.tickers)
  const candleMap = useMarketStore(s => s.candleMap)
  const symbols   = useMarketStore(s => s.symbols)
  const candles   = candleMap[`${symbol}:${interval}`] ?? EMPTY
  const ticker    = tickers[symbol]
  const symInfo   = symbols.find(s => s.symbol === symbol)
  const change    = ticker?.change_24h_pct ?? symInfo?.change_24h_pct ?? 0

  const containerRef  = useRef<HTMLDivElement>(null)
  const chart  = useRef<any>(null) // eslint-disable-line @typescript-eslint/no-explicit-any
  const cs     = useRef<any>(null) // eslint-disable-line @typescript-eslint/no-explicit-any
  const symbolRef   = useRef(symbol)
  const intervalRef = useRef(interval)
  symbolRef.current   = symbol
  intervalRef.current = interval

  // Create / recreate chart when symbol or interval changes
  useEffect(() => {
    if (!containerRef.current) return
    let disposed = false

    import('lightweight-charts').then(({ createChart, ColorType }) => {
      if (disposed || !containerRef.current) return

      // Destroy previous instance
      if (chart.current) { chart.current.remove(); chart.current = null; cs.current = null }

      const c = createChart(containerRef.current, {
        autoSize: true,
        layout: {
          background: { type: ColorType.Solid, color: '#000000' },
          textColor: '#86868b', fontSize: 10,
        },
        grid: { vertLines: { color: '#1a1a1a' }, horzLines: { color: '#1a1a1a' } },
        timeScale: { borderColor: '#1d1d1f', timeVisible: true },
        rightPriceScale: { borderColor: '#1d1d1f', scaleMargins: { top: 0.05, bottom: 0.05 } },
        crosshair: { mode: 1 },
        handleScroll: true,
        handleScale: true,
      })
      chart.current = c

      cs.current = c.addCandlestickSeries({
        upColor: '#34d399', downColor: '#f87171',
        borderUpColor: '#34d399', borderDownColor: '#f87171',
        wickUpColor: '#34d399', wickDownColor: '#f87171',
      })

      fetchOHLCVHistory(symbolRef.current, intervalRef.current, 500)
        .then(hist => {
          if (disposed || !cs.current || !hist.length) return
          cs.current.setData(
            hist.map(h => ({ time: Number(h.time), open: h.open, high: h.high, low: h.low, close: h.close }))
          )
          c.timeScale().fitContent()
        })
        .catch(() => {})
    }).catch(() => {})

    return () => {
      disposed = true
      if (chart.current) { chart.current.remove(); chart.current = null }
      cs.current = null
    }
  }, [symbol, interval]) // eslint-disable-line

  // Live candle updates (only fires when this symbol is WS-subscribed)
  useEffect(() => {
    if (!cs.current || candles.length === 0) return
    const c = candles[candles.length - 1]
    try {
      cs.current.update({ time: Number(c.time), open: c.open, high: c.high, low: c.low, close: c.close })
    } catch { /* stale */ }
  }, [candles])

  const symbolList = symbols.length > 0 ? symbols.map(s => s.symbol) : ['BTC-USD', 'ETH-USD', 'SOL-USD']

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', background: '#000', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '4px 8px', borderBottom: '1px solid #1d1d1f',
        flexShrink: 0, flexWrap: 'wrap', minHeight: 32,
      }}>
        {/* Symbol pills */}
        <div style={{ display: 'flex', gap: 2 }} onClick={e => e.stopPropagation()}>
          {symbolList.map(s => (
            <button
              key={s}
              onClick={() => onSymbolChange?.(s)}
              style={{
                padding: '2px 6px', fontSize: 9, fontFamily: 'var(--font-mono)',
                background: s === symbol ? 'rgba(52,211,153,0.15)' : 'transparent',
                border: `1px solid ${s === symbol ? 'rgba(52,211,153,0.4)' : '#1d1d1f'}`,
                color: s === symbol ? '#34d399' : '#86868b',
                borderRadius: 2, cursor: 'pointer', transition: 'all 0.15s',
              }}
            >
              {s.replace('-USD', '')}
            </button>
          ))}
        </div>

        <div style={{ width: 1, height: 12, background: '#1d1d1f', flexShrink: 0 }} />

        {/* Interval pills */}
        <div style={{ display: 'flex', gap: 2 }} onClick={e => e.stopPropagation()}>
          {INTERVALS.map(iv => (
            <button
              key={iv}
              onClick={() => onIntervalChange?.(iv)}
              style={{
                padding: '2px 5px', fontSize: 9, fontFamily: 'var(--font-mono)',
                background: iv === interval ? 'rgba(255,255,255,0.08)' : 'transparent',
                border: `1px solid ${iv === interval ? '#3f3f46' : 'transparent'}`,
                color: iv === interval ? '#f5f5f7' : '#86868b',
                borderRadius: 2, cursor: 'pointer', transition: 'all 0.15s',
              }}
            >
              {iv}
            </button>
          ))}
        </div>

        {/* Right: price + change */}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'baseline' }}>
          {ticker && (
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#f5f5f7' }}>
              ${fmtPrice(ticker.last_price, symInfo?.price_dp ?? 2)}
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

      {/* Chart */}
      <div ref={containerRef} style={{ flex: 1, minHeight: 0, width: '100%' }} />
    </div>
  )
}
