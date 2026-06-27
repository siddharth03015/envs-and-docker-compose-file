package market

import (
	"math"
	"math/rand"
)

// GBMParams holds parameters for a single symbol's price process
type GBMParams struct {
	Symbol     string
	S0         float64 // initial price
	Mu         float64 // drift (annualised)
	Sigma      float64 // volatility (annualised)
	CurrentPrice float64
}

// Step advances the GBM price by one time step dt (in years)
// St = S_{t-1} * exp( (mu - sigma^2/2)*dt + sigma*sqrt(dt)*Z )
// Z ~ N(0,1)
func (g *GBMParams) Step(dt float64) float64 {
	z := rand.NormFloat64()
	drift := (g.Mu - 0.5*g.Sigma*g.Sigma) * dt
	diffusion := g.Sigma * math.Sqrt(dt) * z
	g.CurrentPrice = g.CurrentPrice * math.Exp(drift+diffusion)
	return g.CurrentPrice
}

// RandomQty returns a random order quantity appropriate for the symbol price
func RandomQty(price float64) float64 {
	switch {
	case price > 10000: // BTC tier
		return math.Round((0.01+rand.Float64()*0.19)*1000) / 1000
	case price > 500: // ETH, BNB, NVDA, AAPL, TSLA upper
		return math.Round((0.05+rand.Float64()*0.95)*100) / 100
	case price > 1: // SOL, XRP upper, stocks mid
		return math.Round((0.5+rand.Float64()*9.5)*10) / 10
	default: // sub-dollar (XRP, ADA, DOGE)
		return math.Round((10 + rand.Float64()*90))
	}
}
