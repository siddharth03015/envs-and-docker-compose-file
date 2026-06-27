// Package store provides in-memory data stores for market history.
package store

import (
	"sync"
	"time"

	"github.com/opensoft/exchange-engine/internal/types"
)

// TradeRecord is the serialisable view of an executed trade stored in the ring buffer
type TradeRecord struct {
	ID            string    `json:"id"`
	Symbol        string    `json:"symbol"`
	Price         float64   `json:"price"`
	Quantity      float64   `json:"quantity"`
	AggressorSide string    `json:"aggressor_side"`
	Timestamp     time.Time `json:"timestamp"`
}

// TradeStore is a bounded in-memory ring buffer of recent trades per symbol
type TradeStore struct {
	mu     sync.RWMutex
	trades map[string][]TradeRecord
	max    int
}

// NewTradeStore creates a TradeStore keeping at most max trades per symbol
func NewTradeStore(max int) *TradeStore {
	return &TradeStore{
		trades: make(map[string][]TradeRecord),
		max:    max,
	}
}

// Add appends a trade to the symbol's ring buffer, evicting oldest if over capacity
func (ts *TradeStore) Add(t *types.Trade) {
	ts.mu.Lock()
	defer ts.mu.Unlock()

	rec := TradeRecord{
		ID:            t.ID,
		Symbol:        t.Symbol,
		Price:         t.Price,
		Quantity:      t.Quantity,
		AggressorSide: string(t.AggressorSide),
		Timestamp:     t.Timestamp,
	}
	ts.trades[t.Symbol] = append(ts.trades[t.Symbol], rec)
	if len(ts.trades[t.Symbol]) > ts.max {
		ts.trades[t.Symbol] = ts.trades[t.Symbol][len(ts.trades[t.Symbol])-ts.max:]
	}
}

// Get returns up to limit of the most recent trades for a symbol (oldest first)
func (ts *TradeStore) Get(symbol string, limit int) []TradeRecord {
	ts.mu.RLock()
	defer ts.mu.RUnlock()

	all := ts.trades[symbol]
	if limit > len(all) {
		limit = len(all)
	}
	if limit == 0 {
		return []TradeRecord{}
	}
	result := make([]TradeRecord, limit)
	copy(result, all[len(all)-limit:])
	return result
}
