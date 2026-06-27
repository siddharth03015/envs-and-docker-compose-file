// Package engine implements the core matching engine and order book.
// Domain types (Order, Trade, etc.) live in internal/types and are
// aliased here so callers within this package don't need to import types directly.
package engine

import "github.com/opensoft/exchange-engine/internal/types"

// Type aliases — engine consumers can use engine.Order, engine.Side, etc.
// without needing to import the types package directly.
type (
	Order       = types.Order
	Trade       = types.Trade
	Side        = types.Side
	OrderType   = types.OrderType
	OrderStatus = types.OrderStatus
	DepthEntry  = types.DepthEntry
)

// Re-export constants so callers use engine.Buy, engine.Market, etc.
const (
	Buy  = types.Buy
	Sell = types.Sell

	Limit     = types.Limit
	Market    = types.Market
	StopLimit = types.StopLimit

	StatusOpen      = types.StatusOpen
	StatusPartial   = types.StatusPartial
	StatusFilled    = types.StatusFilled
	StatusCancelled = types.StatusCancelled
)
