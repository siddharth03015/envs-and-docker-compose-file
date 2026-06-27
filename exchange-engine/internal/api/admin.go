package api

import (
	_ "embed"
	"encoding/json"
	"math"
	"math/rand"
	"net/http"
	"os"
	"time"

	"github.com/google/uuid"
	"github.com/opensoft/exchange-engine/internal/auth"
	"github.com/opensoft/exchange-engine/internal/db"
	"golang.org/x/crypto/bcrypt"
)

//go:embed admin.html
var adminHTML []byte

// ServeAdminHTML serves the embedded admin panel at GET /admin
func (s *Server) ServeAdminHTML(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Write(adminHTML)
}

// ── Secret check helper ───────────────────────────────────────────────────────

func adminSecret() string {
	if s := os.Getenv("ADMIN_SECRET"); s != "" {
		return s
	}
	return "admin"
}

func checkAdminSecret(r *http.Request) bool {
	given := r.URL.Query().Get("secret")
	if given == "" {
		given = r.Header.Get("X-Admin-Secret")
	}
	return given == adminSecret()
}

// ── GET /api/admin/overview ───────────────────────────────────────────────────
// Returns a full snapshot: users, exchange stats, recent trades, symbol prices.

func (s *Server) AdminOverview(w http.ResponseWriter, r *http.Request) {
	if !checkAdminSecret(r) {
		jsonError(w, "invalid admin secret", http.StatusUnauthorized)
		return
	}

	out := map[string]any{}

	// ── Exchange stats ────────────────────────────────────────────────────────
	var totalUsers, totalTrades, totalNotes, totalSnapshots int
	db.DB.QueryRow("SELECT COUNT(*) FROM users").Scan(&totalUsers)
	db.DB.QueryRow("SELECT COUNT(*) FROM trade_history").Scan(&totalTrades)
	db.DB.QueryRow("SELECT COUNT(*) FROM notes").Scan(&totalNotes)
	db.DB.QueryRow("SELECT COUNT(*) FROM portfolio_snapshots").Scan(&totalSnapshots)

	out["stats"] = map[string]any{
		"total_users":     totalUsers,
		"total_trades":    totalTrades,
		"total_notes":     totalNotes,
		"total_snapshots": totalSnapshots,
	}

	// ── All users with portfolio data ─────────────────────────────────────────
	rows, err := db.DB.Query(`
		SELECT u.id, u.username, u.created_at,
		       COALESCE(p.cash, 100000),
		       COALESCE(p.realized_pnl, 0),
		       COALESCE(p.positions, '{}')
		FROM users u
		LEFT JOIN portfolios p ON u.id = p.user_id
		ORDER BY u.created_at DESC
	`)
	var users []map[string]any
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var id, username, createdAt, positionsJSON string
			var cash, realizedPnL float64
			rows.Scan(&id, &username, &createdAt, &cash, &realizedPnL, &positionsJSON)
			users = append(users, map[string]any{
				"id":           id,
				"username":     username,
				"created_at":   createdAt,
				"cash":         cash,
				"realized_pnl": realizedPnL,
				"positions":    positionsJSON,
			})
		}
	}
	out["users"] = users

	// ── Recent trades (last 40) ───────────────────────────────────────────────
	trows, err := db.DB.Query(`
		SELECT th.id, th.symbol, th.price, th.quantity, th.aggressor_side, th.timestamp,
		       COALESCE(ub.username, th.buyer_id)  AS buyer,
		       COALESCE(us.username, th.seller_id) AS seller
		FROM trade_history th
		LEFT JOIN users ub ON th.buyer_id  = ub.id
		LEFT JOIN users us ON th.seller_id = us.id
		ORDER BY th.timestamp DESC
		LIMIT 40
	`)
	var trades []map[string]any
	if err == nil {
		defer trows.Close()
		for trows.Next() {
			var id, symbol, side, ts, buyer, seller string
			var price, qty float64
			trows.Scan(&id, &symbol, &price, &qty, &side, &ts, &buyer, &seller)
			trades = append(trades, map[string]any{
				"id": id, "symbol": symbol, "price": price,
				"quantity": qty, "side": side, "timestamp": ts,
				"buyer": buyer, "seller": seller,
			})
		}
	}
	out["recent_trades"] = trades

	// ── Live symbol prices from ticker store ──────────────────────────────────
	symbols := []string{"BTC-USD", "ETH-USD", "SOL-USD"}
	prices := map[string]any{}
	for _, sym := range symbols {
		t := s.Ticker.Get(sym)
		if t != nil {
			prices[sym] = map[string]any{
				"last_price":     t.LastPrice,
				"change_24h_pct": t.Change24hPct,
				"volume_24h":     t.Volume24h,
			}
		}
	}
	out["prices"] = prices

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(out)
}

// ── POST /api/admin/seed-user ─────────────────────────────────────────────────
// Body: { "username": "demo", "password": "demo" }
// Creates the user if not exists and injects 30 days of fake history.

func (s *Server) AdminSeedUser(w http.ResponseWriter, r *http.Request) {
	if !checkAdminSecret(r) {
		jsonError(w, "invalid admin secret", http.StatusUnauthorized)
		return
	}

	var req struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Username == "" || req.Password == "" {
		jsonError(w, "username and password required", http.StatusBadRequest)
		return
	}

	// Upsert user ─────────────────────────────────────────────────────────────
	var userID string
	err := db.DB.QueryRow("SELECT id FROM users WHERE username = ?", req.Username).Scan(&userID)
	if err != nil {
		// Create new user
		userID = uuid.New().String()
		hash, _ := bcrypt.GenerateFromPassword([]byte(req.Password), 12)
		if _, err := db.DB.Exec(
			"INSERT INTO users (id, username, password) VALUES (?, ?, ?)",
			userID, req.Username, string(hash),
		); err != nil {
			jsonError(w, "create user failed: "+err.Error(), http.StatusInternalServerError)
			return
		}
		db.DB.Exec(
			"INSERT OR IGNORE INTO portfolios (user_id, cash, positions, realized_pnl) VALUES (?, 100000, '{}', 0)",
			userID,
		)
	}

	// Wipe any existing seeded data for a clean re-seed ───────────────────────
	db.DB.Exec("DELETE FROM portfolio_snapshots WHERE user_id = ?", userID)
	db.DB.Exec("DELETE FROM notes WHERE user_id = ?", userID)
	db.DB.Exec("DELETE FROM trade_history WHERE buyer_id = ? OR seller_id = ?", userID, userID)

	// Seed portfolio snapshots (30 days × 6/day = 180 rows) ──────────────────
	if err := seedPortfolioSnapshots(userID); err != nil {
		jsonError(w, "snapshot seed failed: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Seed trade history (realistic mix of buys/sells across 30 days) ─────────
	seedTradeHistory(userID)

	// Seed notes ──────────────────────────────────────────────────────────────
	seedNotes(userID)

	// Issue a token so the HTML can auto-login the seeded account ─────────────
	token, err := auth.IssueToken(userID, req.Username)
	if err != nil {
		jsonError(w, "token issue failed: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"ok":       true,
		"user_id":  userID,
		"username": req.Username,
		"token":    token,
		"message":  "User seeded: 30d snapshots + 60 trades + 15 notes",
	})
}

// ── POST /api/admin/reset-user ────────────────────────────────────────────────
// Body: { "username": "alice" }
// Resets portfolio to $100k, clears positions and history.

func (s *Server) AdminResetUser(w http.ResponseWriter, r *http.Request) {
	if !checkAdminSecret(r) {
		jsonError(w, "invalid admin secret", http.StatusUnauthorized)
		return
	}

	var req struct{ Username string `json:"username"` }
	json.NewDecoder(r.Body).Decode(&req)
	if req.Username == "" {
		jsonError(w, "username required", http.StatusBadRequest)
		return
	}

	var userID string
	if err := db.DB.QueryRow("SELECT id FROM users WHERE username = ?", req.Username).Scan(&userID); err != nil {
		jsonError(w, "user not found", http.StatusNotFound)
		return
	}

	db.DB.Exec("UPDATE portfolios SET cash=100000, positions='{}', realized_pnl=0 WHERE user_id=?", userID)
	db.DB.Exec("DELETE FROM portfolio_snapshots WHERE user_id=?", userID)
	db.DB.Exec("DELETE FROM open_orders WHERE user_id=?", userID)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{"ok": true, "message": "Portfolio reset to $100,000"})
}

// ── Seed helpers ──────────────────────────────────────────────────────────────

var dailyReturns = []float64{
	// Week 1 — cautious start
	+0.008, -0.005, +0.012, +0.003, -0.009, +0.007, +0.004,
	// Week 2 — strong run
	+0.024, +0.031, -0.012, +0.028, +0.019, -0.007, +0.033,
	// Week 3 — pullback then recovery
	-0.018, -0.011, +0.009, -0.022, +0.016, +0.025, +0.013,
	// Week 4 — solid gains
	+0.029, -0.008, +0.021, +0.038, +0.014, -0.006, +0.022,
	// Final 3 days
	+0.017, +0.031, +0.019,
}

func seedPortfolioSnapshots(userID string) error {
	rng := rand.New(rand.NewSource(42))

	now := time.Now().UTC()
	start := now.AddDate(0, 0, -30).Truncate(24 * time.Hour).Add(9 * time.Hour)

	const snapsPerDay = 6
	const totalDays = 30

	value := 100_000.0
	stmt, err := db.DB.Prepare(
		`INSERT INTO portfolio_snapshots (user_id, total_value, cash, realized_pnl, unrealized_pnl, timestamp)
		 VALUES (?, ?, ?, ?, ?, ?)`,
	)
	if err != nil {
		return err
	}
	defer stmt.Close()

	snapIdx := 0
	for day := 0; day < totalDays; day++ {
		dayRet := dailyReturns[min(day, len(dailyReturns)-1)]
		for s := 0; s < snapsPerDay; s++ {
			intra := rng.NormFloat64() * 0.0018
			stepRet := (dayRet / float64(snapsPerDay)) + intra
			value = math.Max(50_000, value*(1+stepRet))

			realized := (value - 100_000) * 0.65
			unrealized := (value - 100_000) * 0.35
			cash := math.Max(8_000, value*(0.25+rng.Float64()*0.15))

			ts := start.Add(time.Duration(day)*24*time.Hour + time.Duration(s)*4*time.Hour)
			tsStr := ts.Format("2006-01-02 15:04:05")

			if _, err := stmt.Exec(userID, round2(value), round2(cash), round2(realized), round2(unrealized), tsStr); err != nil {
				return err
			}
			snapIdx++
		}
	}
	return nil
}

var seedNoteContents = []struct {
	content    string
	dayOffset  int
	hourOffset int
}{
	{"Watching BTC/USD. If price breaks above the 200-day MA I'll add to the long.", 2, 9},
	{"Bought ETH at market. Momentum looks strong — volume confirming the move.", 3, 14},
	{"Taking partial profits on BTC. Strong resistance at this level.", 5, 10},
	{"SOL showing bullish MACD divergence on 5m chart. Small position entered.", 7, 11},
	{"High volatility today — reduced position sizes across all assets.", 9, 9},
	{"BTC/USD looks bearish short-term. EMA50 acting as resistance.", 10, 15},
	{"Great ETH scalp — momentum strategy returned +2.1% in 90 minutes.", 12, 11},
	{"Mean-reversion trade on SOL paid off nicely. +3.2% in under 2 hours.", 14, 10},
	{"Got stopped out too early on BTC. Need to widen stops on trend-following setups.", 16, 14},
	{"ETH MACD crossover signal fired on 1h chart. Holding for 3% target.", 19, 10},
	{"Portfolio up ~8% from starting capital. Risk management holding up well.", 21, 16},
	{"Added to BTC position on the dip. Conviction still high on the trend.", 23, 9},
	{"Closed all SOL before the weekend. Prefer not to hold over the break.", 25, 15},
	{"RSI on ETH hit oversold on the daily chart. Looking for a bounce.", 27, 10},
	{"Strong finish to the month. Market-maker strategy generating steady spread income.", 29, 16},
}

func seedNotes(userID string) {
	now := time.Now().UTC()
	start := now.AddDate(0, 0, -30)

	for _, n := range seedNoteContents {
		ts := start.AddDate(0, 0, n.dayOffset).
			Truncate(24*time.Hour).
			Add(time.Duration(n.hourOffset) * time.Hour)
		tsMs := ts.UnixMilli()
		id := uuid.New().String()
		db.DB.Exec(
			"INSERT INTO notes (id, user_id, content, created_at) VALUES (?, ?, ?, ?)",
			id, userID, n.content, tsMs,
		)
	}
}

// seedTradeHistory inserts ~60 realistic trades spread across 30 days.
// Each trade is recorded as the user trading against "market_system".
// Prices drift realistically using the same daily-return schedule.
func seedTradeHistory(userID string) {
	rng := rand.New(rand.NewSource(77))
	now := time.Now().UTC()
	start := now.AddDate(0, 0, -30).Truncate(24 * time.Hour).Add(9 * time.Hour)

	type symConfig struct {
		symbol   string
		basePrice float64
		qtyScale  float64 // typical order qty
	}
	symbols := []symConfig{
		{"BTC-USD", 45000.0, 0.005},
		{"ETH-USD", 2500.0, 0.06},
		{"SOL-USD", 150.0, 0.5},
		{"BNB-USD", 400.0, 0.15},
	}

	// Planned trade schedule: (dayOffset, symbol index, side, qty multiplier)
	type tradePlan struct {
		day   int
		symIdx int
		side  string
		qtyMul float64
	}
	plans := []tradePlan{
		// Day 1 — opener
		{1, 0, "BUY", 1.0},
		{1, 1, "BUY", 1.2},
		// Day 2
		{2, 2, "BUY", 0.8},
		{2, 0, "SELL", 1.0}, // close BTC — small win
		// Day 3
		{3, 1, "SELL", 1.2}, // close ETH — small win
		{3, 3, "BUY", 1.0},
		// Day 4
		{4, 0, "BUY", 1.5},
		{4, 2, "SELL", 0.8},  // close SOL
		// Day 5
		{5, 1, "BUY", 1.0},
		{5, 0, "SELL", 1.5},  // close BTC — profit
		// Day 6 — loss day
		{6, 2, "BUY", 1.2},
		{6, 3, "SELL", 1.0},  // close BNB — loss
		// Day 7
		{7, 0, "BUY", 1.0},
		{7, 1, "SELL", 1.0},  // close ETH — breakeven
		// Day 8 — big run
		{8, 0, "BUY", 2.0},
		{8, 1, "BUY", 1.5},
		// Day 9
		{9, 2, "BUY", 2.0},
		{9, 0, "SELL", 2.0},  // close BTC — profit
		// Day 10
		{10, 1, "SELL", 1.5}, // close ETH — loss (reverse day)
		{10, 3, "BUY", 1.2},
		// Day 11
		{11, 2, "SELL", 2.0}, // close SOL — profit
		{11, 0, "BUY", 1.0},
		// Day 12 — scalp
		{12, 1, "BUY", 0.5},
		{12, 1, "SELL", 0.5}, // quick flip
		{12, 0, "SELL", 1.0},
		// Day 13
		{13, 3, "SELL", 1.2},
		{13, 2, "BUY", 1.5},
		// Day 14
		{14, 0, "BUY", 1.8},
		{14, 2, "SELL", 1.5}, // close SOL — profit
		// Day 15 — pullback
		{15, 1, "BUY", 1.0},
		{15, 0, "SELL", 1.8}, // close BTC — small loss
		// Day 16
		{16, 3, "BUY", 1.0},
		{16, 1, "SELL", 1.0}, // close ETH — small loss
		// Day 17
		{17, 2, "BUY", 1.0},
		{17, 3, "SELL", 1.0},
		// Day 18
		{18, 0, "BUY", 1.5},
		{18, 1, "BUY", 1.0},
		// Day 19
		{19, 2, "SELL", 1.0},
		{19, 0, "SELL", 1.5}, // close BTC — profit
		// Day 20
		{20, 3, "BUY", 1.5},
		{20, 1, "SELL", 1.0},
		// Day 21 — strong
		{21, 0, "BUY", 2.0},
		{21, 2, "BUY", 2.0},
		// Day 22
		{22, 1, "BUY", 1.2},
		{22, 0, "SELL", 2.0}, // close BTC — profit
		// Day 23
		{23, 3, "SELL", 1.5},
		{23, 2, "SELL", 2.0}, // close SOL — profit
		// Day 24
		{24, 0, "BUY", 1.8},
		{24, 1, "SELL", 1.2},
		// Day 25
		{25, 2, "BUY", 1.0},
		{25, 0, "SELL", 1.8},
		// Day 26 — hold day, one small trade
		{26, 3, "BUY", 0.8},
		// Day 27
		{27, 1, "BUY", 1.5},
		{27, 2, "SELL", 1.0},
		// Day 28
		{28, 0, "BUY", 2.5},
		{28, 3, "SELL", 0.8},
		// Day 29
		{29, 1, "SELL", 1.5},
		{29, 0, "SELL", 2.5}, // close BTC — big profit
		// Day 30 — final
		{30, 2, "BUY", 1.5},
		{30, 1, "BUY", 1.0},
	}

	// Build a cumulative price path for each symbol using dailyReturns
	symPrices := make([]float64, len(symbols))
	for i, s := range symbols {
		symPrices[i] = s.basePrice
	}
	// Pre-compute end-of-day prices for all 31 days
	dayPrices := make([][]float64, 31) // dayPrices[day][symIdx]
	dayPrices[0] = make([]float64, len(symbols))
	copy(dayPrices[0], symPrices)
	for day := 1; day <= 30; day++ {
		ret := dailyReturns[min(day-1, len(dailyReturns)-1)]
		dayPrices[day] = make([]float64, len(symbols))
		for i := range symbols {
			// Each symbol drifts slightly differently
			noise := rng.NormFloat64() * 0.004
			dayPrices[day][i] = dayPrices[day-1][i] * (1 + ret + noise)
		}
	}

	stmt, err := db.DB.Prepare(
		`INSERT OR IGNORE INTO trade_history
		 (id, symbol, buyer_id, seller_id, price, quantity, aggressor_side, timestamp)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
	)
	if err != nil {
		return
	}
	defer stmt.Close()

	for _, p := range plans {
		if p.day > 30 {
			continue
		}
		sc := symbols[p.symIdx]
		price := round2(dayPrices[p.day][p.symIdx] * (1 + rng.NormFloat64()*0.0008))
		qty := round2(sc.qtyScale * p.qtyMul * (0.9 + rng.Float64()*0.2))
		if qty <= 0 {
			qty = sc.qtyScale
		}

		// Spread intraday — random hour between 9am and 5pm
		hour := 9 + rng.Intn(8)
		min_ := rng.Intn(60)
		ts := start.Add(time.Duration(p.day)*24*time.Hour +
			time.Duration(hour)*time.Hour +
			time.Duration(min_)*time.Minute)
		tsStr := ts.Format("2006-01-02 15:04:05")

		var buyerID, sellerID, side string
		if p.side == "BUY" {
			buyerID, sellerID, side = userID, "market_system", "BUY"
		} else {
			buyerID, sellerID, side = "market_system", userID, "SELL"
		}

		stmt.Exec(uuid.New().String(), sc.symbol, buyerID, sellerID,
			price, qty, side, tsStr)
	}
}

func round2(v float64) float64 {
	return math.Round(v*100) / 100
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
