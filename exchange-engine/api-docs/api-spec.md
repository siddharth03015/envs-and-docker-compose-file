# Exchange Engine — API Specification

Base URL: `http://localhost:8080`

---

## Authentication

### POST /api/auth/register
Create a new user. Returns JWT. User gets $100,000 starting capital.

**Request:**
```json
{ "username": "alice", "password": "secret123" }
```
**Response 201:**
```json
{ "token": "<jwt>", "user_id": "<uuid>", "username": "alice" }
```
**Errors:** `400` missing fields, `409` username taken

---

### POST /api/auth/login
**Request:**
```json
{ "username": "alice", "password": "secret123" }
```
**Response 200:**
```json
{ "token": "<jwt>", "user_id": "<uuid>", "username": "alice" }
```
**Errors:** `401` invalid credentials

---

## Market Data (public, no auth required)

### GET /api/symbols

Lists all 3 symbols with live price + 24h change % + volume. Used for the ticker bar at the top of the frontend.

### GET /api/orderbook/:symbol

Returns the Limit Order Book — top 20 bid price levels (descending) and top 20 ask price levels (ascending), each with price + quantity. Used for the
order book depth table and depth chart on frontend.

### GET /api/ohlcv/:symbol?interval=1s&limit=100

Returns candlestick history — each candle has Open, High, Low, Close, Volume for the given interval. Supports 1s, 5s, 1m, 5m. Used by TradingView chart
  on frontend.

### GET /api/trades/:symbol?limit=50

Returns the recent trade tape — each trade shows price, quantity, aggressor side (BUY/SELL), and timestamp. Used for the live scrolling trade tape on
frontend.

### GET /api/ticker/:symbol

Returns full 24h market stats for a symbol — last price, best bid, best ask, spread, volume, 24h high/low, % change, VWAP. Used for the market stats
bar on frontend.

### GET /api/symbols
```json
{
  "symbols": [
    { "symbol": "BTC-USD", "last_price": 45230.5, "change_24h_pct": 0.012 }
  ]
}
```

### GET /api/orderbook/{symbol}
```
GET /api/orderbook/BTC-USD
```
```json
{
  "symbol": "BTC-USD",
  "timestamp": 1743072001234,
  "bids": [{ "price": 45000.0, "quantity": 1.25 }],
  "asks": [{ "price": 45001.0, "quantity": 0.60 }]
}
```

### GET /api/ohlcv/{symbol}
```
GET /api/ohlcv/BTC-USD?interval=1s&limit=100
```
Intervals: `1s`, `5s`, `1m`, `5m`. Limit: 1–500.
```json
{
  "symbol": "BTC-USD",
  "interval": "1s",
  "candles": [
    { "time": 1743072001, "open": 45000, "high": 45050, "low": 44990, "close": 45020, "volume": 2.3 }
  ]
}
```

### GET /api/trades/{symbol}
```
GET /api/trades/BTC-USD?limit=50
```
```json
{
  "trades": [
    { "id": "...", "price": 45020, "quantity": 0.05, "aggressor_side": "BUY", "timestamp": "..." }
  ]
}
```

### GET /api/ticker/{symbol}
```json
{
  "symbol": "BTC-USD",
  "last_price": 45020.0,
  "best_bid": 45000.0,
  "best_ask": 45001.0,
  "spread": 1.0,
  "volume_24h": 142.5,
  "change_24h_pct": 0.0124,
  "high_24h": 45800.0,
  "low_24h": 44100.0,
  "vwap": 44950.0,
  "timestamp": 1743072001234
}
```

### GET /health
```json
{ "status": "ok", "service": "exchange-engine" }
```

---

## History Endpoints (public, SQLite-backed — data persists across restarts)

### GET /api/history/ohlcv/{symbol}?interval=1s&limit=500

Returns persisted OHLCV candles from the SQLite database. Covers all time since server started, beyond the in-memory 500-candle ring buffer. Oldest-first. Useful for initial chart load.

Query params: `interval` (1s | 5s | 1m | 5m, default 1s), `limit` (1–5000, default 500)

```
GET /api/history/ohlcv/BTC-USD?interval=1m&limit=200
```
```json
{
  "symbol": "BTC-USD",
  "interval": "1m",
  "candles": [
    { "symbol": "BTC-USD", "interval": "1m", "time": 1743072000, "open": 45000, "high": 45050, "low": 44990, "close": 45020, "volume": 12.3 }
  ]
}
```

### GET /api/history/trades/{symbol}?limit=100

Returns persisted human-originated trade history for a symbol (excludes market_system trades).

```
GET /api/history/trades/BTC-USD?limit=50
```
```json
{
  "symbol": "BTC-USD",
  "trades": [
    {
      "id": "...",
      "symbol": "BTC-USD",
      "buyer_id": "...",
      "seller_id": "...",
      "price": 45020,
      "quantity": 0.05,
      "aggressor_side": "BUY",
      "timestamp": 1743072001234
    }
  ]
}
```

---

## Protected Endpoints (require `Authorization: Bearer <jwt>`)

### POST /api/orders — Submit order

  3 types supported:
  ┌────────────┬──────────────────────────────────────────────────────────────┐
  │    type    │                          behaviour                           │
  ├────────────┼──────────────────────────────────────────────────────────────┤
  │ LIMIT      │ rests in LOB at your price, fills when crossed → status OPEN │
  ├────────────┼──────────────────────────────────────────────────────────────┤
  │ MARKET     │ fills immediately at best available price → status FILLED    │
  ├────────────┼──────────────────────────────────────────────────────────────┤
  │ STOP_LIMIT │ sits waiting until price hits stop_price, then acts as LIMIT │
  └────────────┴──────────────────────────────────────────────────────────────┘

### GET /api/orders?symbol=BTC-USD — List open orders
Returns only your open/partial orders. Shows full detail: side, type, price, qty, filled, status, created_at.

### DELETE /api/orders/:id?symbol=BTC-USD — Cancel order
Removes the order from the LOB. Returns CANCELLED. Only the owner can cancel.

### GET /api/portfolio — Your full portfolio
Returns:
- cash — remaining balance
- positions — per symbol: quantity, avg entry price, current price, market value, unrealized P&L + %
- realized_pnl — profit locked in from closed positions
- total_value — cash + all position market values

### POST /api/orders — Submit order
```json
{
  "symbol": "BTC-USD",
  "side": "BUY",
  "type": "LIMIT",
  "quantity": 0.1,
  "price": 45000.00,
  "stop_price": 0
}
```
`type`: `LIMIT` | `MARKET` | `STOP_LIMIT`
`side`: `BUY` | `SELL`

**Response 201:**
```json
{ "order_id": "...", "status": "OPEN", "created_at": "..." }
```

### DELETE /api/orders/{id}?symbol=BTC-USD — Cancel order
```json
{ "order_id": "...", "status": "CANCELLED" }
```

### GET /api/orders?symbol=BTC-USD — List open orders
```json
{
  "orders": [
    { "id": "...", "symbol": "BTC-USD", "side": "BUY", "type": "LIMIT",
      "price": 45000, "quantity": 0.1, "filled": 0, "status": "OPEN" }
  ]
}
```

### GET /api/portfolio — Current portfolio
```json
{
  "user_id": "...",
  "cash": 95432.10,
  "positions": {
    "BTC-USD": {
      "symbol": "BTC-USD",
      "quantity": 0.5,
      "avg_entry_price": 44800.0,
      "current_price": 45230.0,
      "market_value": 22615.0,
      "unrealized_pnl": 215.0,
      "unrealized_pnl_pct": 0.0096
    }
  },
  "realized_pnl": 432.10,
  "total_value": 118047.10
}
```

### GET /api/leaderboard
```json
{
  "leaderboard": [
    { "rank": 1, "user_id": "...", "username": "alice", "total_value": 105000, "cash": 90000, "pnl": 5000 }
  ]
}
```

### GET /api/history/pnl?limit=1000 (Protected)

Returns the portfolio equity curve for the authenticated user — each point is a snapshot taken on every fill and every 60s. Oldest-first. Use to draw the P&L chart on the frontend.

```json
{
  "history": [
    {
      "total_value": 100000.0,
      "cash": 100000.0,
      "realized_pnl": 0.0,
      "unrealized_pnl": 0.0,
      "timestamp": 1743072000000
    },
    {
      "total_value": 102345.67,
      "cash": 55432.10,
      "realized_pnl": 1200.50,
      "unrealized_pnl": 1713.07,
      "timestamp": 1743075600000
    }
  ]
}
```
Timestamps are Unix milliseconds. `limit` max 5000, default 1000.

---

### GET /api/history/my-trades?limit=200 (Protected)

Returns the authenticated user's complete personal trade history — as buyer OR seller. Newest-first. The `side` field is computed from the caller's perspective (`BUY` if they were the buyer, `SELL` if they were the seller).

Limit: 1–1000 (default 200). Timestamps are Unix milliseconds.

```
GET /api/history/my-trades?limit=50
Authorization: Bearer <jwt>
```
```json
{
  "trades": [
    {
      "id": "...",
      "symbol": "BTC-USD",
      "side": "BUY",
      "price": 45020.0,
      "quantity": 0.05,
      "aggressor_side": "BUY",
      "buyer_id": "<your-user-id>",
      "seller_id": "<counterparty-id>",
      "timestamp": 1743072001234
    },
    {
      "id": "...",
      "symbol": "ETH-USD",
      "side": "SELL",
      "price": 2510.0,
      "quantity": 1.2,
      "aggressor_side": "SELL",
      "buyer_id": "<counterparty-id>",
      "seller_id": "<your-user-id>",
      "timestamp": 1743071900000
    }
  ]
}
```

---

## WebSocket

### Connect
```
ws://localhost:8080/ws?token=<jwt>&symbol=BTC-USD
```

### Subscribe (change symbol after connect)
```json
{ "type": "change_symbol", "symbol": "ETH-USD" }
```

### Submit Order via WS
```json
{
  "type": "order",
  "payload": {
    "symbol": "BTC-USD",
    "side": "BUY",
    "type": "LIMIT",
    "quantity": 0.1,
    "price": 45000.0
  }
}
```

### Cancel Order via WS
```json
{ "type": "cancel", "payload": { "order_id": "...", "symbol": "BTC-USD" } }
```

### Server → Client Messages

| type | description |
|---|---|
| `orderbook` | Full LOB snapshot (top 20 levels) |
| `trade` | Executed trade |
| `ohlcv` | Candle update (is_closed: true/false) |
| `ticker` | Best bid/ask, last price, volume, VWAP |
| `portfolio` | User's full portfolio snapshot |
| `order_ack` | Order accepted by engine |
| `order_fill` | Order fill notification |
| `order_cancel` | Order cancelled |
| `error` | Error with code + message |

**orderbook:**
```json
{ "type": "orderbook", "symbol": "BTC-USD", "timestamp": 123, "bids": [...], "asks": [...] }
```
**trade:**
```json
{ "type": "trade", "symbol": "BTC-USD", "trade_id": "...", "price": 45020, "quantity": 0.05, "aggressor_side": "BUY", "timestamp": 123 }
```
**ohlcv:**
```json
{ "type": "ohlcv", "symbol": "BTC-USD", "interval": "1s", "candle": { "time": 123, "open": 45000, "high": 45050, "low": 44990, "close": 45020, "volume": 2.3 }, "is_closed": false }
```
**error:**
```json
{ "type": "error", "code": "INSUFFICIENT_FUNDS", "message": "need 4500.00, have 100.00" }
```


WebSocket — Full Detail
  Connection

  ws://localhost:8080/ws?token=<jwt>&symbol=BTC-USD
  - token — JWT from register/login (required, same as Bearer token)
  - symbol — which symbol to subscribe to on connect (optional, defaults to BTC-USD)
  - One connection per user. Multiple browser tabs = multiple connections, all work independently.

  ---
  On Connect — Server sends these automatically (no request needed)

  The server immediately pushes a full snapshot the moment you connect:

  ┌──────────────────┬──────────────┬────────────────────────────────────────┐
  │       What       │ Message type │                 Detail                 │
  ├──────────────────┼──────────────┼────────────────────────────────────────┤
  │ Full order book  │ orderbook    │ Top 20 bids + 20 asks                  │
  ├──────────────────┼──────────────┼────────────────────────────────────────┤
  │ Last 50 trades   │ trade        │ Recent trade tape                      │
  ├──────────────────┼──────────────┼────────────────────────────────────────┤
  │ Last 200 candles │ ohlcv        │ For all 4 intervals: 1s, 5s, 1m, 5m    │
  ├──────────────────┼──────────────┼────────────────────────────────────────┤
  │ Live ticker      │ ticker       │ Current price, spread, VWAP, 24h stats │
  ├──────────────────┼──────────────┼────────────────────────────────────────┤
  │ Your portfolio   │ portfolio    │ Cash, positions, P&L                   │
  └──────────────────┴──────────────┴────────────────────────────────────────┘

  Frontend uses this to hydrate the entire UI instantly on load — no separate REST calls needed.

  ---
  Client → Server (you send these)

  1. subscribe — Change symbol

  { "type": "subscribe", "symbol": "ETH-USD" }
  Switches your subscription to ETH-USD. Server will now send you ETH-USD orderbook/trade/ohlcv/ticker events instead of BTC-USD.

  ---
  2. change_symbol — Change symbol + get fresh snapshot

  { "type": "change_symbol", "symbol": "SOL-USD" }
  Same as subscribe but also triggers a full initial snapshot for the new symbol (order book, trades, candles, ticker). Use this when user clicks a
  different symbol in the UI.

  ---
  3. order — Submit an order

  {
    "type": "order",
    "payload": {
      "symbol": "BTC-USD",
      "side": "BUY",
      "type": "LIMIT",
      "quantity": 0.1,
      "price": 45000.0,
      "stop_price": 0
    }
  }
  - side: BUY or SELL
  - type: LIMIT, MARKET, or STOP_LIMIT
  - price: required for LIMIT and STOP_LIMIT, ignored for MARKET
  - stop_price: only for STOP_LIMIT

  Server responds with order_ack (or error if rejected).

  ---
  4. cancel — Cancel an open order

  {
    "type": "cancel",
    "payload": {
      "order_id": "a7dee06f-...",
      "symbol": "BTC-USD"
    }
  }
  Server responds with order_cancel to your connection only (or error if not found/not yours).

  ---
  Server → Client (you receive these)

  orderbook — Live order book update

  Sent after every single order submission or cancellation on the subscribed symbol.
  {
    "type": "orderbook",
    "symbol": "BTC-USD",
    "timestamp": 1743072001234,
    "bids": [
      { "price": 45000.0, "quantity": 1.25 },
      { "price": 44999.5, "quantity": 0.80 }
    ],
    "asks": [
      { "price": 45001.0, "quantity": 0.60 },
      { "price": 45002.0, "quantity": 1.10 }
    ]
  }
  Always a full snapshot of top 20 levels. Frontend replaces its entire book state on each message.

  ---
  trade — Executed trade

  Sent every time a match happens on the subscribed symbol (from both GBM and human orders).
  {
    "type": "trade",
    "symbol": "BTC-USD",
    "trade_id": "trd_xyz",
    "price": 45020.0,
    "quantity": 0.05,
    "aggressor_side": "BUY",
    "timestamp": 1743072001234
  }
  Frontend uses this to update the trade tape + feed into the chart's current candle.

  ---
  ohlcv — Candle update

  Two cases:
  - is_closed: false → current in-progress candle updated (sent on every trade)
  - is_closed: true → a candle has completed and a new one started (sent at interval boundary)

  {
    "type": "ohlcv",
    "symbol": "BTC-USD",
    "interval": "1s",
    "candle": {
      "time": 1743072001,
      "open": 45000.0,
      "high": 45050.0,
      "low": 44990.0,
      "close": 45020.0,
      "volume": 2.345
    },
    "is_closed": false
  }
  Frontend passes this directly into TradingView Lightweight Charts update() method.

  ---
  ticker — Market stats update

  Sent after every trade. Contains the full 24h picture.
  {
    "type": "ticker",
    "symbol": "BTC-USD",
    "last_price": 45020.0,
    "best_bid": 45000.0,
    "best_ask": 45001.0,
    "spread": 1.0,
    "volume_24h": 142.5,
    "change_24h_pct": 0.0124,
    "high_24h": 45800.0,
    "low_24h": 44100.0,
    "vwap": 44950.0,
    "open_price": 45000.0,
    "timestamp": 1743072001234
  }

  ---
  portfolio — Your portfolio update

  Sent only to your connection after any of your orders fill.
  {
    "type": "portfolio",
    "data": {
      "user_id": "...",
      "cash": 95432.10,
      "positions": {
        "BTC-USD": {
          "quantity": 0.5,
          "avg_entry_price": 44800.0,
          "current_price": 45230.0,
          "market_value": 22615.0,
          "unrealized_pnl": 215.0,
          "unrealized_pnl_pct": 0.0096
        }
      },
      "realized_pnl": 432.10,
      "total_value": 118047.10
    }
  }

  ---
  order_ack — Order accepted

  Sent only to you after submitting an order.
  { "type": "order_ack", "payload": { "id": "...", "status": "OPEN", ... } }

  order_fill — Your order was filled (partial or full)

  Sent only to you (as buyer or seller) when a match happens against your order.
  { "type": "order_fill", "payload": { ...trade details... } }

  order_cancel — Your order cancelled

  Sent only to you after a successful cancel.
  { "type": "order_cancel", "payload": { "id": "...", "status": "CANCELLED" } }

  error — Something went wrong

  {
    "type": "error",
    "code": "INSUFFICIENT_FUNDS",
    "message": "need 4500.00, have 100.00"
  }

  ┌────────────────────┬───────────────────────────────┐
  │        Code        │             Cause             │
  ├────────────────────┼───────────────────────────────┤
  │ INSUFFICIENT_FUNDS │ Not enough cash for the order │
  ├────────────────────┼───────────────────────────────┤
  │ INVALID_ORDER      │ Missing required fields       │
  ├────────────────────┼───────────────────────────────┤
  │ SUBMIT_FAILED      │ Engine rejected the order     │
  ├────────────────────┼───────────────────────────────┤
  │ CANCEL_FAILED      │ Order not found or not yours  │
  ├────────────────────┼───────────────────────────────┤
  │ BAD_MSG            │ Invalid JSON received         │
  └────────────────────┴───────────────────────────────┘

  ---
  Message Flow Summary

  You connect
      └── Server sends: orderbook + 50 trades + 200 candles + ticker + portfolio

  GBM ticks every 20ms
      └── Server sends to all subscribers: trade → ohlcv → ticker → orderbook

  You submit an order
      └── Server sends to you:        order_ack
      └── If filled, sends to you:    order_fill + portfolio
      └── Server sends to everyone:   trade + ohlcv + ticker + orderbook

  You cancel an order
      └── Server sends to you:        order_cancel
      └── Server sends to everyone:   orderbook

---

## Notes (Protected — require `Authorization: Bearer <jwt>`)

Simple user trading journal. Each note belongs to the authenticated user.

Notes are stored with a creation timestamp and returned newest-first.

---

### POST /api/notes — Create note

Creates a new note for the authenticated user.

**Request:**
```json
{
  "content": "Watching BTC breakout above 65000"
}
```

**Response 201:**
```json
{
  "id": "b0e7b6e3-9d76-4f5c-9b62-8f4d4f2b3f20",
  "content": "Watching BTC breakout above 65000",
  "created_at": 1743072001234
}
```

Errors:
- `400` invalid request body
- `400` content required

---

### GET /api/notes — List notes

Returns all notes belonging to the authenticated user.

Notes are sorted newest-first by `created_at`.

```
GET /api/notes
Authorization: Bearer <jwt>
```

**Response 200:**
```json
{
  "notes": [
    {
      "id": "b0e7b6e3-9d76-4f5c-9b62-8f4d4f2b3f20",
      "content": "Watching BTC breakout",
      "created_at": 1743072001234
    },
    {
      "id": "c2f12d3a-8a7a-4e62-bbfa-7f5c0f4a93f1",
      "content": "ETH support around 3200",
      "created_at": 1743068000000
    }
  ]
}
```

`created_at` is a Unix timestamp in milliseconds.

---

### GET /api/notes?from=<unix_ms>&to=<unix_ms> — Filter notes by time range

Returns notes within a creation time range.

Both parameters are optional.

```
GET /api/notes?from=1743072000000&to=1743080000000
Authorization: Bearer <jwt>
```

Rules:

- `from` is **inclusive**
- `to` is **exclusive**
- timestamps are **Unix milliseconds**
- if omitted, that side of the range is unbounded

Examples:

```
GET /api/notes?from=1743072000000
```
Returns notes created after the given timestamp.

```
GET /api/notes?to=1743080000000
```
Returns notes created before the given timestamp.

```
GET /api/notes?from=1743072000000&to=1743080000000
```
Returns notes created between the two timestamps.

---

### PUT /api/notes/{id} — Update note

Updates the content of an existing note owned by the authenticated user.

```
PUT /api/notes/b0e7b6e3-9d76-4f5c-9b62-8f4d4f2b3f20
Authorization: Bearer <jwt>
```

**Request:**
```json
{
  "content": "BTC breakout confirmed above 75000"
}
```

**Response 200:**
```json
{
  "id": "b0e7b6e3-9d76-4f5c-9b62-8f4d4f2b3f20",
  "content": "BTC breakout confirmed above 75000"
}
```

Errors:
- `400` invalid request body
- `400` content required
- `404` note not found
- `500` update failed

---

### DELETE /api/notes/{id} — Delete note

Deletes a note owned by the authenticated user.

```
DELETE /api/notes/b0e7b6e3-9d76-4f5c-9b62-8f4d4f2b3f20
Authorization: Bearer <jwt>
```

**Response 200:**
```json
{
  "id": "b0e7b6e3-9d76-4f5c-9b62-8f4d4f2b3f20",
  "status": "deleted"
}
```

Errors:
- `404` note not found
- `500` delete failed