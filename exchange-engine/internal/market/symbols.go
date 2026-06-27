package market

// SymbolMeta holds all static metadata for a tradeable symbol.
// This is the single source of truth for what symbols the exchange supports.
// To add a new symbol: append a row here — nothing else needs changing.
type SymbolMeta struct {
	Symbol    string  // exchange symbol ID, e.g. "BTC-USD"
	Label     string  // full name, e.g. "Bitcoin"
	BaseAsset string  // asset being bought/sold, e.g. "BTC"
	Category  string  // "crypto" | "stock"
	S0        float64 // simulated initial price (USD)
	Mu        float64 // GBM drift  (annualised, 0 = no trend)
	Sigma     float64 // GBM volatility (annualised, e.g. 0.02 = 2%)
	MarketCap float64 // simulated market cap (billions USD) — display only
	PriceDp   int     // decimal places for price display
	QtyDp     int     // decimal places for quantity display
}

// Symbols is the master list of all tradeable assets.
// The exchange engine registers each one on startup.
var Symbols = []SymbolMeta{
	// ── Major Crypto ─────────────────────────────────────────────────────────
	{
		Symbol: "BTC-USD", Label: "Bitcoin", BaseAsset: "BTC", Category: "crypto",
		S0: 45000.0, Mu: 0.0, Sigma: 0.020,
		MarketCap: 880.0, PriceDp: 2, QtyDp: 5,
	},
	{
		Symbol: "ETH-USD", Label: "Ethereum", BaseAsset: "ETH", Category: "crypto",
		S0: 2500.0, Mu: 0.0, Sigma: 0.025,
		MarketCap: 300.0, PriceDp: 2, QtyDp: 4,
	},
	{
		Symbol: "SOL-USD", Label: "Solana", BaseAsset: "SOL", Category: "crypto",
		S0: 150.0, Mu: 0.0, Sigma: 0.030,
		MarketCap: 68.0, PriceDp: 3, QtyDp: 3,
	},
	{
		Symbol: "BNB-USD", Label: "BNB", BaseAsset: "BNB", Category: "crypto",
		S0: 400.0, Mu: 0.0, Sigma: 0.025,
		MarketCap: 60.0, PriceDp: 2, QtyDp: 3,
	},
	{
		Symbol: "XRP-USD", Label: "XRP", BaseAsset: "XRP", Category: "crypto",
		S0: 0.60, Mu: 0.0, Sigma: 0.040,
		MarketCap: 33.0, PriceDp: 4, QtyDp: 1,
	},
	// ── Simulated Stocks ─────────────────────────────────────────────────────
	{
		Symbol: "AAPL-USD", Label: "Apple", BaseAsset: "AAPL", Category: "stock",
		S0: 185.0, Mu: 0.0, Sigma: 0.018,
		MarketCap: 2900.0, PriceDp: 2, QtyDp: 2,
	},
	{
		Symbol: "TSLA-USD", Label: "Tesla", BaseAsset: "TSLA", Category: "stock",
		S0: 250.0, Mu: 0.0, Sigma: 0.040,
		MarketCap: 800.0, PriceDp: 2, QtyDp: 2,
	},
	{
		Symbol: "NVDA-USD", Label: "NVIDIA", BaseAsset: "NVDA", Category: "stock",
		S0: 875.0, Mu: 0.0, Sigma: 0.035,
		MarketCap: 2150.0, PriceDp: 2, QtyDp: 3,
	},
}

// DefaultSymbols converts Symbols into GBMParams for the engine/generator.
// This replaces the old hardcoded DefaultSymbols() in gbm.go.
func DefaultSymbols() []GBMParams {
	params := make([]GBMParams, len(Symbols))
	for i, s := range Symbols {
		params[i] = GBMParams{
			Symbol:       s.Symbol,
			S0:           s.S0,
			Mu:           s.Mu,
			Sigma:        s.Sigma,
			CurrentPrice: s.S0,
		}
	}
	return params
}
