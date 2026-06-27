# exchange-engine

The core of Synthetic Bull. In-memory limit order book, Geometric Brownian Motion
market generator, REST API, and WebSocket server — all in Go.

---

## What it does

- Maintains a separate limit order book (LOB) for each symbol
- Matches orders by price-time priority
- Generates synthetic market flow using GBM (60+ trades/sec across 8 symbols)
- Persists orders, trades, OHLCV candles, and portfolio snapshots to SQLite
- Serves 17 REST endpoints and one WebSocket endpoint
- Restores open human orders into the LOB on restart

---

## Running locally

```bash
cd exchange-engine
go mod tidy
./scripts/dev.sh start
```

Requires Go 1.21 or later. No system dependencies — SQLite is compiled in via
`modernc.org/sqlite` (pure Go, no CGO).

The server listens on port `8080` by default. To change it:

```bash
PORT=9000 go run ./cmd/server
```

Environment variables:

| Variable | Default | Description |
|---|---|---|
| `PORT` | `8080` | HTTP listen port |
| `DB_PATH` | `./exchange.db` | SQLite file path |
| `JWT_SECRET` | `synthetic-bull-dev-secret` | HS256 signing key — change in production |
| `ADMIN_SECRET` | `admin` | Password for the admin panel at `/admin` |

---

## Building

```bash
./scripts/dev.sh build
```

Docker:

```bash
docker build -t synthetic-bull-engine .
docker run -p 8080:8080 synthetic-bull-engine
```

---

## Package structure

```
cmd/server/
  main.go          — wires all subsystems, event dispatcher, graceful shutdown

internal/
  types/           — shared structs: Order, Trade, Side, OrderType, DepthEntry
  engine/          — in-memory LOB, price-time matcher, Engine struct, event channel
  market/          — GBM price process (gbm.go), synthetic order generator, symbol list
  portfolio/       — per-user cash, positions, P&L, short selling, SQLite persistence
  ohlcv/           — 1s/5s/1m/5m candle aggregation, ring buffer (500 candles/symbol/interval)
  broadcast/       — WebSocket hub, per-client send channels, ping/pong keepalive
  store/           — TradeStore ring buffer (500 trades/symbol), TickerStore (VWAP, 24h stats)
  db/              — SQLite layer: 6 tables, WAL mode, all read/write helpers
  auth/            — JWT HS256 issue/validate, bcrypt password hashing, register/login handlers
  api/             — REST handlers, WebSocket handler, CORS/logging middleware, admin panel
```

No circular imports. `types` is the only package imported by multiple others.

---

## API endpoints

### Public (no auth required)

| Method | Path | Description |
|---|---|---|
| GET | `/health` | Returns `{"status":"ok"}` |
| POST | `/api/auth/register` | Create account, receive JWT, seed $100k |
| POST | `/api/auth/login` | Get JWT |
| GET | `/api/symbols` | All symbols with live price and 24h stats |
| GET | `/api/orderbook/:symbol` | Top 20 bids and asks |
| GET | `/api/ohlcv/:symbol?interval=1s&limit=100` | Recent OHLCV candles from ring buffer |
| GET | `/api/trades/:symbol?limit=50` | Recent trade tape |
| GET | `/api/ticker/:symbol` | 24h stats, VWAP, spread |
| GET | `/api/history/ohlcv/:symbol` | Full OHLCV history from SQLite |
| GET | `/api/history/trades/:symbol` | Human trade history from SQLite |

Supported intervals for OHLCV: `1s`, `5s`, `1m`, `5m`.

### Protected (JWT required — `Authorization: Bearer <token>`)

| Method | Path | Description |
|---|---|---|
| POST | `/api/orders` | Submit LIMIT / MARKET / STOP_LIMIT order |
| DELETE | `/api/orders/:id` | Cancel an open order |
| GET | `/api/orders` | My open and partially-filled orders |
| GET | `/api/portfolio` | Cash, positions, unrealized P&L |
| GET | `/api/leaderboard` | All users ranked by portfolio value |
| GET | `/api/history/pnl` | Equity curve (portfolio snapshots) |
| GET | `/api/history/my-trades` | My trade history as buyer or seller |
| POST | `/api/notes` | Create a journal note |
| GET | `/api/notes` | Get all my notes |
| PUT | `/api/notes/:id` | Update a note |
| DELETE | `/api/notes/:id` | Delete a note |

JWT token accepted as `Authorization: Bearer <token>` header or `?token=<jwt>`
query parameter (the latter is used for WebSocket connections).

### Admin

| Method | Path | Description |
|---|---|---|
| GET | `/admin` | Admin panel HTML (embedded in binary) |
| GET | `/api/admin/overview` | Exchange stats, user list, recent trades |
| POST | `/api/admin/seed-user` | Create/seed user with 30 days of history |
| POST | `/api/admin/reset-user` | Reset portfolio to $100,000 |

Admin endpoints require `?secret=<ADMIN_SECRET>` query param or
`X-Admin-Secret: <secret>` header.

### WebSocket

```
GET /ws?token=<jwt>&symbol=<symbol>
```

One connection per symbol. To switch symbol without reconnecting, send:

```json
{"type": "change_symbol", "symbol": "ETH-USD"}
```

Server sends these event types: `orderbook`, `trade`, `ohlcv`, `ticker`,
`portfolio`, `order_ack`, `order_fill`, `order_cancel`, `error`.

Client can send: `change_symbol`, `subscribe`, `order`, `cancel`.

The `ohlcv` event includes an `is_closed` field. When `false`, it is an update
to the current open candle. When `true`, the candle has closed and a new one
should be appended.

---

## Order types

**LIMIT** — rests in the LOB at the specified price. Fills if the market
reaches it. Persisted to SQLite and restored into the LOB on restart.

**MARKET** — fills immediately against the best available opposite-side orders.
Does not rest. Not persisted after execution.

**STOP_LIMIT** — rests as a stop order. When the last trade price crosses
`stop_price`, the order becomes a LIMIT order at `price` and enters the LOB.

Short selling is supported. A SELL order can be submitted when the user holds
zero or a negative position. The portfolio reflects the short as a negative
quantity with unrealized P&L calculated against the current mid price.

---

## Data persistence

| Data | Storage | Notes |
|---|---|---|
| Users, passwords | SQLite `users` | bcrypt hashed passwords |
| Portfolio state | SQLite `portfolios` | cash, positions JSON, realized P&L |
| Open human orders | SQLite `open_orders` | restored into LOB on startup |
| Human trade history | SQLite `trade_history` | only trades involving non-system users |
| OHLCV history | SQLite `ohlcv_history` | written on candle close |
| Recent OHLCV | In-memory ring buffer | 500 candles per symbol per interval |
| Portfolio snapshots | SQLite `portfolio_snapshots` | on every fill + every 60s |
| Recent trades | In-memory ring buffer | 500 trades per symbol |

SQLite runs in WAL mode with `synchronous=NORMAL`. Only one writer goroutine
touches the database at a time (Go's `database/sql` connection pool is set to
`MaxOpenConns=1`).

---

## GBM market generator

Each symbol runs an independent GBM process in its own goroutine:

```
S(t+dt) = S(t) * exp( (μ - σ²/2)*dt + σ*√dt*Z )
Z ~ N(0,1)
```

The generator submits MARKET orders to the engine as `market_system` user.
Order quantity is sized based on price tier (BTC gets smaller fractional
quantities, XRP gets whole number quantities). The mix of BUY and SELL orders
is random on each tick. This produces a realistic bid-ask spread and natural
OHLCV candlestick shapes.

`market_system` is excluded from the leaderboard.

