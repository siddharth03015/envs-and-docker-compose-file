package ohlcv

import (
	"sync"
	"time"
)

// Candle represents one OHLCV bar
type Candle struct {
	Time   int64   `json:"time"`   // Unix timestamp (seconds), bucket start
	Open   float64 `json:"open"`
	High   float64 `json:"high"`
	Low    float64 `json:"low"`
	Close  float64 `json:"close"`
	Volume float64 `json:"volume"`
}

type Interval string

const (
	Interval1s  Interval = "1s"
	Interval5s  Interval = "5s"
	Interval1m  Interval = "1m"
	Interval5m  Interval = "5m"
)

var IntervalSeconds = map[Interval]int64{
	Interval1s: 1,
	Interval5s: 5,
	Interval1m: 60,
	Interval5m: 300,
}

const maxCandles = 500 // keep last 500 candles per symbol per interval

// seriesKey is symbol + interval
type seriesKey struct {
	Symbol   string
	Interval Interval
}

// Aggregator consumes trade prices and maintains OHLCV candle history
type Aggregator struct {
	mu      sync.RWMutex
	history map[seriesKey][]Candle // completed candles
	current map[seriesKey]*Candle  // in-progress candle
	OnClose func(symbol string, interval Interval, candle Candle) // called when candle closes
}

func New() *Aggregator {
	return &Aggregator{
		history: make(map[seriesKey][]Candle),
		current: make(map[seriesKey]*Candle),
	}
}

// AddTrade processes a new trade into all interval candles
func (a *Aggregator) AddTrade(symbol string, price, qty float64, ts time.Time) {
	for interval, secs := range IntervalSeconds {
		a.update(symbol, interval, price, qty, ts, secs)
	}
}

func (a *Aggregator) update(symbol string, interval Interval, price, qty float64, ts time.Time, secs int64) {
	key := seriesKey{Symbol: symbol, Interval: interval}
	bucket := ts.Unix() / secs * secs // floor to bucket start

	a.mu.Lock()
	defer a.mu.Unlock()

	cur, exists := a.current[key]
	if !exists || cur.Time != bucket {
		// close previous candle
		if exists && cur != nil {
			closed := *cur
			hist := a.history[key]
			hist = append(hist, closed)
			if len(hist) > maxCandles {
				hist = hist[len(hist)-maxCandles:]
			}
			a.history[key] = hist
			if a.OnClose != nil {
				go a.OnClose(symbol, interval, closed)
			}
		}
		// open new candle
		a.current[key] = &Candle{
			Time:   bucket,
			Open:   price,
			High:   price,
			Low:    price,
			Close:  price,
			Volume: qty,
		}
		return
	}

	// update current candle
	if price > cur.High {
		cur.High = price
	}
	if price < cur.Low {
		cur.Low = price
	}
	cur.Close = price
	cur.Volume += qty
}

// GetHistory returns completed candles for a symbol/interval (up to limit)
func (a *Aggregator) GetHistory(symbol string, interval Interval, limit int) []Candle {
	key := seriesKey{Symbol: symbol, Interval: interval}

	a.mu.RLock()
	defer a.mu.RUnlock()

	hist := a.history[key]
	cur := a.current[key]

	var result []Candle
	if cur != nil {
		result = make([]Candle, 0, len(hist)+1)
		result = append(result, hist...)
		result = append(result, *cur)
	} else {
		result = make([]Candle, len(hist))
		copy(result, hist)
	}

	if limit > 0 && len(result) > limit {
		result = result[len(result)-limit:]
	}
	return result
}

// GetCurrentCandle returns the in-progress candle for a symbol/interval
func (a *Aggregator) GetCurrentCandle(symbol string, interval Interval) *Candle {
	key := seriesKey{Symbol: symbol, Interval: interval}
	a.mu.RLock()
	defer a.mu.RUnlock()
	c := a.current[key]
	if c == nil {
		return nil
	}
	cp := *c
	return &cp
}
