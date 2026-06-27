'use client'
import { useEffect, useRef } from 'react'
import type { SymbolInfo as KlineSymInfo, Period, Datafeed, DatafeedSubscribeCallback } from '@klinecharts/pro'
import type { SymbolInfo as StoreSymbol } from '@/types'
import { WS_BASE, WS_EVT } from '@/constants'
import { fetchOHLCVHistory } from '@/lib/market'
import { useMarketStore } from '@/store/market'
import { useTerminalStore } from '@/store/terminal'
import wsManager from '@/ws/manager'

type KLineData = { timestamp: number; open: number; high: number; low: number; close: number; volume: number }

// ── Period definitions matching our backend intervals ────────────────────────
const PERIODS: Period[] = [
  { multiplier: 1, timespan: 'second', text: '1s' },
  { multiplier: 5, timespan: 'second', text: '5s' },
  { multiplier: 1, timespan: 'minute', text: '1m' },
  { multiplier: 5, timespan: 'minute', text: '5m' },
]

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

function fallback(symbol: string): KlineSymInfo {
  return {
    ticker: symbol, name: symbol, shortName: symbol.replace('-USD', ''),
    market: 'crypto', exchange: 'Synthetic', pricePrecision: 2, volumePrecision: 4,
  }
}

interface Props { symbol: string }

export default function KlineProInner({ symbol }: Props) {
  const storeSymbols = useMarketStore(s => s.symbols)
  const theme = useTerminalStore(s => s.theme)
  const themeRef = useRef(theme)
  themeRef.current = theme
  // Keep a ref so the datafeed closure always reads the latest list
  const storeSymbolsRef = useRef<StoreSymbol[]>(storeSymbols)
  storeSymbolsRef.current = storeSymbols

  const containerRef = useRef<HTMLDivElement>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chartRef = useRef<any>(null)
  const wsRef    = useRef<WebSocket | null>(null)
  const cbRef    = useRef<DatafeedSubscribeCallback | null>(null)
  const symbolRef = useRef(symbol)
  symbolRef.current = symbol

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

  function resolveSymInfo(ticker: string): KlineSymInfo {
    const found = storeSymbolsRef.current.find(s => s.symbol === ticker)
    return found ? storeToKline(found) : fallback(ticker)
  }

  // ── Mount: create KLineChartPro with our datafeed ──────────────────────────
  useEffect(() => {
    if (!containerRef.current) return
    let disposed = false

    const createPro = async () => {
      const { KLineChartPro } = await import('@klinecharts/pro')
      if (disposed || !containerRef.current) return

      const datafeed: Datafeed = {
        async searchSymbols(_search?: string): Promise<KlineSymInfo[]> {
          // Return live symbols from the store ref
          return storeSymbolsRef.current.length > 0
            ? storeSymbolsRef.current.map(storeToKline)
            : [fallback('BTC-USD')]
        },

        async getHistoryKLineData(
          sym: KlineSymInfo,
          period: Period,
          _from: number,
          _to: number,
        ): Promise<KLineData[]> {
          try {
            const candles = await fetchOHLCVHistory(sym.ticker, period.text, 1000)
            return candles.map(c => ({
              timestamp: Number(c.time) * 1000, // seconds → milliseconds
              open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume,
            }))
          } catch {
            return []
          }
        },

        subscribe(sym: KlineSymInfo, period: Period, callback: DatafeedSubscribeCallback) {
          if (wsRef.current) { wsRef.current.close(); wsRef.current = null }
          cbRef.current = callback

          const token  = (typeof window !== 'undefined' ? localStorage.getItem('token') : null) ?? ''
          const params = new URLSearchParams({ token, symbol: sym.ticker })
          const ws     = new WebSocket(`${WS_BASE}/ws?${params}`)
          wsRef.current = ws

          ws.onmessage = (e) => {
            try {
              const msg = JSON.parse(e.data)
              if (msg.type !== 'ohlcv') return
              const msgInterval = msg.interval ?? msg.candle?.interval ?? ''
              if (msgInterval && msgInterval !== period.text) return
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

        unsubscribe(_sym: KlineSymInfo, _period: Period) {
          if (wsRef.current) { wsRef.current.close(); wsRef.current = null }
          cbRef.current = null
        },
      }

      const chart = new KLineChartPro({
        container:         containerRef.current!,
        theme:             themeRef.current,
        locale:            'en-US',
        drawingBarVisible: true,
        symbol:            resolveSymInfo(symbol),
        period:            PERIODS[2], // default 1m
        periods:           PERIODS,
        mainIndicators:    ['EMA', 'BOLL'],
        subIndicators:     ['VOL', 'MACD'],
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
  }, []) // eslint-disable-line

  useEffect(() => {
    if (!chartRef.current) return
    try { chartRef.current.setTheme(theme) } catch { /* ignore */ }
  }, [theme])

  // ── When symbol prop changes (store-driven navigation) ────────────────────
  useEffect(() => {
    if (!chartRef.current) return
    try { chartRef.current.setSymbol(resolveSymInfo(symbol)) } catch { /* ignore */ }
  }, [symbol]) // eslint-disable-line

  // ── Fill markers: draw an annotation on the chart when an order fills ──────
  useEffect(() => {
    const onFill = (payload: unknown) => {
      try {
        const msg = payload as { payload?: { side?: string; price?: number; created_at?: string } }
        const fill = msg.payload
        if (!fill) return
        const internalChart = chartRef.current?._chartApi
        if (!internalChart || typeof internalChart.createOverlay !== 'function') return
        const isBuy = (fill.side ?? '').toUpperCase() === 'BUY'
        internalChart.createOverlay({
          name: 'simpleAnnotation',
          points: [{ timestamp: fill.created_at ? new Date(fill.created_at).getTime() : Date.now(), value: fill.price ?? 0 }],
          extendData: isBuy ? '▲' : '▼',
          styles: {
            symbol: { color: isBuy ? '#26A69A' : '#EF5350', activeColor: isBuy ? '#26A69A' : '#EF5350' },
          },
        })
      } catch { /* ignore */ }
    }
    wsManager.on(WS_EVT.ORDER_FILL, onFill)
    return () => wsManager.off(WS_EVT.ORDER_FILL, onFill)
  }, [])

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: '100%',
        flex: 1,
        minHeight: 0,
        minWidth: 0,
        overflow: 'hidden',
        position: 'relative',
        background: 'var(--chart-shell-bg)',
      }}
    />
  )
}
