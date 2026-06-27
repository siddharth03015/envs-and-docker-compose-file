export const API_BASE = typeof window !== 'undefined' ? `http://${window.location.hostname}:8080` : (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080')
export const WS_BASE  = typeof window !== 'undefined' ? `ws://${window.location.hostname}:8080` : (process.env.NEXT_PUBLIC_WS_URL  ?? 'ws://localhost:8080')

export const DEFAULT_SYMBOL = 'BTC-USD'

export const INTERVALS = [
  { value: '1s', label: '1s' },
  { value: '5s', label: '5s' },
  { value: '1m', label: '1m' },
  { value: '5m', label: '5m' },
] as const
export type Interval = typeof INTERVALS[number]['value']

export const ORDER_TYPES = ['LIMIT', 'MARKET', 'STOP_LIMIT'] as const
export const ORDER_SIDES = ['BUY', 'SELL'] as const

export const EMA_PERIODS = [9, 20, 50] as const
export const BB_PERIOD = 20
export const BB_STD = 2
export const RSI_PERIOD = 14
export const MACD_FAST = 12
export const MACD_SLOW = 26
export const MACD_SIGNAL = 9

export const STARTING_CAPITAL = 100_000

export const WS_EVT = {
  ORDERBOOK: 'orderbook',
  TRADE: 'trade',
  OHLCV: 'ohlcv',
  TICKER: 'ticker',
  PORTFOLIO: 'portfolio',
  ORDER_ACK: 'order_ack',
  ORDER_FILL: 'order_fill',
  ORDER_CANCEL: 'order_cancel',
  ERROR: 'error',
} as const
