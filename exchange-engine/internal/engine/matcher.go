package engine

import (
	"fmt"
	"time"

	"github.com/google/uuid"
)

// MatchResult holds all trades and order status changes from a single submission
type MatchResult struct {
	Trades        []*Trade
	FilledOrders  []*Order
	PartialOrders []*Order
	RestingOrder  *Order // nil if fully filled or market order exhausted
}

// matchLimitBuy matches an incoming buy limit order against the ask side
func matchLimitBuy(ob *OrderBook, incoming *Order) *MatchResult {
	result := &MatchResult{}

	for len(ob.Asks) > 0 && incoming.Remaining() > 0 {
		bestAsk := ob.Asks[0]
		if bestAsk.Price > incoming.Price {
			break // no more asks at acceptable price
		}
		result.Trades = append(result.Trades, fillAgainstLevel(ob, bestAsk, incoming, Sell)...)
	}

	if incoming.Remaining() > 0 && incoming.Status != StatusCancelled {
		incoming.Status = StatusOpen
		if incoming.Filled > 0 {
			incoming.Status = StatusPartial
		}
		result.RestingOrder = incoming
	}
	return result
}

// matchLimitSell matches an incoming sell limit order against the bid side
func matchLimitSell(ob *OrderBook, incoming *Order) *MatchResult {
	result := &MatchResult{}

	for len(ob.Bids) > 0 && incoming.Remaining() > 0 {
		bestBid := ob.Bids[0]
		if bestBid.Price < incoming.Price {
			break // no bids at acceptable price
		}
		result.Trades = append(result.Trades, fillAgainstLevel(ob, bestBid, incoming, Buy)...)
	}

	if incoming.Remaining() > 0 {
		incoming.Status = StatusOpen
		if incoming.Filled > 0 {
			incoming.Status = StatusPartial
		}
		result.RestingOrder = incoming
	}
	return result
}

// matchMarketBuy matches a market buy order against all available asks
func matchMarketBuy(ob *OrderBook, incoming *Order) *MatchResult {
	result := &MatchResult{}
	for len(ob.Asks) > 0 && incoming.Remaining() > 0 {
		bestAsk := ob.Asks[0]
		result.Trades = append(result.Trades, fillAgainstLevel(ob, bestAsk, incoming, Sell)...)
	}
	if incoming.IsFullyFilled() {
		incoming.Status = StatusFilled
	} else {
		incoming.Status = StatusPartial
	}
	return result
}

// matchMarketSell matches a market sell order against all available bids
func matchMarketSell(ob *OrderBook, incoming *Order) *MatchResult {
	result := &MatchResult{}
	for len(ob.Bids) > 0 && incoming.Remaining() > 0 {
		bestBid := ob.Bids[0]
		result.Trades = append(result.Trades, fillAgainstLevel(ob, bestBid, incoming, Buy)...)
	}
	if incoming.IsFullyFilled() {
		incoming.Status = StatusFilled
	} else {
		incoming.Status = StatusPartial
	}
	return result
}

// fillAgainstLevel fills incoming order against a single price level (FIFO)
func fillAgainstLevel(ob *OrderBook, level *PriceLevel, incoming *Order, restingSide Side) []*Trade {
	var trades []*Trade
	execPrice := level.Price

	for len(level.Orders) > 0 && incoming.Remaining() > 0 {
		resting := level.Orders[0]

		fillQty := resting.Remaining()
		if incoming.Remaining() < fillQty {
			fillQty = incoming.Remaining()
		}

		// update both orders
		resting.Filled += fillQty
		incoming.Filled += fillQty

		var buyID, sellID, buyerID, sellerID string
		var aggressor Side
		if incoming.Side == Buy {
			buyID, sellID = incoming.ID, resting.ID
			buyerID, sellerID = incoming.UserID, resting.UserID
			aggressor = Buy
		} else {
			buyID, sellID = resting.ID, incoming.ID
			buyerID, sellerID = resting.UserID, incoming.UserID
			aggressor = Sell
		}

		trade := &Trade{
			ID:            uuid.New().String(),
			Symbol:        incoming.Symbol,
			BuyOrderID:    buyID,
			SellOrderID:   sellID,
			BuyerID:       buyerID,
			SellerID:      sellerID,
			Price:         execPrice,
			Quantity:      fillQty,
			AggressorSide: aggressor,
			Timestamp:     time.Now(),
		}
		trades = append(trades, trade)

		if resting.IsFullyFilled() {
			resting.Status = StatusFilled
			level.Orders = level.Orders[1:]
			delete(ob.OrderMap, resting.ID)
		} else {
			resting.Status = StatusPartial
		}
	}

	// clean up empty price level
	if len(level.Orders) == 0 {
		if restingSide == Sell {
			ob.Asks = ob.Asks[1:]
		} else {
			ob.Bids = ob.Bids[1:]
		}
	}

	return trades
}

// Match is the main entry point — routes to correct matching function
func Match(ob *OrderBook, order *Order) (*MatchResult, error) {
	ob.mu.Lock()
	defer ob.mu.Unlock()

	switch order.Type {
	case Limit:
		if order.Side == Buy {
			return matchLimitBuy(ob, order), nil
		}
		return matchLimitSell(ob, order), nil

	case Market:
		if order.Side == Buy {
			return matchMarketBuy(ob, order), nil
		}
		return matchMarketSell(ob, order), nil

	case StopLimit:
		// Stop-Limit: rests in book, engine activates it when price crosses StopPrice
		// For now treat as a resting limit order added to LOB without matching
		order.Status = StatusOpen
		return &MatchResult{RestingOrder: order}, nil

	default:
		return nil, fmt.Errorf("unknown order type: %s", order.Type)
	}
}

// CancelFromBook removes an order from the LOB, returns the cancelled order
func CancelFromBook(ob *OrderBook, orderID, userID string) (*Order, error) {
	ob.mu.Lock()
	defer ob.mu.Unlock()

	order, ok := ob.OrderMap[orderID]
	if !ok {
		return nil, fmt.Errorf("order %s not found", orderID)
	}
	if order.UserID != userID {
		return nil, fmt.Errorf("order %s does not belong to user %s", orderID, userID)
	}
	if order.Status == StatusFilled || order.Status == StatusCancelled {
		return nil, fmt.Errorf("order %s cannot be cancelled (status: %s)", orderID, order.Status)
	}

	order.Status = StatusCancelled
	delete(ob.OrderMap, orderID)

	if order.Side == Buy {
		ob.removeFromBids(order)
	} else {
		ob.removeFromAsks(order)
	}
	return order, nil
}
