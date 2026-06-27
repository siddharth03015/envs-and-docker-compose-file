export interface SymbolInfo {
  symbol:          string
  label:           string
  base_asset:      string
  category:        'crypto' | 'stock'
  market_cap:      number
  price_dp:        number
  qty_dp:          number
  last_price?:     number
  change_24h_pct?: number
  volume_24h?:     number
}

export interface Ticker {
  symbol:          string
  last_price:      number
  open_price:      number
  high_24h:        number
  low_24h:         number
  volume_24h:      number
  change_24h_pct:  number
  vwap:            number
  best_bid:        number
  best_ask:        number
  spread:          number
  timestamp:       number
}

export interface Candle {
  time:   number
  open:   number
  high:   number
  low:    number
  close:  number
  volume: number
}

export interface DepthEntry {
  price:    number
  quantity: number
}

export interface OrderBook {
  symbol:    string
  timestamp: number
  bids:      DepthEntry[]
  asks:      DepthEntry[]
}

export interface Trade {
  id:             string
  symbol:         string
  price:          number
  quantity:       number
  aggressor_side: 'BUY' | 'SELL'
  buyer_id?:      string
  seller_id?:     string
  timestamp:      number
}

export interface MyTrade {
  id:             string
  symbol:         string
  side:           'BUY' | 'SELL'
  price:          number
  quantity:       number
  aggressor_side: 'BUY' | 'SELL'
  buyer_id:       string
  seller_id:      string
  timestamp:      number
}

export type OrderSide   = 'BUY' | 'SELL'
export type OrderType   = 'LIMIT' | 'MARKET' | 'STOP_LIMIT'
export type OrderStatus = 'OPEN' | 'PARTIAL' | 'FILLED' | 'CANCELLED'

export interface Order {
  id:         string
  user_id:    string
  symbol:     string
  side:       OrderSide
  type:       OrderType
  price:      number
  stop_price: number
  quantity:   number
  filled:     number
  status:     OrderStatus
  created_at: string
}

export interface Position {
  symbol:             string
  quantity:           number
  avg_entry_price:    number
  current_price:      number
  market_value:       number
  unrealized_pnl:     number
  unrealized_pnl_pct: number
}

export interface Portfolio {
  user_id:      string
  cash:         number
  total_value:  number
  realized_pnl: number
  positions:    Record<string, Position>
}

export interface PnLPoint {
  total_value:    number
  cash:           number
  realized_pnl:   number
  unrealized_pnl: number
  timestamp:      number
}

export interface LeaderboardEntry {
  rank:        number
  user_id:     string
  username:    string
  total_value: number
  cash:        number
  pnl?:        number
}

export interface Note {
  id:         string
  content:    string
  created_at: number // Unix ms
}

export interface Toast {
  id:   string
  text: string
  ok:   boolean
}

export interface WsMessage {
  type: string
  [key: string]: unknown
}

export interface WsOhlcvPayload {
  symbol:    string
  interval:  string
  candle:    Candle
  is_closed: boolean
}
