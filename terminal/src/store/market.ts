'use client'
import { create } from 'zustand'
import type { SymbolInfo, Ticker, Candle, OrderBook, Trade } from '@/types'

const EMPTY_CANDLES: Candle[] = []
const EMPTY_TRADES: Trade[]   = []

interface MarketState {
  symbols:    SymbolInfo[]
  tickers:    Record<string, Ticker>
  candleMap:  Record<string, Candle[]>
  orderbooks: Record<string, OrderBook>
  tradeMap:   Record<string, Trade[]>

  setSymbols:   (s: SymbolInfo[]) => void
  setTicker:    (t: Ticker) => void
  setCandles:   (key: string, candles: Candle[]) => void
  upsertCandle: (key: string, candle: Candle, isClosed: boolean) => void
  setOrderBook: (symbol: string, ob: OrderBook) => void
  pushTrade:    (symbol: string, trade: Trade) => void

  getCandles: (symbol: string, interval: string) => Candle[]
  getTrades:  (symbol: string) => Trade[]
}

export const useMarketStore = create<MarketState>((set, get) => ({
  symbols:    [],
  tickers:    {},
  candleMap:  {},
  orderbooks: {},
  tradeMap:   {},

  setSymbols:  (symbols) => set({ symbols }),
  setTicker:   (t) => set(s => ({ tickers: { ...s.tickers, [t.symbol]: t } })),

  setCandles: (key, candles) =>
    set(s => ({ candleMap: { ...s.candleMap, [key]: candles } })),

  upsertCandle: (key, candle, isClosed) =>
    set(s => {
      const prev = s.candleMap[key] ?? []
      if (isClosed) return { candleMap: { ...s.candleMap, [key]: [...prev, candle] } }
      if (prev.length === 0) return { candleMap: { ...s.candleMap, [key]: [candle] } }
      const updated = [...prev]
      updated[updated.length - 1] = candle
      return { candleMap: { ...s.candleMap, [key]: updated } }
    }),

  setOrderBook: (symbol, ob) =>
    set(s => ({ orderbooks: { ...s.orderbooks, [symbol]: ob } })),

  pushTrade: (symbol, trade) =>
    set(s => {
      const prev = s.tradeMap[symbol] ?? []
      return { tradeMap: { ...s.tradeMap, [symbol]: [trade, ...prev].slice(0, 100) } }
    }),

  getCandles: (symbol, interval) => get().candleMap[`${symbol}:${interval}`] ?? EMPTY_CANDLES,
  getTrades:  (symbol) => get().tradeMap[symbol] ?? EMPTY_TRADES,
}))
