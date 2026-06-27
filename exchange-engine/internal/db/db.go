package db

import (
	"database/sql"
	"log"
	"os"

	_ "modernc.org/sqlite"
)

var DB *sql.DB

func Init() {
	path := os.Getenv("DB_PATH")
	if path == "" {
		path = "./exchange.db"
	}

	var err error
	DB, err = sql.Open("sqlite", path)
	if err != nil {
		log.Fatalf("failed to open sqlite: %v", err)
	}

	DB.SetMaxOpenConns(1) // SQLite is single-writer
	if err := DB.Ping(); err != nil {
		log.Fatalf("failed to ping sqlite: %v", err)
	}

	pragmas()
	migrate()
	log.Printf("SQLite DB ready at %s", path)
}

// pragmas sets performance-oriented SQLite settings
func pragmas() {
	settings := []string{
		"PRAGMA journal_mode=WAL",    // write-ahead log: faster writes, concurrent reads
		"PRAGMA synchronous=NORMAL",  // safe but faster than FULL
		"PRAGMA foreign_keys=ON",
		"PRAGMA cache_size=-8000",    // 8MB page cache
	}
	for _, s := range settings {
		if _, err := DB.Exec(s); err != nil {
			log.Printf("[db] pragma warning: %s — %v", s, err)
		}
	}
}

func migrate() {
	stmts := []string{
		// ── Existing tables ─────────────────────────────────────────────────
		`CREATE TABLE IF NOT EXISTS users (
			id          TEXT PRIMARY KEY,
			username    TEXT UNIQUE NOT NULL,
			password    TEXT NOT NULL,
			created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,

		`CREATE TABLE IF NOT EXISTS portfolios (
			user_id      TEXT PRIMARY KEY,
			cash         REAL    NOT NULL DEFAULT 100000,
			positions    TEXT    NOT NULL DEFAULT '{}',
			realized_pnl REAL    NOT NULL DEFAULT 0,
			updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,

		// ── New: OHLCV history ───────────────────────────────────────────────
		// Written when a candle closes (~1 write/sec at 1s interval)
		`CREATE TABLE IF NOT EXISTS ohlcv_history (
			id       INTEGER PRIMARY KEY AUTOINCREMENT,
			symbol   TEXT    NOT NULL,
			interval TEXT    NOT NULL,
			time     INTEGER NOT NULL,   -- Unix seconds (bucket start)
			open     REAL    NOT NULL,
			high     REAL    NOT NULL,
			low      REAL    NOT NULL,
			close    REAL    NOT NULL,
			volume   REAL    NOT NULL DEFAULT 0,
			UNIQUE(symbol, interval, time)
		)`,
		`CREATE INDEX IF NOT EXISTS idx_ohlcv_symbol_interval_time
		 ON ohlcv_history(symbol, interval, time)`,

		// ── New: Trade history ───────────────────────────────────────────────
		// Written for every trade involving a human user (not market_system)
		`CREATE TABLE IF NOT EXISTS trade_history (
			id             TEXT PRIMARY KEY,
			symbol         TEXT    NOT NULL,
			buyer_id       TEXT    NOT NULL,
			seller_id      TEXT    NOT NULL,
			price          REAL    NOT NULL,
			quantity       REAL    NOT NULL,
			aggressor_side TEXT    NOT NULL,
			timestamp      DATETIME NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS idx_trade_buyer   ON trade_history(buyer_id,  timestamp)`,
		`CREATE INDEX IF NOT EXISTS idx_trade_seller  ON trade_history(seller_id, timestamp)`,
		`CREATE INDEX IF NOT EXISTS idx_trade_symbol  ON trade_history(symbol,    timestamp)`,

		// ── New: Portfolio snapshots ─────────────────────────────────────────
		// Taken on every human trade fill + periodic every 60s
		// Powers the P&L equity curve on the frontend
		`CREATE TABLE IF NOT EXISTS portfolio_snapshots (
			id              INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id         TEXT    NOT NULL,
			total_value     REAL    NOT NULL,
			cash            REAL    NOT NULL,
			realized_pnl    REAL    NOT NULL,
			unrealized_pnl  REAL    NOT NULL,
			timestamp       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE INDEX IF NOT EXISTS idx_snapshot_user_time
		 ON portfolio_snapshots(user_id, timestamp)`,

		// ── New: Open orders ─────────────────────────────────────────────────
		// Written on submit, deleted on fill/cancel
		// Restored into LOB on server startup so human orders survive restarts
		`CREATE TABLE IF NOT EXISTS open_orders (
			id         TEXT PRIMARY KEY,
			user_id    TEXT NOT NULL,
			symbol     TEXT NOT NULL,
			side       TEXT NOT NULL,
			type       TEXT NOT NULL,
			price      REAL NOT NULL DEFAULT 0,
			stop_price REAL NOT NULL DEFAULT 0,
			quantity   REAL NOT NULL,
			filled     REAL NOT NULL DEFAULT 0,
			status     TEXT NOT NULL DEFAULT 'OPEN',
			created_at DATETIME NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS idx_open_orders_user   ON open_orders(user_id)`,
		`CREATE INDEX IF NOT EXISTS idx_open_orders_symbol ON open_orders(symbol)`,
		
		// ── New: User Notes ───────────────────────────────────────────────
		`CREATE TABLE IF NOT EXISTS notes (
			id         TEXT    PRIMARY KEY,
			user_id    TEXT    NOT NULL,
			content    TEXT    NOT NULL,
			created_at INTEGER NOT NULL   -- Unix milliseconds
		)`,
		`CREATE INDEX IF NOT EXISTS idx_notes_user ON notes(user_id)`,
	}

	for _, s := range stmts {
		if _, err := DB.Exec(s); err != nil {
			log.Fatalf("[db] migration failed:\n%s\nerror: %v", s, err)
		}
	}
	log.Println("[db] migrations complete")
}
