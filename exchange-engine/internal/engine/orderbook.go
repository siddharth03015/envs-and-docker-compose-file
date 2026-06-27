package engine

import (
	"sort"
	"sync"
)

// PriceLevel holds all orders at a specific price point (FIFO queue)
type PriceLevel struct {
	Price  float64
	Orders []*Order
}

func (pl *PriceLevel) TotalQty() float64 {
	total := 0.0
	for _, o := range pl.Orders {
		total += o.Remaining()
	}
	return total
}

// OrderBook is the in-memory Limit Order Book for one symbol
type OrderBook struct {
	Symbol   string
	Bids     []*PriceLevel       // sorted descending (highest bid first)
	Asks     []*PriceLevel       // sorted ascending (lowest ask first)
	OrderMap map[string]*Order   // orderID → *Order for O(1) lookup
	mu       sync.RWMutex
}

func NewOrderBook(symbol string) *OrderBook {
	return &OrderBook{
		Symbol:   symbol,
		Bids:     make([]*PriceLevel, 0, 64),
		Asks:     make([]*PriceLevel, 0, 64),
		OrderMap: make(map[string]*Order),
	}
}

// AddOrder inserts an order into the correct side and price level
func (ob *OrderBook) AddOrder(order *Order) {
	ob.mu.Lock()
	defer ob.mu.Unlock()
	ob.OrderMap[order.ID] = order
	if order.Side == Buy {
		ob.insertBid(order)
	} else {
		ob.insertAsk(order)
	}
}

func (ob *OrderBook) insertBid(order *Order) {
	// find or create price level, bids sorted descending
	idx := sort.Search(len(ob.Bids), func(i int) bool {
		return ob.Bids[i].Price <= order.Price
	})
	if idx < len(ob.Bids) && ob.Bids[idx].Price == order.Price {
		ob.Bids[idx].Orders = append(ob.Bids[idx].Orders, order)
	} else {
		pl := &PriceLevel{Price: order.Price, Orders: []*Order{order}}
		ob.Bids = append(ob.Bids, nil)
		copy(ob.Bids[idx+1:], ob.Bids[idx:])
		ob.Bids[idx] = pl
	}
}

func (ob *OrderBook) insertAsk(order *Order) {
	// asks sorted ascending
	idx := sort.Search(len(ob.Asks), func(i int) bool {
		return ob.Asks[i].Price >= order.Price
	})
	if idx < len(ob.Asks) && ob.Asks[idx].Price == order.Price {
		ob.Asks[idx].Orders = append(ob.Asks[idx].Orders, order)
	} else {
		pl := &PriceLevel{Price: order.Price, Orders: []*Order{order}}
		ob.Asks = append(ob.Asks, nil)
		copy(ob.Asks[idx+1:], ob.Asks[idx:])
		ob.Asks[idx] = pl
	}
}

// RemoveOrder removes an order from the LOB by ID
func (ob *OrderBook) RemoveOrder(orderID string) bool {
	ob.mu.Lock()
	defer ob.mu.Unlock()
	order, ok := ob.OrderMap[orderID]
	if !ok {
		return false
	}
	delete(ob.OrderMap, orderID)
	if order.Side == Buy {
		ob.removeFromBids(order)
	} else {
		ob.removeFromAsks(order)
	}
	return true
}

func (ob *OrderBook) removeFromBids(order *Order) {
	for i, pl := range ob.Bids {
		if pl.Price == order.Price {
			for j, o := range pl.Orders {
				if o.ID == order.ID {
					pl.Orders = append(pl.Orders[:j], pl.Orders[j+1:]...)
					break
				}
			}
			if len(pl.Orders) == 0 {
				ob.Bids = append(ob.Bids[:i], ob.Bids[i+1:]...)
			}
			return
		}
	}
}

func (ob *OrderBook) removeFromAsks(order *Order) {
	for i, pl := range ob.Asks {
		if pl.Price == order.Price {
			for j, o := range pl.Orders {
				if o.ID == order.ID {
					pl.Orders = append(pl.Orders[:j], pl.Orders[j+1:]...)
					break
				}
			}
			if len(pl.Orders) == 0 {
				ob.Asks = append(ob.Asks[:i], ob.Asks[i+1:]...)
			}
			return
		}
	}
}

// GetOrder returns an order by ID
func (ob *OrderBook) GetOrder(orderID string) (*Order, bool) {
	ob.mu.RLock()
	defer ob.mu.RUnlock()
	o, ok := ob.OrderMap[orderID]
	return o, ok
}

// BestBid returns the highest bid price level (or nil)
func (ob *OrderBook) BestBid() *PriceLevel {
	ob.mu.RLock()
	defer ob.mu.RUnlock()
	if len(ob.Bids) == 0 {
		return nil
	}
	return ob.Bids[0]
}

// BestAsk returns the lowest ask price level (or nil)
func (ob *OrderBook) BestAsk() *PriceLevel {
	ob.mu.RLock()
	defer ob.mu.RUnlock()
	if len(ob.Asks) == 0 {
		return nil
	}
	return ob.Asks[0]
}

// MidPrice returns (bestBid + bestAsk) / 2
func (ob *OrderBook) MidPrice() float64 {
	ob.mu.RLock()
	defer ob.mu.RUnlock()
	if len(ob.Bids) == 0 || len(ob.Asks) == 0 {
		return 0
	}
	return (ob.Bids[0].Price + ob.Asks[0].Price) / 2.0
}

// ForEachOrder iterates all orders in the book (used for listing open orders)
func (ob *OrderBook) ForEachOrder(fn func(*Order)) {
	ob.mu.RLock()
	defer ob.mu.RUnlock()
	for _, o := range ob.OrderMap {
		fn(o)
	}
}

// Snapshot returns top N bid and ask levels for broadcasting
func (ob *OrderBook) Snapshot(levels int) (bids, asks []DepthEntry) {
	ob.mu.RLock()
	defer ob.mu.RUnlock()

	n := levels
	if n > len(ob.Bids) {
		n = len(ob.Bids)
	}
	bids = make([]DepthEntry, n)
	for i := 0; i < n; i++ {
		bids[i] = DepthEntry{Price: ob.Bids[i].Price, Quantity: ob.Bids[i].TotalQty()}
	}

	n = levels
	if n > len(ob.Asks) {
		n = len(ob.Asks)
	}
	asks = make([]DepthEntry, n)
	for i := 0; i < n; i++ {
		asks[i] = DepthEntry{Price: ob.Asks[i].Price, Quantity: ob.Asks[i].TotalQty()}
	}
	return
}
