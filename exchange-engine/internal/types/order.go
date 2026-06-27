// Package types defines all shared domain types used across the exchange engine.
// No business logic lives here — only data structures and constants.
package types

import "time"

// Side represents the direction of an order
type Side string

const (
	Buy  Side = "BUY"
	Sell Side = "SELL"
)

// OrderType represents the execution style of an order
type OrderType string

const (
	Limit     OrderType = "LIMIT"
	Market    OrderType = "MARKET"
	StopLimit OrderType = "STOP_LIMIT"
)

// OrderStatus represents the current lifecycle state of an order
type OrderStatus string

const (
	StatusOpen      OrderStatus = "OPEN"
	StatusPartial   OrderStatus = "PARTIAL"
	StatusFilled    OrderStatus = "FILLED"
	StatusCancelled OrderStatus = "CANCELLED"
)

// Order represents a single trading instruction placed by a user or the market system
type Order struct {
	ID        string      `json:"id"`
	UserID    string      `json:"user_id"`
	Symbol    string      `json:"symbol"`
	Side      Side        `json:"side"`
	Type      OrderType   `json:"type"`
	Price     float64     `json:"price"`      // 0 for Market orders
	StopPrice float64     `json:"stop_price"` // for Stop-Limit only
	Quantity  float64     `json:"quantity"`
	Filled    float64     `json:"filled"`
	Status    OrderStatus `json:"status"`
	CreatedAt time.Time   `json:"created_at"`
}

// Remaining returns the unfilled quantity of the order
func (o *Order) Remaining() float64 {
	return o.Quantity - o.Filled
}

// IsFullyFilled returns true when the order has been completely executed
func (o *Order) IsFullyFilled() bool {
	return o.Filled >= o.Quantity
}

// Trade represents a single matched execution between a buyer and seller
type Trade struct {
	ID            string    `json:"id"`
	Symbol        string    `json:"symbol"`
	BuyOrderID    string    `json:"buy_order_id"`
	SellOrderID   string    `json:"sell_order_id"`
	BuyerID       string    `json:"buyer_id"`
	SellerID      string    `json:"seller_id"`
	Price         float64   `json:"price"`
	Quantity      float64   `json:"quantity"`
	AggressorSide Side      `json:"aggressor_side"`
	Timestamp     time.Time `json:"timestamp"`
}

// DepthEntry represents a single price level in the order book depth view
type DepthEntry struct {
	Price    float64 `json:"price"`
	Quantity float64 `json:"quantity"`
}
