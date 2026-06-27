import { api } from './api'
import type { SymbolInfo, OrderBook, Candle, Trade, Ticker, Portfolio, PnLPoint, LeaderboardEntry, Order, MyTrade } from '@/types'

// ── Market data ─────────────────────────────────────────────────────────────
export const normalizeCandle = (c: any): Candle => ({
  time: Number(c.time ?? c.Time),
  open: Number(c.open ?? c.Open),
  high: Number(c.high ?? c.High),
  low: Number(c.low ?? c.Low),
  close: Number(c.close ?? c.Close),
  volume: Number(c.volume ?? c.Volume ?? 0),
})

export const fetchSymbols = async (): Promise<SymbolInfo[]> => {
  const { data } = await api.get<{ symbols: SymbolInfo[] }>('/api/symbols')
  return data.symbols ?? []
}

export const fetchOHLCVHistory = async (symbol: string, interval = '1s', limit = 1000): Promise<Candle[]> => {
  const { data } = await api.get<{ candles: any[] }>(`/api/history/ohlcv/${symbol}`, { params: { interval, limit } })
  return (data.candles ?? []).map(normalizeCandle)
}

export const fetchOHLCV = async (symbol: string, interval = '1s', limit = 500): Promise<Candle[]> => {
  const { data } = await api.get<{ candles: any[] }>(`/api/ohlcv/${symbol}`, { params: { interval, limit } })
  return (data.candles ?? []).map(normalizeCandle)
}

export const fetchRecentTrades = async (symbol: string, limit = 50): Promise<Trade[]> => {
  const { data } = await api.get<{ trades: Trade[] }>(`/api/trades/${symbol}`, { params: { limit } })
  return data.trades ?? []
}

export const fetchTicker = async (symbol: string): Promise<Ticker> => {
  const { data } = await api.get<Ticker>(`/api/ticker/${symbol}`)
  return data
}

export const fetchOrderBook = async (symbol: string): Promise<OrderBook> => {
  const { data } = await api.get<OrderBook>(`/api/orderbook/${symbol}`)
  return data
}

// ── Orders ───────────────────────────────────────────────────────────────────
export const submitOrder = async (params: {
  symbol: string; side: string; type: string
  quantity: number; price?: number; stop_price?: number
}) => {
  const { data } = await api.post('/api/orders', params)
  return data
}

export const cancelOrder = async (orderId: string, symbol: string) => {
  const { data } = await api.delete(`/api/orders/${orderId}`, { params: { symbol } })
  return data
}

export const fetchOpenOrders = async (symbol?: string): Promise<Order[]> => {
  const { data } = await api.get<{ orders: Order[] }>('/api/orders', { params: symbol ? { symbol } : {} })
  return data.orders ?? []
}

export const fetchMyTrades = async (limit = 200): Promise<MyTrade[]> => {
  const { data } = await api.get<{ trades: MyTrade[] }>('/api/history/my-trades', { params: { limit } })
  return data.trades ?? []
}

// ── Portfolio ────────────────────────────────────────────────────────────────
export const fetchPortfolio = async (): Promise<Portfolio> => {
  const { data } = await api.get<Portfolio>('/api/portfolio')
  return data
}

export const fetchPnLHistory = async (limit = 500): Promise<PnLPoint[]> => {
  const { data } = await api.get<{ history: PnLPoint[] }>('/api/history/pnl', { params: { limit } })
  return data.history ?? []
}

export const fetchLeaderboard = async (): Promise<LeaderboardEntry[]> => {
  const { data } = await api.get<{ leaderboard: LeaderboardEntry[] }>('/api/leaderboard')
  return data.leaderboard ?? []
}
