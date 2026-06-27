package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	chimiddleware "github.com/go-chi/chi/v5/middleware"

	"github.com/opensoft/exchange-engine/internal/api"
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

const snapshotInterval = 60 * time.Second

func main() {
	log.SetFlags(log.Ltime | log.Lshortfile)
	log.Println("=== Synthetic-Bull Exchange Engine starting ===")

	// --- Initialise subsystems ---
	db.Init()
	auth.Init()

	eng := engine.NewEngine()
	portfolioMgr := portfolio.NewManager()
	ohlcvAgg := ohlcv.New()
	hub := broadcast.NewHub()
	tradeStore := store.NewTradeStore(500)
	tickerStore := store.NewTickerStore()

	// --- Register symbols ---
	symbols := market.DefaultSymbols()
	for _, sym := range symbols {
		eng.RegisterSymbol(sym.Symbol)
		tickerStore.Init(sym.Symbol, sym.S0)
		log.Printf("[engine] registered symbol %s @ %.2f", sym.Symbol, sym.S0)
	}

	// --- OHLCV close callback: broadcast + persist closed candles ---
	ohlcvAgg.OnClose = func(symbol string, interval ohlcv.Interval, candle ohlcv.Candle) {
		hub.BroadcastSymbol(symbol, broadcast.OHLCVMsg{
			Type:     broadcast.TypeOHLCV,
			Symbol:   symbol,
			Interval: string(interval),
			Candle:   candle,
			IsClosed: true,
		})
		_ = db.InsertCandle(db.OHLCVRecord{
			Symbol:   symbol,
			Interval: string(interval),
			Time:     candle.Time,
			Open:     candle.Open,
			High:     candle.High,
			Low:      candle.Low,
			Close:    candle.Close,
			Volume:   candle.Volume,
		})
	}

	// --- Restore open orders from DB into LOB ---
	restoreOpenOrders(eng)

	// --- Event dispatcher ---
	go runEventDispatcher(eng, portfolioMgr, ohlcvAgg, hub, tradeStore, tickerStore)

	// --- GBM market generators ---
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// --- Periodic portfolio snapshots (every 60s for all loaded users) ---
	go runPeriodicSnapshots(ctx, portfolioMgr)
	for _, sym := range symbols {
		gen := market.NewGenerator(sym, eng)
		go gen.Run(ctx)
	}

	// --- HTTP server ---
	srv := &api.Server{
		Engine:    eng,
		Portfolio: portfolioMgr,
		OHLCV:     ohlcvAgg,
		Hub:       hub,
		Trades:    tradeStore,
		Ticker:    tickerStore,
	}

	r := chi.NewRouter()
	r.Use(chimiddleware.Recoverer)
	r.Use(api.LoggingMiddleware)
	r.Use(api.CORSMiddleware)
	r.Use(api.JSONMiddleware)

	// Public
	r.Get("/health", srv.HealthCheck)
	r.Post("/api/auth/register", auth.RegisterHandler)
	r.Post("/api/auth/login", auth.LoginHandler)
	r.Get("/api/symbols", srv.GetSymbols)
	r.Get("/api/orderbook/{symbol}", srv.GetOrderBook)
	r.Get("/api/trades/{symbol}", srv.GetRecentTrades)
	r.Get("/api/ticker/{symbol}", srv.GetTicker)
	r.Get("/api/ohlcv/{symbol}", srv.GetOHLCV)

	// Public history endpoints
	r.Get("/api/history/ohlcv/{symbol}", srv.GetOHLCVHistory)
	r.Get("/api/history/trades/{symbol}", srv.GetTradeHistory)

	// Protected (JWT required)
	r.Group(func(r chi.Router) {
		r.Use(auth.Middleware)
		r.Post("/api/orders", srv.SubmitOrder)
		r.Delete("/api/orders/{id}", srv.CancelOrder)
		r.Get("/api/orders", srv.GetOpenOrders)
		r.Get("/api/portfolio", srv.GetPortfolio)
		r.Get("/api/leaderboard", srv.GetLeaderboard)
		r.Get("/api/history/pnl", srv.GetPnLHistory)
		r.Get("/api/history/my-trades", srv.GetMyTradeHistory)
		
		r.Post("/api/notes", srv.CreateNote)
		r.Get("/api/notes", srv.GetNotes)
		r.Put("/api/notes/{id}", srv.UpdateNote)
		r.Delete("/api/notes/{id}", srv.DeleteNote)
	})

	// Admin panel HTML
	r.Get("/admin", srv.ServeAdminHTML)

	// Admin (ADMIN_SECRET query param or X-Admin-Secret header)
	r.Get("/api/admin/overview", srv.AdminOverview)
	r.Post("/api/admin/seed-user", srv.AdminSeedUser)
	r.Post("/api/admin/reset-user", srv.AdminResetUser)

	// WebSocket (JWT via ?token= query param)
	r.With(auth.OptionalMiddleware).Get("/ws", srv.WSHandler)

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	httpServer := &http.Server{
		Addr:         ":" + port,
		Handler:      r,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
	}

	go func() {
		log.Printf("[server] listening on :%s", port)
		if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("[server] failed: %v", err)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	log.Println("[server] shutting down...")
	cancel()
	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer shutdownCancel()
	httpServer.Shutdown(shutdownCtx)
	log.Println("[server] stopped")
}

// runEventDispatcher fans out engine events to all subsystems
func runEventDispatcher(
	eng *engine.Engine,
	portfolioMgr *portfolio.Manager,
	ohlcvAgg *ohlcv.Aggregator,
	hub *broadcast.Hub,
	tradeStore *store.TradeStore,
	tickerStore *store.TickerStore,
) {
	for event := range eng.Events() {
		switch event.Type {

		case engine.EventTrade:
			trade, ok := event.Payload.(*types.Trade)
			if !ok {
				continue
			}
			portfolioMgr.ApplyTrade(trade)
			portfolioMgr.UpdatePrice(trade.Symbol, trade.Price)
			ohlcvAgg.AddTrade(trade.Symbol, trade.Price, trade.Quantity, trade.Timestamp)
			tradeStore.Add(trade)
			tickerStore.OnTrade(trade)
			eng.CheckStopOrders(trade.Symbol, trade.Price)

			// Persist human trades to SQLite
			if db.IsHumanTrade(trade.BuyerID, trade.SellerID) {
				_ = db.InsertTrade(db.TradeRecord{
					ID:            trade.ID,
					Symbol:        trade.Symbol,
					BuyerID:       trade.BuyerID,
					SellerID:      trade.SellerID,
					Price:         trade.Price,
					Quantity:      trade.Quantity,
					AggressorSide: string(trade.AggressorSide),
					Timestamp:     trade.Timestamp,
				})
			}

			// Sync open order DB state — handle partial fills correctly.
			// EventTrade fires exactly once per match, so we do this here (not in EventOrderFill).
			syncOrderInDB(eng, trade.Symbol, trade.BuyOrderID)
			syncOrderInDB(eng, trade.Symbol, trade.SellOrderID)

			hub.BroadcastSymbol(trade.Symbol, broadcast.TradeMsg{
				Type:          broadcast.TypeTrade,
				Symbol:        trade.Symbol,
				TradeID:       trade.ID,
				Price:         trade.Price,
				Quantity:      trade.Quantity,
				AggressorSide: string(trade.AggressorSide),
				Timestamp:     trade.Timestamp.UnixMilli(),
			})

			if cur := ohlcvAgg.GetCurrentCandle(trade.Symbol, ohlcv.Interval1s); cur != nil {
				hub.BroadcastSymbol(trade.Symbol, broadcast.OHLCVMsg{
					Type:     broadcast.TypeOHLCV,
					Symbol:   trade.Symbol,
					Interval: string(ohlcv.Interval1s),
					Candle:   *cur,
					IsClosed: false,
				})
			}
			if t := tickerStore.Get(trade.Symbol); t != nil {
				hub.BroadcastSymbol(trade.Symbol, t)
			}

		case engine.EventOrderFill:
			trade, ok := event.Payload.(*types.Trade)
			if !ok {
				continue
			}
			for _, uid := range []string{trade.BuyerID, trade.SellerID} {
				snap, err := portfolioMgr.Snapshot(uid)
				if err != nil {
					continue
				}
				hub.SendToUser(uid, map[string]interface{}{
					"type": broadcast.TypePortfolio,
					"data": snap,
				})
				// Persist portfolio snapshot on every fill for equity curve
				_ = db.InsertSnapshot(db.SnapshotRecord{
					UserID:        uid,
					TotalValue:    snap.TotalValue,
					Cash:          snap.Cash,
					RealizedPnL:   snap.RealizedPnL,
					UnrealizedPnL: totalUnrealized(snap),
					Timestamp:     time.Now(),
				})
			}
			case engine.EventOrderBook:
			ob, ok := event.Payload.(*engine.OrderBook)
			if !ok {
				continue
			}
			bids, asks := ob.Snapshot(20)
			bestBid, bestAsk := 0.0, 0.0
			if len(bids) > 0 {
				bestBid = bids[0].Price
			}
			if len(asks) > 0 {
				bestAsk = asks[0].Price
			}
			tickerStore.OnBookUpdate(ob.Symbol, bestBid, bestAsk)
			hub.BroadcastSymbol(ob.Symbol, broadcast.OrderBookMsg{
				Type:      broadcast.TypeOrderBook,
				Symbol:    ob.Symbol,
				Timestamp: time.Now().UnixMilli(),
				Bids:      toDepthEntries(bids),
				Asks:      toDepthEntries(asks),
			})

		case engine.EventOrderAck:
			order, ok := event.Payload.(*types.Order)
			if !ok {
				continue
			}
			// Persist human open orders so they survive restarts
			if order.UserID != "market_system" {
				_ = db.UpsertOpenOrder(db.OpenOrderRecord{
					ID:        order.ID,
					UserID:    order.UserID,
					Symbol:    order.Symbol,
					Side:      string(order.Side),
					Type:      string(order.Type),
					Price:     order.Price,
					StopPrice: order.StopPrice,
					Quantity:  order.Quantity,
					Filled:    order.Filled,
					Status:    string(order.Status),
					CreatedAt: order.CreatedAt,
				})
			}
			hub.SendToUser(order.UserID, map[string]interface{}{
				"type":    broadcast.TypeOrderAck,
				"payload": order,
			})

		case engine.EventOrderCancel:
			order, ok := event.Payload.(*types.Order)
			if !ok {
				continue
			}
			_ = db.DeleteOpenOrder(order.ID)
			hub.SendToUser(order.UserID, map[string]interface{}{
				"type":    broadcast.TypeOrderCancel,
				"payload": order,
			})
		}
	}
}

// restoreOpenOrders loads persisted orders from DB back into the LOB on startup
func restoreOpenOrders(eng *engine.Engine) {
	records, err := db.GetAllOpenOrders()
	if err != nil {
		log.Printf("[recovery] failed to load open orders: %v", err)
		return
	}
	count := 0
	for _, r := range records {
		order := &engine.Order{
			ID:        r.ID,
			UserID:    r.UserID,
			Symbol:    r.Symbol,
			Side:      engine.Side(r.Side),
			Type:      engine.OrderType(r.Type),
			Price:     r.Price,
			StopPrice: r.StopPrice,
			Quantity:  r.Quantity,
			Filled:    r.Filled,
			Status:    engine.OrderStatus(r.Status),
			CreatedAt: r.CreatedAt,
		}
		eng.RestoreOrder(order)
		count++
	}
	log.Printf("[recovery] restored %d open orders into LOB", count)
}

// runPeriodicSnapshots captures portfolio equity curve for all known human users every 60s
func runPeriodicSnapshots(ctx context.Context, portfolioMgr *portfolio.Manager) {
	ticker := time.NewTicker(snapshotInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			recs, err := db.GetAllPortfolios()
			if err != nil {
				continue
			}
			for _, rec := range recs {
				if rec.UserID == "market_system" {
					continue
				}
				snap, err := portfolioMgr.Snapshot(rec.UserID)
				if err != nil {
					continue
				}
				_ = db.InsertSnapshot(db.SnapshotRecord{
					UserID:        rec.UserID,
					TotalValue:    snap.TotalValue,
					Cash:          snap.Cash,
					RealizedPnL:   snap.RealizedPnL,
					UnrealizedPnL: totalUnrealized(snap),
					Timestamp:     time.Now(),
				})
			}
		}
	}
}

// syncOrderInDB updates or removes an order record after a fill.
// If the order is still in the LOB (partial fill) → update filled qty.
// If it's gone (fully filled / market order) → delete.
func syncOrderInDB(eng *engine.Engine, symbol, orderID string) {
	if orderID == "" {
		return
	}
	if order, ok := eng.GetOrder(symbol, orderID); ok {
		// Still resting — partial fill: update the filled qty and status
		_ = db.UpdateOpenOrderFill(orderID, order.Filled, string(order.Status))
	} else {
		// No longer in LOB — fully consumed
		_ = db.DeleteOpenOrder(orderID)
	}
}

// totalUnrealized sums unrealized P&L across all positions in a snapshot
func totalUnrealized(snap *portfolio.Snapshot) float64 {
	total := 0.0
	for _, pos := range snap.Positions {
		total += pos.UnrealizedPnL
	}
	return total
}

func toDepthEntries(entries []types.DepthEntry) []broadcast.DepthEntry {
	result := make([]broadcast.DepthEntry, len(entries))
	for i, e := range entries {
		result[i] = broadcast.DepthEntry{Price: e.Price, Quantity: e.Quantity}
	}
	return result
}
