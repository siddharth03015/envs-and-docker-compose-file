package engine

import (
	"fmt"
	"sync"
	"time"

	"github.com/google/uuid"
)

// EventType for internal event bus
type EventType string

const (
	EventTrade       EventType = "trade"
	EventOrderBook   EventType = "orderbook"
	EventOrderAck    EventType = "order_ack"
	EventOrderFill   EventType = "order_fill"
	EventOrderCancel EventType = "order_cancel"
)

type Event struct {
	Type    EventType
	Symbol  string
	UserID  string
	Payload interface{}
}

// Engine orchestrates all order books and emits events
type Engine struct {
	books     map[string]*OrderBook
	mu        sync.RWMutex
	eventCh   chan Event
	stopPriceOrders map[string][]*Order // symbol -> stop-limit orders pending activation
}

func NewEngine() *Engine {
	return &Engine{
		books:           make(map[string]*OrderBook),
		eventCh:         make(chan Event, 4096),
		stopPriceOrders: make(map[string][]*Order),
	}
}

// RegisterSymbol creates a new order book for the given symbol
func (e *Engine) RegisterSymbol(symbol string) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.books[symbol] = NewOrderBook(symbol)
	e.stopPriceOrders[symbol] = make([]*Order, 0)
}

// Events returns the engine event channel for consumers (broadcast hub, portfolio, ohlcv)
func (e *Engine) Events() <-chan Event {
	return e.eventCh
}

// GetBook returns the order book for a symbol
func (e *Engine) GetBook(symbol string) (*OrderBook, error) {
	e.mu.RLock()
	defer e.mu.RUnlock()
	ob, ok := e.books[symbol]
	if !ok {
		return nil, fmt.Errorf("symbol %s not found", symbol)
	}
	return ob, nil
}

// GetOrder returns an order from a specific book by ID (nil if not found / fully filled)
func (e *Engine) GetOrder(symbol, orderID string) (*Order, bool) {
	ob, err := e.GetBook(symbol)
	if err != nil {
		return nil, false
	}
	return ob.GetOrder(orderID)
}

// Submit validates and processes an order
func (e *Engine) Submit(order *Order) error {
	if order.ID == "" {
		order.ID = uuid.New().String()
	}
	order.CreatedAt = time.Now()

	ob, err := e.GetBook(order.Symbol)
	if err != nil {
		return err
	}

	result, err := Match(ob, order)
	if err != nil {
		return err
	}

	// emit order ack
	e.emit(Event{Type: EventOrderAck, Symbol: order.Symbol, UserID: order.UserID, Payload: order})

	// emit trade events
	for _, trade := range result.Trades {
		e.emit(Event{Type: EventTrade, Symbol: order.Symbol, Payload: trade})
		// emit fill to buyer and seller
		e.emit(Event{Type: EventOrderFill, Symbol: order.Symbol, UserID: trade.BuyerID, Payload: trade})
		e.emit(Event{Type: EventOrderFill, Symbol: order.Symbol, UserID: trade.SellerID, Payload: trade})
	}

	// add resting order to LOB
	if result.RestingOrder != nil && result.RestingOrder.Type != StopLimit {
		ob.AddOrder(result.RestingOrder)
	}

	// handle stop-limit orders
	if result.RestingOrder != nil && result.RestingOrder.Type == StopLimit {
		e.mu.Lock()
		e.stopPriceOrders[order.Symbol] = append(e.stopPriceOrders[order.Symbol], result.RestingOrder)
		e.mu.Unlock()
	}

	// broadcast orderbook update after every submission
	e.emit(Event{Type: EventOrderBook, Symbol: order.Symbol, Payload: ob})

	return nil
}

// Cancel removes an order from the book
func (e *Engine) Cancel(orderID, userID, symbol string) error {
	ob, err := e.GetBook(symbol)
	if err != nil {
		return err
	}

	order, err := CancelFromBook(ob, orderID, userID)
	if err != nil {
		return err
	}

	e.emit(Event{Type: EventOrderCancel, Symbol: symbol, UserID: userID, Payload: order})
	e.emit(Event{Type: EventOrderBook, Symbol: symbol, Payload: ob})
	return nil
}

// CheckStopOrders activates stop-limit orders when the price crosses their stop price
func (e *Engine) CheckStopOrders(symbol string, lastPrice float64) {
	e.mu.Lock()
	pending := e.stopPriceOrders[symbol]
	remaining := pending[:0]

	var toActivate []*Order
	for _, o := range pending {
		triggered := false
		if o.Side == Buy && lastPrice >= o.StopPrice {
			triggered = true
		} else if o.Side == Sell && lastPrice <= o.StopPrice {
			triggered = true
		}
		if triggered {
			toActivate = append(toActivate, o)
		} else {
			remaining = append(remaining, o)
		}
	}
	e.stopPriceOrders[symbol] = remaining
	e.mu.Unlock()

	for _, o := range toActivate {
		o.Type = Limit // now acts as a regular limit order
		_ = e.Submit(o)
	}
}

// RestoreOrder adds an order directly into the LOB without matching (used on startup recovery).
// Stop-limit orders are placed in the pending stop-orders list.
func (e *Engine) RestoreOrder(order *Order) {
	ob, err := e.GetBook(order.Symbol)
	if err != nil {
		return
	}
	if order.Type == StopLimit {
		e.mu.Lock()
		e.stopPriceOrders[order.Symbol] = append(e.stopPriceOrders[order.Symbol], order)
		e.mu.Unlock()
		return
	}
	ob.AddOrder(order)
}

// Symbols returns all registered symbols
func (e *Engine) Symbols() []string {
	e.mu.RLock()
	defer e.mu.RUnlock()
	syms := make([]string, 0, len(e.books))
	for s := range e.books {
		syms = append(syms, s)
	}
	return syms
}

func (e *Engine) emit(ev Event) {
	select {
	case e.eventCh <- ev:
	default:
		// drop if buffer full (slow consumer) — never block the matching engine
	}
}
