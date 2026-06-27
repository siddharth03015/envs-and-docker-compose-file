package portfolio

import "sync"

// Position tracks a user's holding in a single symbol
type Position struct {
	Symbol        string  `json:"symbol"`
	Quantity      float64 `json:"quantity"`        // negative = short
	AvgEntryPrice float64 `json:"avg_entry_price"`
}

// UnrealizedPnL calculates P&L against current market price
func (p *Position) UnrealizedPnL(currentPrice float64) float64 {
	return (currentPrice - p.AvgEntryPrice) * p.Quantity
}

// Portfolio tracks a single user's full financial state
type Portfolio struct {
	mu          sync.RWMutex
	UserID      string
	Cash        float64
	Positions   map[string]*Position // symbol -> position
	RealizedPnL float64
}

func New(userID string, startingCash float64) *Portfolio {
	return &Portfolio{
		UserID:    userID,
		Cash:      startingCash,
		Positions: make(map[string]*Position),
	}
}

// ApplyBuy updates portfolio for a buy fill
func (p *Portfolio) ApplyBuy(symbol string, price, qty float64) {
	p.mu.Lock()
	defer p.mu.Unlock()

	cost := price * qty
	p.Cash -= cost

	pos, ok := p.Positions[symbol]
	if !ok {
		p.Positions[symbol] = &Position{Symbol: symbol, Quantity: qty, AvgEntryPrice: price}
		return
	}

	if pos.Quantity >= 0 {
		// adding to long or opening new long
		totalCost := pos.AvgEntryPrice*pos.Quantity + price*qty
		pos.Quantity += qty
		if pos.Quantity != 0 {
			pos.AvgEntryPrice = totalCost / pos.Quantity
		}
	} else {
		// covering a short
		closeQty := qty
		if closeQty > -pos.Quantity {
			closeQty = -pos.Quantity
		}
		// realized P&L on the covered portion
		p.RealizedPnL += (pos.AvgEntryPrice - price) * closeQty
		pos.Quantity += qty
		if pos.Quantity > 0 {
			// flipped to long
			pos.AvgEntryPrice = price
		}
	}
}

// ApplySell updates portfolio for a sell fill
func (p *Portfolio) ApplySell(symbol string, price, qty float64) {
	p.mu.Lock()
	defer p.mu.Unlock()

	proceeds := price * qty
	p.Cash += proceeds

	pos, ok := p.Positions[symbol]
	if !ok {
		// opening a short
		p.Positions[symbol] = &Position{Symbol: symbol, Quantity: -qty, AvgEntryPrice: price}
		return
	}

	if pos.Quantity <= 0 {
		// adding to short
		totalCost := pos.AvgEntryPrice*(-pos.Quantity) + price*qty
		pos.Quantity -= qty
		if pos.Quantity != 0 {
			pos.AvgEntryPrice = totalCost / (-pos.Quantity)
		}
	} else {
		// closing a long
		closeQty := qty
		if closeQty > pos.Quantity {
			closeQty = pos.Quantity
		}
		p.RealizedPnL += (price - pos.AvgEntryPrice) * closeQty
		pos.Quantity -= qty
		if pos.Quantity < 0 {
			// flipped to short
			pos.AvgEntryPrice = price
		}
	}
}

// Snapshot returns a JSON-serializable view of the portfolio
type PositionView struct {
	Symbol          string  `json:"symbol"`
	Quantity        float64 `json:"quantity"`
	AvgEntryPrice   float64 `json:"avg_entry_price"`
	CurrentPrice    float64 `json:"current_price"`
	MarketValue     float64 `json:"market_value"`
	UnrealizedPnL   float64 `json:"unrealized_pnl"`
	UnrealizedPnLPct float64 `json:"unrealized_pnl_pct"`
}

type Snapshot struct {
	UserID      string                  `json:"user_id"`
	Cash        float64                 `json:"cash"`
	Positions   map[string]PositionView `json:"positions"`
	RealizedPnL float64                 `json:"realized_pnl"`
	TotalValue  float64                 `json:"total_value"`
}

func (p *Portfolio) Snapshot(prices map[string]float64) Snapshot {
	p.mu.RLock()
	defer p.mu.RUnlock()

	snap := Snapshot{
		UserID:      p.UserID,
		Cash:        p.Cash,
		Positions:   make(map[string]PositionView),
		RealizedPnL: p.RealizedPnL,
		TotalValue:  p.Cash,
	}

	for sym, pos := range p.Positions {
		if pos.Quantity == 0 {
			continue
		}
		cur := prices[sym]
		unrealized := pos.UnrealizedPnL(cur)
		marketVal := cur * pos.Quantity
		pct := 0.0
		if pos.AvgEntryPrice != 0 {
			pct = (cur - pos.AvgEntryPrice) / pos.AvgEntryPrice
		}
		snap.Positions[sym] = PositionView{
			Symbol:           sym,
			Quantity:         pos.Quantity,
			AvgEntryPrice:    pos.AvgEntryPrice,
			CurrentPrice:     cur,
			MarketValue:      marketVal,
			UnrealizedPnL:    unrealized,
			UnrealizedPnLPct: pct,
		}
		snap.TotalValue += marketVal
	}
	return snap
}

func (p *Portfolio) GetCash() float64 {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.Cash
}

func (p *Portfolio) GetPosition(symbol string) (float64, float64) {
	p.mu.RLock()
	defer p.mu.RUnlock()
	if pos, ok := p.Positions[symbol]; ok {
		return pos.Quantity, pos.AvgEntryPrice
	}
	return 0, 0
}
