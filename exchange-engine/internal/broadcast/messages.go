package broadcast

import "github.com/opensoft/exchange-engine/internal/ohlcv"

// All WebSocket message types sent from server to client

type MsgType string

const (
	TypeOrderBook   MsgType = "orderbook"
	TypeTrade       MsgType = "trade"
	TypeOHLCV       MsgType = "ohlcv"
	TypeTicker      MsgType = "ticker"
	TypePortfolio   MsgType = "portfolio"
	TypeOrderAck    MsgType = "order_ack"
	TypeOrderFill   MsgType = "order_fill"
	TypeOrderCancel MsgType = "order_cancel"
	TypeError       MsgType = "error"
)

type BaseMsg struct {
	Type   MsgType `json:"type"`
	Symbol string  `json:"symbol,omitempty"`
}

type DepthEntry struct {
	Price    float64 `json:"price"`
	Quantity float64 `json:"quantity"`
}

type OrderBookMsg struct {
	Type      MsgType      `json:"type"`
	Symbol    string       `json:"symbol"`
	Timestamp int64        `json:"timestamp"`
	Bids      []DepthEntry `json:"bids"`
	Asks      []DepthEntry `json:"asks"`
}

type TradeMsg struct {
	Type          MsgType `json:"type"`
	Symbol        string  `json:"symbol"`
	TradeID       string  `json:"trade_id"`
	Price         float64 `json:"price"`
	Quantity      float64 `json:"quantity"`
	AggressorSide string  `json:"aggressor_side"`
	Timestamp     int64   `json:"timestamp"`
}

type OHLCVMsg struct {
	Type     MsgType     `json:"type"`
	Symbol   string      `json:"symbol"`
	Interval string      `json:"interval"`
	Candle   ohlcv.Candle `json:"candle"`
	IsClosed bool        `json:"is_closed"`
}

type TickerMsg struct {
	Type         MsgType `json:"type"`
	Symbol       string  `json:"symbol"`
	LastPrice    float64 `json:"last_price"`
	BestBid      float64 `json:"best_bid"`
	BestAsk      float64 `json:"best_ask"`
	Spread       float64 `json:"spread"`
	Volume24h    float64 `json:"volume_24h"`
	Change24hPct float64 `json:"change_24h_pct"`
	High24h      float64 `json:"high_24h"`
	Low24h       float64 `json:"low_24h"`
	VWAP         float64 `json:"vwap"`
	Timestamp    int64   `json:"timestamp"`
}

type ErrorMsg struct {
	Type    MsgType `json:"type"`
	Code    string  `json:"code"`
	Message string  `json:"message"`
}

// Inbound messages from client to server

type InboundMsgType string

const (
	InboundSubscribe     InboundMsgType = "subscribe"
	InboundOrder         InboundMsgType = "order"
	InboundCancel        InboundMsgType = "cancel"
	InboundChangeSymbol  InboundMsgType = "change_symbol"
)

type InboundMsg struct {
	Type    InboundMsgType `json:"type"`
	Symbol  string         `json:"symbol"`
	Payload map[string]interface{} `json:"payload"`
}
