package market

import (
	"context"
	"log"
	"math/rand"
	"time"

	"github.com/google/uuid"
	"github.com/opensoft/exchange-engine/internal/engine"
)

const (
	tickInterval   = 20 * time.Millisecond // 50 ticks/sec per symbol
	dtPerTick      = 20.0 / (365.0 * 24 * 3600 * 1000) // 20ms in years
	systemUserID   = "market_system"
	maxStaleOrders = 50 // cancel stale orders after this many
)

// Generator drives one symbol's synthetic market
type Generator struct {
	params    GBMParams
	eng       *engine.Engine
	staleIDs  []string
}

func NewGenerator(params GBMParams, eng *engine.Engine) *Generator {
	return &Generator{params: params, eng: eng}
}

// Run starts the market generator loop — blocks until ctx is cancelled
func (g *Generator) Run(ctx context.Context) {
	ticker := time.NewTicker(tickInterval)
	defer ticker.Stop()

	log.Printf("[market] starting GBM generator for %s at %.2f", g.params.Symbol, g.params.CurrentPrice)

	for {
		select {
		case <-ctx.Done():
			log.Printf("[market] stopping generator for %s", g.params.Symbol)
			return
		case <-ticker.C:
			g.tick()
		}
	}
}

func (g *Generator) tick() {
	price := g.params.Step(dtPerTick)

	// generate 1-3 passive bid/ask pairs per tick
	numPairs := 1 + rand.Intn(2)
	for i := 0; i < numPairs; i++ {
		g.placeBid(price)
		g.placeAsk(price)
	}

	// ~30% of ticks: place an aggressive order that crosses the spread → generates trades
	if rand.Float64() < 0.30 {
		g.placeAggressiveOrder(price)
	}

	// periodically cancel old stale orders to keep book fresh
	if len(g.staleIDs) > maxStaleOrders {
		cancelCount := 5 + rand.Intn(5)
		for i := 0; i < cancelCount && len(g.staleIDs) > 0; i++ {
			id := g.staleIDs[0]
			g.staleIDs = g.staleIDs[1:]
			_ = g.eng.Cancel(id, systemUserID, g.params.Symbol)
		}
	}
}

// placeAggressiveOrder places a market-crossing limit order to generate trades
func (g *Generator) placeAggressiveOrder(midPrice float64) {
	qty := RandomQty(midPrice)
	var order *engine.Order

	if rand.Intn(2) == 0 {
		// aggressive buy: price slightly above mid (will hit asks)
		price := roundPrice(midPrice * (1.0 + rand.Float64()*0.002))
		order = &engine.Order{
			ID: uuid.New().String(), UserID: systemUserID, Symbol: g.params.Symbol,
			Side: engine.Buy, Type: engine.Limit, Price: price, Quantity: qty,
			Status: engine.StatusOpen, CreatedAt: time.Now(),
		}
	} else {
		// aggressive sell: price slightly below mid (will hit bids)
		price := roundPrice(midPrice * (1.0 - rand.Float64()*0.002))
		order = &engine.Order{
			ID: uuid.New().String(), UserID: systemUserID, Symbol: g.params.Symbol,
			Side: engine.Sell, Type: engine.Limit, Price: price, Quantity: qty,
			Status: engine.StatusOpen, CreatedAt: time.Now(),
		}
	}

	_ = g.eng.Submit(order)
}

func (g *Generator) placeBid(midPrice float64) {
	// bid: slightly below mid price (0.05% to 0.5% below)
	spread := 0.0005 + rand.Float64()*0.0045
	price := midPrice * (1.0 - spread)
	price = roundPrice(price)
	qty := RandomQty(midPrice)

	order := &engine.Order{
		ID:        uuid.New().String(),
		UserID:    systemUserID,
		Symbol:    g.params.Symbol,
		Side:      engine.Buy,
		Type:      engine.Limit,
		Price:     price,
		Quantity:  qty,
		Status:    engine.StatusOpen,
		CreatedAt: time.Now(),
	}

	if err := g.eng.Submit(order); err == nil {
		g.staleIDs = append(g.staleIDs, order.ID)
	}
}

func (g *Generator) placeAsk(midPrice float64) {
	// ask: slightly above mid price (0.05% to 0.5% above)
	spread := 0.0005 + rand.Float64()*0.0045
	price := midPrice * (1.0 + spread)
	price = roundPrice(price)
	qty := RandomQty(midPrice)

	order := &engine.Order{
		ID:        uuid.New().String(),
		UserID:    systemUserID,
		Symbol:    g.params.Symbol,
		Side:      engine.Sell,
		Type:      engine.Limit,
		Price:     price,
		Quantity:  qty,
		Status:    engine.StatusOpen,
		CreatedAt: time.Now(),
	}

	if err := g.eng.Submit(order); err == nil {
		g.staleIDs = append(g.staleIDs, order.ID)
	}
}

// roundPrice rounds to 2 decimal places for most prices, 4 for sub-$1 assets
func roundPrice(p float64) float64 {
	if p >= 1.0 {
		return float64(int(p*100)) / 100.0
	}
	return float64(int(p*10000)) / 10000.0
}
