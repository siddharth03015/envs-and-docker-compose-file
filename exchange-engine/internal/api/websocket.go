package api

import (
	"encoding/json"
	"log"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/opensoft/exchange-engine/internal/auth"
	"github.com/opensoft/exchange-engine/internal/broadcast"
	"github.com/opensoft/exchange-engine/internal/ohlcv"
	"github.com/opensoft/exchange-engine/internal/types"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 4096,
	CheckOrigin:    func(r *http.Request) bool { return true },
}

// WSHandler upgrades the HTTP connection to WebSocket and registers the client
func (s *Server) WSHandler(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r.Context())
	if userID == "" {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	username := auth.GetUsername(r.Context())

	symbol := r.URL.Query().Get("symbol")
	if symbol == "" {
		symbol = "BTC-USD"
	}

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("[ws] upgrade error: %v", err)
		return
	}

	client := &broadcast.Client{
		Hub:    s.Hub,
		Conn:   conn,
		Send:   make(chan []byte, broadcast.SendBufSize()),
		UserID: userID,
		Symbol: symbol,
	}

	s.Hub.Register(client)

	go s.sendInitialSnapshot(client, symbol, username)
	go client.WritePump()
	client.ReadPump(s.handleInbound)
}

// sendInitialSnapshot pushes current state to a newly connected client
func (s *Server) sendInitialSnapshot(client *broadcast.Client, symbol, username string) {
	// order book
	if ob, err := s.Engine.GetBook(symbol); err == nil {
		bids, asks := ob.Snapshot(20)
		sendJSON(client, broadcast.OrderBookMsg{
			Type:      broadcast.TypeOrderBook,
			Symbol:    symbol,
			Timestamp: time.Now().UnixMilli(),
			Bids:      toDepthEntries(bids),
			Asks:      toDepthEntries(asks),
		})
	}

	// recent trades
	for _, t := range s.Trades.Get(symbol, 50) {
		sendJSON(client, broadcast.TradeMsg{
			Type:          broadcast.TypeTrade,
			Symbol:        symbol,
			TradeID:       t.ID,
			Price:         t.Price,
			Quantity:      t.Quantity,
			AggressorSide: t.AggressorSide,
			Timestamp:     t.Timestamp.UnixMilli(),
		})
	}

	// OHLCV history for all intervals
	for _, interval := range []ohlcv.Interval{ohlcv.Interval1s, ohlcv.Interval5s, ohlcv.Interval1m, ohlcv.Interval5m} {
		for _, c := range s.OHLCV.GetHistory(symbol, interval, 200) {
			sendJSON(client, broadcast.OHLCVMsg{
				Type:     broadcast.TypeOHLCV,
				Symbol:   symbol,
				Interval: string(interval),
				Candle:   c,
				IsClosed: true,
			})
		}
	}

	// ticker
	if ticker := s.Ticker.Get(symbol); ticker != nil {
		sendJSON(client, ticker)
	}

	// portfolio
	if snap, err := s.Portfolio.Snapshot(client.UserID); err == nil {
		sendJSON(client, map[string]interface{}{
			"type":     broadcast.TypePortfolio,
			"username": username,
			"data":     snap,
		})
	}

	log.Printf("[ws] sent initial snapshot to user=%s symbol=%s", client.UserID, symbol)
}

// handleInbound routes inbound WebSocket messages to the engine
func (s *Server) handleInbound(client *broadcast.Client, raw []byte) {
	var msg broadcast.InboundMsg
	if err := json.Unmarshal(raw, &msg); err != nil {
		sendJSON(client, broadcast.ErrorMsg{Type: broadcast.TypeError, Code: "BAD_MSG", Message: "invalid JSON"})
		return
	}

	switch msg.Type {
	case broadcast.InboundOrder:
		s.handleOrderMsg(client, msg.Payload)

	case broadcast.InboundCancel:
		orderID, _ := msg.Payload["order_id"].(string)
		symbol, _ := msg.Payload["symbol"].(string)
		if symbol == "" {
			symbol = client.Symbol
		}
		if err := s.Engine.Cancel(orderID, client.UserID, symbol); err != nil {
			sendJSON(client, broadcast.ErrorMsg{Type: broadcast.TypeError, Code: "CANCEL_FAILED", Message: err.Error()})
		}

	case broadcast.InboundChangeSymbol:
		if msg.Symbol != "" {
			client.SetSymbol(msg.Symbol)
			go s.sendInitialSnapshot(client, msg.Symbol, "")
		}

	case broadcast.InboundSubscribe:
		if msg.Symbol != "" {
			client.SetSymbol(msg.Symbol)
		}
	}
}

func (s *Server) handleOrderMsg(client *broadcast.Client, payload map[string]interface{}) {
	symbol, _ := payload["symbol"].(string)
	sideStr, _ := payload["side"].(string)
	typeStr, _ := payload["type"].(string)
	qty, _ := payload["quantity"].(float64)
	price, _ := payload["price"].(float64)
	stopPrice, _ := payload["stop_price"].(float64)

	if symbol == "" || sideStr == "" || typeStr == "" || qty <= 0 {
		sendJSON(client, broadcast.ErrorMsg{Type: broadcast.TypeError, Code: "INVALID_ORDER", Message: "missing required fields"})
		return
	}

	side := types.Side(sideStr)
	orderType := types.OrderType(typeStr)

	if err := s.Portfolio.ValidateOrder(client.UserID, symbol, side, qty, price, orderType); err != nil {
		sendJSON(client, broadcast.ErrorMsg{Type: broadcast.TypeError, Code: "INSUFFICIENT_FUNDS", Message: err.Error()})
		return
	}

	order := &types.Order{
		ID:        uuid.New().String(),
		UserID:    client.UserID,
		Symbol:    symbol,
		Side:      side,
		Type:      orderType,
		Price:     price,
		StopPrice: stopPrice,
		Quantity:  qty,
		Status:    types.StatusOpen,
		CreatedAt: time.Now(),
	}

	if err := s.Engine.Submit(order); err != nil {
		sendJSON(client, broadcast.ErrorMsg{Type: broadcast.TypeError, Code: "SUBMIT_FAILED", Message: err.Error()})
	}
}

// sendJSON marshals v and enqueues it on the client's send channel (non-blocking)
func sendJSON(client *broadcast.Client, v interface{}) {
	data, err := json.Marshal(v)
	if err != nil {
		return
	}
	select {
	case client.Send <- data:
	default:
	}
}

// toDepthEntries converts engine depth entries to broadcast format
func toDepthEntries(entries []types.DepthEntry) []broadcast.DepthEntry {
	result := make([]broadcast.DepthEntry, len(entries))
	for i, e := range entries {
		result[i] = broadcast.DepthEntry{Price: e.Price, Quantity: e.Quantity}
	}
	return result
}
