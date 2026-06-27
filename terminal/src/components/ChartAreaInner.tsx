'use client'
import { useEffect, useRef, useState } from 'react'
import { useMarketStore } from '@/store/market'
import { useTerminalStore } from '@/store/terminal'
import { fetchOHLCVHistory } from '@/lib/market'
import { candleIndicators } from '@/lib/indicators'
import { INTERVALS, WS_EVT, type Interval } from '@/constants'
import type { Candle } from '@/types'
import wsManager from '@/ws/manager'

const EMPTY: Candle[] = []
type Sub = 'none' | 'rsi' | 'macd'
type LWC = any // eslint-disable-line @typescript-eslint/no-explicit-any
type Ser = any // eslint-disable-line @typescript-eslint/no-explicit-any

interface Props { symbol: string }

export default function ChartAreaInner({ symbol }: Props) {
  const interval    = useTerminalStore(s => s.interval)
  const setInterval = useTerminalStore(s => s.setInterval)
  const candleMap   = useMarketStore(s => s.candleMap)
  const candles     = candleMap[`${symbol}:${interval}`] ?? EMPTY

  const mainRef = useRef<HTMLDivElement>(null)
  const subRef  = useRef<HTMLDivElement>(null)

  const chart  = useRef<LWC>(null)
  const subCh  = useRef<LWC>(null)
  const cs     = useRef<Ser>(null)
  const vol    = useRef<Ser>(null)
  const e9     = useRef<Ser>(null)
  const e20    = useRef<Ser>(null)
  const e50    = useRef<Ser>(null)
  const bbU    = useRef<Ser>(null)
  const bbM    = useRef<Ser>(null)
  const bbL    = useRef<Ser>(null)
  const rsiSer = useRef<Ser>(null)
  const mcd    = useRef<Ser>(null)
  const mSig   = useRef<Ser>(null)
  const mHist  = useRef<Ser>(null)

  const symbolRef   = useRef(symbol)
  const intervalRef = useRef(interval)
  symbolRef.current   = symbol
  intervalRef.current = interval

  // Fill markers — accumulated per symbol:interval, cleared on symbol/interval change
  type Marker = { time: number; position: 'belowBar' | 'aboveBar'; color: string; shape: 'arrowUp' | 'arrowDown'; text: string }
  const fillMarkersRef = useRef<Marker[]>([])

  const [showEMA,    setShowEMA]    = useState(true)
  const [showBB,     setShowBB]     = useState(false)
  const [sub,        setSub]        = useState<Sub>('none')
  const [ready,      setReady]      = useState(false)
  const [mainPct,    setMainPct]    = useState(65) // % height for main chart when sub-pane open

  const skipFirstReload = useRef(true)
  // Track bar count to detect new bar (only recalc indicators on bar close, not every tick)
  const prevBarCount = useRef(0)

  // ── Create chart once on mount ───────────────────────────────────────────
  useEffect(() => {
    if (!mainRef.current) return
    let disposed = false

    import('lightweight-charts').then(({ createChart, ColorType }) => {
      if (disposed || !mainRef.current) return

      const c = createChart(mainRef.current, {
        autoSize: true,
        layout: {
          background: { type: ColorType.Solid, color: '#000000' },
          textColor: '#86868b', fontSize: 11,
        },
        grid: { vertLines: { color: '#1d1d1f' }, horzLines: { color: '#1d1d1f' } },
        timeScale: { borderColor: '#1d1d1f', timeVisible: true, secondsVisible: true },
        rightPriceScale: { borderColor: '#1d1d1f' },
        crosshair: { mode: 1 },
      })
      chart.current = c

      cs.current  = c.addCandlestickSeries({
        upColor: '#34d399', downColor: '#f87171',
        borderUpColor: '#34d399', borderDownColor: '#f87171',
        wickUpColor: '#34d399', wickDownColor: '#f87171',
      })
      vol.current = c.addHistogramSeries({ priceFormat: { type: 'volume' }, priceScaleId: 'vol' })
      c.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } })

      e9.current  = c.addLineSeries({ color: '#F0B90B', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, title: 'EMA9' })
      e20.current = c.addLineSeries({ color: '#a78bfa', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, title: 'EMA20' })
      e50.current = c.addLineSeries({ color: '#34d399', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, title: 'EMA50' })
      bbU.current = c.addLineSeries({ color: '#3b82f688', lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false })
      bbM.current = c.addLineSeries({ color: '#3b82f644', lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false })
      bbL.current = c.addLineSeries({ color: '#3b82f688', lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false })

      fetchOHLCVHistory(symbolRef.current, intervalRef.current, 1000)
        .then(hist => {
          if (!disposed) {
            applyData(hist)
            prevBarCount.current = hist.length
          }
        })
        .catch(() => {})
        .finally(() => { if (!disposed) setReady(true) })
    }).catch(() => { if (!disposed) setReady(true) })

    return () => {
      disposed = true
      if (chart.current) { chart.current.remove(); chart.current = null }
      cs.current = null; vol.current = null
      e9.current = null; e20.current = null; e50.current = null
      bbU.current = null; bbM.current = null; bbL.current = null
    }
  }, []) // eslint-disable-line

  // ── Reload when symbol / interval changes ───────────────────────────────
  useEffect(() => {
    if (skipFirstReload.current) { skipFirstReload.current = false; return }
    if (!cs.current) return
    fetchOHLCVHistory(symbol, interval, 1000)
      .then(hist => {
        applyData(hist)
        prevBarCount.current = hist.length
      })
      .catch(() => {})
  }, [symbol, interval]) // eslint-disable-line

  // ── Sub-pane (RSI / MACD) ────────────────────────────────────────────────
  useEffect(() => {
    if (!ready) return
    if (subCh.current) { subCh.current.remove(); subCh.current = null }
    rsiSer.current = null; mcd.current = null; mSig.current = null; mHist.current = null
    if (sub === 'none' || !subRef.current) return

    import('lightweight-charts').then(({ createChart, ColorType }) => {
      if (!subRef.current) return
      const sc = createChart(subRef.current, {
        autoSize: true,
        layout: { background: { type: ColorType.Solid, color: '#000000' }, textColor: '#86868b', fontSize: 10 },
        grid: { vertLines: { color: '#1d1d1f' }, horzLines: { color: '#1d1d1f' } },
        rightPriceScale: { borderColor: '#1d1d1f' },
        timeScale: { visible: false },
        crosshair: { mode: 1 },
      })
      subCh.current = sc
      if (sub === 'rsi') {
        rsiSer.current = sc.addLineSeries({ color: '#a78bfa', lineWidth: 1, priceLineVisible: false })
      } else {
        mHist.current = sc.addHistogramSeries({ priceLineVisible: false })
        mcd.current   = sc.addLineSeries({ color: '#a78bfa', lineWidth: 1, priceLineVisible: false })
        mSig.current  = sc.addLineSeries({ color: '#F0B90B',  lineWidth: 1, priceLineVisible: false })
      }
      if (candles.length > 1) applyIndicators(candles)
    })

    return () => {
      if (subCh.current) { subCh.current.remove(); subCh.current = null }
    }
  }, [sub, ready]) // eslint-disable-line

  // ── Order fill markers ────────────────────────────────────────────────────
  useEffect(() => {
    const onFill = (p: unknown) => {
      if (!cs.current) return
      const msg = p as { payload?: { price?: number; quantity?: number; side?: string; symbol?: string } }
      const pay = msg.payload
      if (!pay) return
      // Only mark fills for the currently displayed symbol
      if (pay.symbol && pay.symbol !== symbolRef.current) return

      // Snap to the last closed candle time
      const state    = useMarketStore.getState()
      const candles  = state.candleMap[`${symbolRef.current}:${intervalRef.current}`] ?? []
      if (candles.length === 0) return
      const t = Number(candles[candles.length - 1].time)
      if (!t) return

      const isBuy = (pay.side ?? '').toUpperCase() === 'BUY'
      const marker: Marker = {
        time:     t,
        position: isBuy ? 'belowBar' : 'aboveBar',
        color:    isBuy ? '#34d399'  : '#f87171',
        shape:    isBuy ? 'arrowUp'  : 'arrowDown',
        text:     `${isBuy ? 'B' : 'S'} ${(pay.quantity ?? 0).toFixed(4)}@${(pay.price ?? 0).toFixed(2)}`,
      }

      fillMarkersRef.current = [...fillMarkersRef.current, marker]
      try { cs.current.setMarkers(fillMarkersRef.current) } catch { /* series may be stale */ }
    }

    wsManager.on(WS_EVT.ORDER_FILL, onFill)
    return () => wsManager.off(WS_EVT.ORDER_FILL, onFill)
  }, []) // eslint-disable-line

  // ── Live candle updates ──────────────────────────────────────────────────
  // Runs on every WS tick — only update the last bar price.
  // Recalculate indicators only when a new bar opens (previous bar closed).
  useEffect(() => {
    if (!ready || !cs.current || candles.length === 0) return
    const c = candles[candles.length - 1]
    const t = Number(c.time)
    if (!t) return

    try {
      cs.current.update({ time: t, open: c.open, high: c.high, low: c.low, close: c.close })
      if (vol.current)
        vol.current.update({ time: t, value: c.volume, color: c.close >= c.open ? '#34d39960' : '#f8717160' })
    } catch { /* stale update — ignore */ }

    // Only recalculate indicators on bar close (new candle added), not every tick
    const isNewBar = candles.length !== prevBarCount.current
    prevBarCount.current = candles.length
    if (isNewBar) applyIndicators(candles)
  }, [candles, ready]) // eslint-disable-line

  // ── Toggle EMA / BB or sub-pane ─────────────────────────────────────────
  useEffect(() => {
    if (ready && candles.length > 0) applyIndicators(candles)
  }, [showEMA, showBB, sub]) // eslint-disable-line

  // ── Helpers ──────────────────────────────────────────────────────────────
  function dedupCandles(data: Candle[]): Candle[] {
    const seen = new Map<number, Candle>()
    for (const c of data) seen.set(Number(c.time), c)
    return Array.from(seen.values()).sort((a, b) => Number(a.time) - Number(b.time))
  }

  function applyData(raw: Candle[]) {
    const data = dedupCandles(raw)
    if (!cs.current || data.length === 0) return
    cs.current.setData(data.map(c => ({ time: Number(c.time), open: c.open, high: c.high, low: c.low, close: c.close })))
    if (vol.current)
      vol.current.setData(data.map(c => ({ time: Number(c.time), value: c.volume, color: c.close >= c.open ? '#34d39960' : '#f8717160' })))
    // Clear fill markers on symbol/interval reload
    fillMarkersRef.current = []
    try { cs.current.setMarkers([]) } catch { /* ignore */ }
    applyIndicators(data)
    if (chart.current) chart.current.timeScale().fitContent()
  }

  function applyIndicators(raw: Candle[]) {
    const data = dedupCandles(raw)
    if (data.length < 2) return
    const { ema9, ema20, ema50, bb, rsi: rsiData, macd } = candleIndicators(data)
    const times = data.map(c => Number(c.time))
    const pts = (arr: (number | null)[]) =>
      times.map((t, i) => ({ time: t, value: arr[i] ?? NaN })).filter(p => !isNaN(p.value))

    if (e9.current)  e9.current.setData(showEMA  ? pts(ema9)  : [])
    if (e20.current) e20.current.setData(showEMA ? pts(ema20) : [])
    if (e50.current) e50.current.setData(showEMA ? pts(ema50) : [])
    if (bbU.current) bbU.current.setData(showBB  ? pts(bb.map(b => b.upper))  : [])
    if (bbM.current) bbM.current.setData(showBB  ? pts(bb.map(b => b.middle)) : [])
    if (bbL.current) bbL.current.setData(showBB  ? pts(bb.map(b => b.lower))  : [])

    if (sub === 'rsi' && rsiSer.current)
      rsiSer.current.setData(pts(rsiData))
    if (sub === 'macd') {
      if (mcd.current)  mcd.current.setData(pts(macd.map(m => m.macd)))
      if (mSig.current) mSig.current.setData(pts(macd.map(m => m.signal)))
      if (mHist.current)
        mHist.current.setData(
          times.map((t, i) => {
            const h = macd[i].histogram
            return { time: t, value: h ?? NaN, color: (h ?? 0) >= 0 ? '#34d399aa' : '#f87171aa' }
          }).filter(p => !isNaN(p.value as number))
        )
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', background: '#000', overflow: 'hidden' }}>
      {/* Toolbar */}
      <div className="chart-toolbar">
        {INTERVALS.map(iv => (
          <button key={iv.value}
            className={`toolbar-btn${interval === iv.value ? ' active' : ''}`}
            onClick={() => setInterval(iv.value as Interval)}>
            {iv.label}
          </button>
        ))}
        <div className="toolbar-sep" />
        <button className={`toolbar-btn${showEMA ? ' active' : ''}`} onClick={() => setShowEMA(v => !v)}>EMA</button>
        <button className={`toolbar-btn${showBB  ? ' active' : ''}`} onClick={() => setShowBB(v => !v)}>BB</button>
        <div className="toolbar-sep" />
        {(['none', 'rsi', 'macd'] as Sub[]).map(p => (
          <button key={p}
            className={`toolbar-btn${sub === p && p !== 'none' ? ' active' : ''}`}
            onClick={() => setSub(p)}>
            {p === 'none' ? 'Sub —' : p.toUpperCase()}
          </button>
        ))}
      </div>

      {/* Main chart */}
      <div ref={mainRef} style={{ width: '100%', flex: sub !== 'none' ? `0 0 ${mainPct}%` : 1, minHeight: 0 }} />

      {/* Draggable divider + sub-pane */}
      {sub !== 'none' && (<>
        {/* Drag handle between main and sub */}
        <div
          style={{ height: 5, flexShrink: 0, cursor: 'row-resize', background: 'transparent', position: 'relative', zIndex: 5 }}
          onMouseDown={e => {
            const startY = e.clientY
            const startPct = mainPct
            const onMove = (ev: MouseEvent) => {
              const container = mainRef.current?.parentElement
              if (!container) return
              const h = container.getBoundingClientRect().height
              const delta = ev.clientY - startY
              setMainPct(Math.max(30, Math.min(85, startPct + (delta / h) * 100)))
            }
            const onUp = () => {
              window.removeEventListener('mousemove', onMove)
              window.removeEventListener('mouseup', onUp)
              document.body.style.cursor = ''
              document.body.style.userSelect = ''
            }
            document.body.style.cursor = 'row-resize'
            document.body.style.userSelect = 'none'
            window.addEventListener('mousemove', onMove)
            window.addEventListener('mouseup', onUp)
            e.preventDefault()
          }}
        >
          <div style={{ position: 'absolute', left: 0, right: 0, top: 2, height: 1, background: '#1d1d1f', pointerEvents: 'none' }} className="rh-line" />
        </div>

        <div style={{ flex: 1, minHeight: 0, borderTop: '1px solid #1d1d1f', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '2px 12px', fontSize: 9, color: '#86868b', textTransform: 'uppercase', letterSpacing: '0.5px', borderBottom: '1px solid #1d1d1f', flexShrink: 0 }}>
            {sub.toUpperCase()}
          </div>
          <div ref={subRef} style={{ width: '100%', flex: 1, minHeight: 0 }} />
        </div>
      </>)}
    </div>
  )
}
