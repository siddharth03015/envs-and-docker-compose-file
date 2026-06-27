package store

import (
	"sync"

	"github.com/opensoft/exchange-engine/internal/types"
)

// TickerData holds the live 24h market statistics for a single symbol
type TickerData struct {
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
	OpenPrice    float64 `json:"open_price"` // reference price at start (for % change)
	Timestamp    int64   `json:"timestamp"`  // UnixMilli of last update
}

// TickerStore maintains live 24h statistics per symbol using VWAP accumulation
type TickerStore struct {
	mu      sync.RWMutex
	tickers map[string]*TickerData

	// VWAP accumulators: vwap = sum(price*qty) / sum(qty)
	vwapNum map[string]float64
	vwapDen map[string]float64
}

// NewTickerStore creates an empty TickerStore
func NewTickerStore() *TickerStore {
	return &TickerStore{
		tickers: make(map[string]*TickerData),
		vwapNum: make(map[string]float64),
		vwapDen: make(map[string]float64),
	}
}

// Init seeds a symbol's ticker with its starting price
func (ts *TickerStore) Init(symbol string, price float64) {
	ts.mu.Lock()
	defer ts.mu.Unlock()
	ts.tickers[symbol] = &TickerData{
		Symbol:    symbol,
		LastPrice: price,
		High24h:   price,
		Low24h:    price,
		OpenPrice: price,
	}
}

// OnTrade updates the ticker when a trade executes
func (ts *TickerStore) OnTrade(t *types.Trade) {
	ts.mu.Lock()
	defer ts.mu.Unlock()

	d, ok := ts.tickers[t.Symbol]
	if !ok {
		return
	}

	d.LastPrice = t.Price
	d.Volume24h += t.Quantity

	if t.Price > d.High24h {
		d.High24h = t.Price
	}
	if t.Price < d.Low24h || d.Low24h == 0 {
		d.Low24h = t.Price
	}

	// accumulate VWAP
	ts.vwapNum[t.Symbol] += t.Price * t.Quantity
	ts.vwapDen[t.Symbol] += t.Quantity
	if ts.vwapDen[t.Symbol] > 0 {
		d.VWAP = ts.vwapNum[t.Symbol] / ts.vwapDen[t.Symbol]
	}

	if d.OpenPrice > 0 {
		d.Change24hPct = (d.LastPrice - d.OpenPrice) / d.OpenPrice
	}
	d.Timestamp = t.Timestamp.UnixMilli()
}

// OnBookUpdate updates best bid/ask from the latest order book state
func (ts *TickerStore) OnBookUpdate(symbol string, bestBid, bestAsk float64) {
	ts.mu.Lock()
	defer ts.mu.Unlock()

	d, ok := ts.tickers[symbol]
	if !ok {
		return
	}
	d.BestBid = bestBid
	d.BestAsk = bestAsk
	d.Spread = bestAsk - bestBid
}

// Get returns a copy of the ticker for a symbol (nil if unknown)
func (ts *TickerStore) Get(symbol string) *TickerData {
	ts.mu.RLock()
	defer ts.mu.RUnlock()

	d := ts.tickers[symbol]
	if d == nil {
		return nil
	}
	cp := *d
	return &cp
}

// All returns a copy of all tickers
func (ts *TickerStore) All() []*TickerData {
	ts.mu.RLock()
	defer ts.mu.RUnlock()

	result := make([]*TickerData, 0, len(ts.tickers))
	for _, d := range ts.tickers {
		cp := *d
		result = append(result, &cp)
	}
	return result
}
