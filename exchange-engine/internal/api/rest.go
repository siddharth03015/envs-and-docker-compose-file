package api

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/opensoft/exchange-engine/internal/auth"
	"github.com/opensoft/exchange-engine/internal/broadcast"
	"github.com/opensoft/exchange-engine/internal/db"
	"github.com/opensoft/exchange-engine/internal/engine"
	"github.com/opensoft/exchange-engine/internal/market"
	"github.com/opensoft/exchange-engine/internal/ohlcv"
	"github.com/opensoft/exchange-engine/internal/portfolio"
	"github.com/opensoft/exchange-engine/internal/store"
	"github.com/opensoft/exchange-engine/internal/types"
)

// Server holds all handler dependencies
type Server struct {
	Engine    *engine.Engine
	Portfolio *portfolio.Manager
	OHLCV     *ohlcv.Aggregator
	Hub       *broadcast.Hub
	Trades    *store.TradeStore
	Ticker    *store.TickerStore
}

// --- Order handlers ---

type submitOrderRequest struct {
	Symbol    string          `json:"symbol"`
	Side      types.Side      `json:"side"`
	Type      types.OrderType `json:"type"`
	Quantity  float64         `json:"quantity"`
	Price     float64         `json:"price"`
	StopPrice float64         `json:"stop_price"`
}

func (s *Server) SubmitOrder(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r.Context())

	var req submitOrderRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonError(w, "invalid request body", http.StatusBadRequest)
		return
	}
	if req.Symbol == "" || req.Quantity <= 0 {
		jsonError(w, "symbol and quantity are required", http.StatusBadRequest)
		return
	}
	if req.Type == types.Limit && req.Price <= 0 {
		jsonError(w, "price required for limit orders", http.StatusBadRequest)
		return
	}

	if err := s.Portfolio.ValidateOrder(userID, req.Symbol, req.Side, req.Quantity, req.Price, req.Type); err != nil {
		jsonError(w, err.Error(), http.StatusBadRequest)
		return
	}

	order := &types.Order{
		ID:        uuid.New().String(),
		UserID:    userID,
		Symbol:    req.Symbol,
		Side:      req.Side,
		Type:      req.Type,
		Price:     req.Price,
		StopPrice: req.StopPrice,
		Quantity:  req.Quantity,
		Status:    types.StatusOpen,
		CreatedAt: time.Now(),
	}

	if err := s.Engine.Submit(order); err != nil {
		jsonError(w, err.Error(), http.StatusBadRequest)
		return
	}

	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"order_id":   order.ID,
		"status":     order.Status,
		"created_at": order.CreatedAt,
	})
}

func (s *Server) CancelOrder(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r.Context())
	orderID := chi.URLParam(r, "id")
	symbol := r.URL.Query().Get("symbol")

	if symbol == "" {
		jsonError(w, "symbol query param required", http.StatusBadRequest)
		return
	}
	if err := s.Engine.Cancel(orderID, userID, symbol); err != nil {
		jsonError(w, err.Error(), http.StatusBadRequest)
		return
	}
	json.NewEncoder(w).Encode(map[string]string{"order_id": orderID, "status": "CANCELLED"})
}

func (s *Server) GetOpenOrders(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r.Context())
	symbol := r.URL.Query().Get("symbol")

	var orders []*types.Order
	for _, sym := range s.Engine.Symbols() {
		if symbol != "" && sym != symbol {
			continue
		}
		ob, _ := s.Engine.GetBook(sym)
		if ob == nil {
			continue
		}
		ob.ForEachOrder(func(o *types.Order) {
			if o.UserID == userID {
				orders = append(orders, o)
			}
		})
	}

	if orders == nil {
		orders = []*types.Order{}
	}
	json.NewEncoder(w).Encode(map[string]interface{}{"orders": orders})
}

// --- Market data handlers ---

func (s *Server) GetOrderBook(w http.ResponseWriter, r *http.Request) {
	symbol := chi.URLParam(r, "symbol")
	ob, err := s.Engine.GetBook(symbol)
	if err != nil {
		jsonError(w, "symbol not found", http.StatusNotFound)
		return
	}
	bids, asks := ob.Snapshot(20)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"symbol":    symbol,
		"timestamp": time.Now().UnixMilli(),
		"bids":      bids,
		"asks":      asks,
	})
}

func (s *Server) GetOHLCV(w http.ResponseWriter, r *http.Request) {
	symbol := chi.URLParam(r, "symbol")
	interval := ohlcv.Interval(r.URL.Query().Get("interval"))
	if interval == "" {
		interval = ohlcv.Interval1s
	}
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	candles := s.OHLCV.GetHistory(symbol, interval, limit)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"symbol":   symbol,
		"interval": interval,
		"candles":  candles,
	})
}

func (s *Server) GetRecentTrades(w http.ResponseWriter, r *http.Request) {
	symbol := chi.URLParam(r, "symbol")
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	trades := s.Trades.Get(symbol, limit)
	json.NewEncoder(w).Encode(map[string]interface{}{"trades": trades, "symbol": symbol})
}

func (s *Server) GetTicker(w http.ResponseWriter, r *http.Request) {
	symbol := chi.URLParam(r, "symbol")
	ticker := s.Ticker.Get(symbol)
	if ticker == nil {
		jsonError(w, "symbol not found", http.StatusNotFound)
		return
	}
	json.NewEncoder(w).Encode(ticker)
}

func (s *Server) GetSymbols(w http.ResponseWriter, r *http.Request) {
	// Build a lookup of metadata keyed by symbol ID
	metaMap := make(map[string]market.SymbolMeta, len(market.Symbols))
	for _, m := range market.Symbols {
		metaMap[m.Symbol] = m
	}

	syms := s.Engine.Symbols()
	result := make([]map[string]interface{}, 0, len(syms))
	for _, sym := range syms {
		entry := map[string]interface{}{"symbol": sym}
		if meta, ok := metaMap[sym]; ok {
			entry["label"]      = meta.Label
			entry["base_asset"] = meta.BaseAsset
			entry["category"]   = meta.Category
			entry["market_cap"] = meta.MarketCap
			entry["price_dp"]   = meta.PriceDp
			entry["qty_dp"]     = meta.QtyDp
		}
		if t := s.Ticker.Get(sym); t != nil {
			entry["last_price"]     = t.LastPrice
			entry["change_24h_pct"] = t.Change24hPct
			entry["volume_24h"]     = t.Volume24h
		}
		result = append(result, entry)
	}
	json.NewEncoder(w).Encode(map[string]interface{}{"symbols": result})
}

// --- Portfolio & leaderboard ---

func (s *Server) GetPortfolio(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r.Context())
	snap, err := s.Portfolio.Snapshot(userID)
	if err != nil {
		jsonError(w, "portfolio not found", http.StatusNotFound)
		return
	}
	json.NewEncoder(w).Encode(snap)
}

func (s *Server) GetLeaderboard(w http.ResponseWriter, r *http.Request) {
	usernames := map[string]string{}
	recs, _ := db.GetAllPortfolios()
	for _, rec := range recs {
		if u, err := db.GetUserByID(rec.UserID); err == nil {
			usernames[rec.UserID] = u.Username
		}
	}
	entries := s.Portfolio.Leaderboard(usernames)
	json.NewEncoder(w).Encode(map[string]interface{}{"leaderboard": entries})
}

func (s *Server) HealthCheck(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]string{"status": "ok", "service": "exchange-engine"})
}

// --- History endpoints (SQLite-backed) ---

// GetOHLCVHistory returns persisted candles beyond the in-memory ring buffer
func (s *Server) GetOHLCVHistory(w http.ResponseWriter, r *http.Request) {
	symbol := chi.URLParam(r, "symbol")
	interval := r.URL.Query().Get("interval")
	if interval == "" {
		interval = "1s"
	}
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit <= 0 || limit > 5000 {
		limit = 500
	}
	candles, err := db.GetCandles(symbol, interval, limit)
	if err != nil {
		jsonError(w, "failed to fetch candles", http.StatusInternalServerError)
		return
	}
	json.NewEncoder(w).Encode(map[string]interface{}{
		"symbol":   symbol,
		"interval": interval,
		"candles":  candles,
	})
}

// GetTradeHistory returns persisted trade history for a symbol
func (s *Server) GetTradeHistory(w http.ResponseWriter, r *http.Request) {
	symbol := chi.URLParam(r, "symbol")
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	trades, err := db.GetSymbolTrades(symbol, limit)
	if err != nil {
		jsonError(w, "failed to fetch trades", http.StatusInternalServerError)
		return
	}
	result := make([]map[string]interface{}, 0, len(trades))
	for _, t := range trades {
		result = append(result, map[string]interface{}{
			"id":             t.ID,
			"symbol":         t.Symbol,
			"buyer_id":       t.BuyerID,
			"seller_id":      t.SellerID,
			"price":          t.Price,
			"quantity":       t.Quantity,
			"aggressor_side": t.AggressorSide,
			"timestamp":      t.Timestamp.UnixMilli(),
		})
	}
	json.NewEncoder(w).Encode(map[string]interface{}{"trades": result, "symbol": symbol})
}

// GetMyTradeHistory returns the authenticated user's full trade history (as buyer or seller)
func (s *Server) GetMyTradeHistory(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r.Context())
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit <= 0 || limit > 1000 {
		limit = 200
	}
	trades, err := db.GetUserTrades(userID, limit)
	if err != nil {
		jsonError(w, "failed to fetch trade history", http.StatusInternalServerError)
		return
	}
	result := make([]map[string]interface{}, 0, len(trades))
	for _, t := range trades {
		side := "BUY"
		if t.SellerID == userID {
			side = "SELL"
		}
		result = append(result, map[string]interface{}{
			"id":             t.ID,
			"symbol":         t.Symbol,
			"side":           side,
			"price":          t.Price,
			"quantity":       t.Quantity,
			"aggressor_side": t.AggressorSide,
			"buyer_id":       t.BuyerID,
			"seller_id":      t.SellerID,
			"timestamp":      t.Timestamp.UnixMilli(),
		})
	}
	json.NewEncoder(w).Encode(map[string]interface{}{"trades": result})
}

// GetPnLHistory returns the portfolio equity curve for the authenticated user
func (s *Server) GetPnLHistory(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r.Context())
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit <= 0 || limit > 5000 {
		limit = 1000
	}
	snapshots, err := db.GetPnLHistory(userID, limit)
	if err != nil {
		jsonError(w, "failed to fetch P&L history", http.StatusInternalServerError)
		return
	}
	result := make([]map[string]interface{}, 0, len(snapshots))
	for _, s := range snapshots {
		result = append(result, map[string]interface{}{
			"total_value":    s.TotalValue,
			"cash":           s.Cash,
			"realized_pnl":   s.RealizedPnL,
			"unrealized_pnl": s.UnrealizedPnL,
			"timestamp":      s.Timestamp.UnixMilli(),
		})
	}
	json.NewEncoder(w).Encode(map[string]interface{}{"history": result})
}

// --- Notes handlers ---

type createNoteRequest struct {
	Content string `json:"content"`
}

func (s *Server) CreateNote(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r.Context())

	var req createNoteRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonError(w, "invalid request body", http.StatusBadRequest)
		return
	}

	if req.Content == "" {
		jsonError(w, "content required", http.StatusBadRequest)
		return
	}

	note, err := db.InsertNote(userID, req.Content)
	if err != nil {
		jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"id":         note.ID,
		"content":    note.Content,
		"created_at": note.CreatedAt.UnixMilli(), // canonical DB timestamp
	})
}

func (s *Server) GetNotes(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r.Context())
	query := r.URL.Query()

	fromStr := query.Get("from")
	toStr   := query.Get("to")

	var fromPtr, toPtr *time.Time
	
	if fromStr != "" {
	    ms, _ := strconv.ParseInt(fromStr, 10, 64)
	    t := time.UnixMilli(ms)
	    fromPtr = &t
	}
	
	if toStr != "" {
	    ms, _ := strconv.ParseInt(toStr, 10, 64)
	    t := time.UnixMilli(ms)
	    toPtr = &t
	}

	notes, err := db.GetNotesByUserRange(userID, fromPtr, toPtr)
	if err != nil {
		jsonError(w, "failed to fetch notes", http.StatusInternalServerError)
		return
	}

	result := make([]map[string]interface{}, 0, len(notes))

	for _, n := range notes {
		result = append(result, map[string]interface{}{
			"id":         n.ID,
			"content":    n.Content,
			"created_at": n.CreatedAt.UnixMilli(),
		})
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"notes": result,
	})
}

type updateNoteRequest struct {
	Content string `json:"content"`
}

func (s *Server) UpdateNote(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r.Context())
	noteID := chi.URLParam(r, "id")

	var req updateNoteRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonError(w, "invalid request body", http.StatusBadRequest)
		return
	}

	if req.Content == "" {
		jsonError(w, "content required", http.StatusBadRequest)
		return
	}

	if err := db.UpdateNote(noteID, userID, req.Content); err != nil {
		if err == sql.ErrNoRows {
			jsonError(w, "note not found", http.StatusNotFound)
		} else {
			jsonError(w, "failed to update note", http.StatusInternalServerError)
		}
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"id":        noteID,
		"content":   req.Content,
		// "updated_at": time.Now().UnixMilli(),
	})
}

func (s *Server) DeleteNote(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r.Context())

	noteID := chi.URLParam(r, "id")

	if err := db.DeleteNote(noteID, userID); err != nil {
		if err == sql.ErrNoRows {
			jsonError(w, "note not found", http.StatusNotFound)
		} else {
			jsonError(w, "failed to delete note", http.StatusInternalServerError)
		}
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"id":     noteID,
		"status": "deleted",
	})
}

// jsonError writes a JSON error response
func jsonError(w http.ResponseWriter, msg string, code int) {
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}
