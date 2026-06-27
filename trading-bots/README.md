## Overview

The trading bots service is a standalone Python process that connects to the
exchange engine as a collection of autonomous market participants.

**4 distinct bot strategies** are implemented.  Each strategy registers **one
shared account** and then runs one task per symbol under that account.  With
3 default symbols this means 4 × 3 = 12 concurrent tasks, but only **4 accounts
appear on the leaderboard** — one per strategy, not one per stock.

Every bot account starts with **$100,000** simulated capital (seeded by the
exchange on first registration).

```
trading-bots/
├── bots/
│   ├── __init__.py
│   ├── base_bot.py            ← abstract base: auth, REST, WS, metrics
│   ├── market_maker.py        ← Strategy 1: spread-quoting market maker
│   ├── alpha_bot.py           ← Strategy 2: RSI + EMA crossover
│   ├── momentum_bot.py        ← Strategy 3: MACD + EMA trend filter
│   └── mean_reversion_bot.py  ← Strategy 4: Bollinger Bands fade
├── indicators.py              ← pure-Python technical indicator library
├── metrics.py                 ← aiohttp JSON metrics server (port 9090)
├── main.py                    ← entry point: fetch symbols, spawn bots
├── requirements.txt           ← aiohttp>=3.9.0  (covers HTTP + WebSocket)
└── Dockerfile                 ← Python 3.12-slim, exposes 9090
```

---

## Runtime Configuration

| Environment Variable | Default                  | Description                        |
|---|---|---|
| `ENGINE_URL`         | `http://localhost:8080`  | Exchange engine base URL           |
| `BOT_PASSWORD`       | `bot-secret-2026`        | Shared password for all bot users  |
| `METRICS_PORT`       | `9090`                   | Port for the metrics HTTP server   |

---

## `main.py` — Entry Point

1. Calls `GET /api/symbols` with retry + 3 s back-off (up to 10 attempts) to
   discover all symbols dynamically — **no hardcoded symbol list**.
2. For each symbol (e.g. `BTC-USD`) derives a short key
   (`sym.split("-")[0].lower()` → `"btc"`).
3. Spawns four bot instances per symbol:

   | Key pattern    | Class              | Username example |
   |---|---|---|
   | `mm_{short}`   | `MarketMakerBot`   | `mm_btc`         |
   | `alpha_{short}`| `AlphaBot`         | `alpha_btc`      |
   | `mom_{short}`  | `MomentumBot`      | `mom_btc`        |
   | `mrv_{short}`  | `MeanReversionBot` | `mrv_btc`        |

4. Registers every bot in the global metrics registry.
5. Starts the metrics HTTP server.
6. Runs all bots as concurrent `asyncio.Task` instances.
7. Installs `SIGINT`/`SIGTERM` handlers that cancel all tasks for graceful shutdown.

---

## `bots/base_bot.py` — Abstract Base Class

### Authentication
- On `run()`, attempts `POST /api/auth/login`.
- If login fails with 401, falls back to `POST /api/auth/register` (creating the
  account) then logs in again.
- Uses exponential back-off (up to 5 retries) for network errors.
- Stores the JWT and attaches it to every subsequent REST call and WS connection.

### REST Helpers
| Method                    | Exchange Endpoint          | Description                         |
|---|---|---|
| `place_limit(side, p, q)` | `POST /api/orders`         | Submit a LIMIT order                |
| `place_market(side, q)`   | `POST /api/orders`         | Submit a MARKET order               |
| `cancel_order(id)`        | `DELETE /api/orders/:id`   | Cancel a single order               |
| `cancel_all_symbol_orders()` | `GET + DELETE /api/orders` | Cancel all open orders for symbol |
| `get_portfolio()`         | `GET /api/portfolio`       | Fetch cash + positions              |

### WebSocket Loop
- Connects to `ws://<engine>/ws?token=<jwt>&symbol=<sym>`.
- Auto-reconnects with 3 s back-off on disconnect.
- Handles the following server-sent event types:

  | WS type      | Action                                               |
  |---|---|
  | `ticker`     | Updates `self.ticker` (last_price, bid, ask, …)     |
  | `orderbook`  | Updates `self.orderbook` (bids/asks snapshot)        |
  | `ohlcv`      | Updates candle buffer (`is_closed=false` → patch live candle; `is_closed=true` → append closed candle, fire `on_candle_close`) |
  | `portfolio`  | Syncs `cash`, `positions`, `realized_pnl`; tracks win/loss counts |
  | `order_ack`  | Logs acknowledgement                                 |
  | `order_cancel` | Fires `on_order_cancel` hook (used by MarketMaker) |
  | `error`      | Logs the error payload                               |

### Candle Bootstrap
On startup, seeds the candle buffer from `GET /api/history/ohlcv/:symbol` before
the WS connection starts delivering live candles.  Falls back through intervals
`[CANDLE_INTERVAL, "5s", "1s"]` so bots start even on a freshly launched engine
with no 1-minute history yet.  Guards against `candles: null` API responses with
`raw.get("candles") or []`.

### Portfolio State (live, updated by WS)
| Attribute       | Type    | Description                          |
|---|---|---|
| `cash`          | float   | Current cash balance (USD)           |
| `positions`     | dict    | `{symbol: qty}` map                  |
| `realized_pnl`  | float   | Cumulative realised P&L              |
| `trade_count`   | int     | Total fills received                 |
| `win_count`     | int     | Fills with positive P&L delta        |
| `loss_count`    | int     | Fills with negative P&L delta        |
| `pnl_history`   | list    | Time-series of `(ts, total_value)`   |
| `_peak_value`   | float   | Running peak for drawdown tracking   |

### `get_metrics()` — Snapshot (consumed by metrics server)
Returns a dict with: `username`, `symbol`, `strategy`, `cash`,
`position_qty`, `last_price`, `unrealized_pnl`, `realized_pnl`,
`total_value`, `trade_count`, `win_count`, `loss_count`, `win_rate`,
`sharpe_ratio`, `max_drawdown`, `current_drawdown`, `ws_connected`,
`candle_count`, `pnl_history`.

---

## Strategy 1 — Market Maker (`market_maker.py`)

**Hypothesis:** Continuously quoting a two-sided market captures the bid-ask
spread as profit.

### Parameters
| Parameter        | Value    | Description                                   |
|---|---|---|
| `SPREAD_PCT`     | 0.0015   | Half-spread as fraction of mid-price (0.15%)  |
| `QUOTE_INTERVAL` | 0.5 s    | Quote refresh frequency                       |
| `MAX_INVENTORY`  | 1.0      | Max net position in base asset units          |
| `MIN_CASH_RATIO` | 0.10     | Reserve 10% of cash; never deploy all of it   |
| `QUOTE_VALUE_USD`| $500     | Target USD notional per side per quote        |

### Order Sizing
Quantity is computed live as `QUOTE_VALUE_USD / mid_price`, rounded to an
appropriate precision (2 dp for qty ≥ 1, 4 dp for qty ≥ 0.01, 6 dp otherwise).
This makes the bot symbol-agnostic regardless of price range.

### Volatility-Adaptive Spread
Uses Bollinger Band width as a volatility proxy:
```
multiplier = 1.0 + max(0, (bb_width - 0.01) / 0.01) * 0.5
spread = SPREAD_PCT × multiplier  (capped at 3×)
```
Widens automatically in high-volatility periods to protect against adverse
selection.

### Inventory Skew
```
skew = net_position / MAX_INVENTORY   ∈ [-1, 1]
bid_price = mid - half_spread × (1 + 0.5 × skew)
ask_price = mid + half_spread × (1 - 0.5 × skew)
```
When long (skew > 0): bid is pushed lower (less aggressive buy), ask is pulled
tighter (more aggressive sell) — encourages inventory reduction.

### Lifecycle
1. Wait up to 20 s for first ticker/orderbook data.
2. Cancel any stale orders left by a previous run.
3. Every `QUOTE_INTERVAL`:  cancel existing quotes → compute mid → place fresh bid + ask.
4. On shutdown: cancel all outstanding quotes.

---

## Strategy 2 — Alpha Bot (`alpha_bot.py`)

**Hypothesis:** EMA crossovers combined with RSI filtering identify high-probability
trend-entry points.

### Indicators & Parameters
| Indicator  | Parameter | Value |
|---|---|---|
| RSI        | period    | 14    |
| EMA fast   | period    | 9     |
| EMA slow   | period    | 21    |
| Candle interval | — | 1 minute |
| Minimum candles | — | 40 (EMA_SLOW + RSI_PERIOD + 5) |

### Entry Rules
| Direction | Condition                                          |
|---|---|
| LONG      | EMA(9) crosses above EMA(21)  **AND**  RSI < 70   |
| SHORT     | EMA(9) crosses below EMA(21)  **AND**  RSI > 30   |

### Exit Rules (first to trigger)
| Trigger         | Condition                        |
|---|---|
| Stop-loss       | −2% adverse move from entry      |
| Take-profit     | +4% favourable move from entry   |
| Signal reversal | Opposite EMA crossover while in position |

### Position Sizing
Fixed `TRADE_USD = $3,000` per trade, converted to qty at current price.
Short selling fully supported.

### Evaluation
- Triggered on every `on_candle_close` WS hook.
- Periodic fallback evaluation every 30 s to handle missed candle events.

---

## Strategy 3 — Momentum Bot (`momentum_bot.py`)

**Hypothesis:** MACD crossovers in the direction of the prevailing EMA(50) trend
capture sustained momentum moves.

### Indicators & Parameters
| Indicator     | Parameter | Value |
|---|---|---|
| MACD fast EMA | period    | 12    |
| MACD slow EMA | period    | 26    |
| MACD signal   | period    | 9     |
| Trend EMA     | period    | 50    |
| Candle interval | —      | 5 seconds (fast warm-up: ~7 min vs 35 min for 1m) |
| Minimum candles | —      | 87 (EMA_TREND + MACD_SLOW + MACD_SIGNAL + 2) |

### Entry Rules
| Direction | Condition                                              |
|---|---|
| LONG      | MACD histogram crosses from negative to positive  **AND**  price > EMA(50) |
| SHORT     | MACD histogram crosses from positive to negative  **AND**  price < EMA(50) |

Crossover detected by comparing histogram sign between `prices[:-1]` and
`prices` (the `_prev_histogram` helper).

### Exit Rules (first to trigger)
| Trigger     | Condition                          |
|---|---|
| Stop-loss   | −1.5% adverse move                 |
| Take-profit | +3.0% favourable move              |
| Trend flip  | Price crosses to the other side of EMA(50) |

### Position Sizing
Fixed `TRADE_USD = $2,500` per trade.

### Evaluation
- Triggered on every `on_candle_close` WS hook (5s bars).
- Periodic fallback every 15 s.

---

## Strategy 4 — Mean Reversion Bot (`mean_reversion_bot.py`)

**Hypothesis:** Price tends to revert to the mean (middle Bollinger Band) after
extreme standard-deviation excursions.

### Indicators & Parameters
| Indicator      | Parameter | Value |
|---|---|---|
| Bollinger Bands | period   | 20    |
| Bollinger Bands | std dev  | 2.0   |
| RSI confirmation | period  | 14    |
| Candle interval  | —       | 1 minute |
| Minimum candles  | —       | 36 (BB_PERIOD + RSI_PERIOD + 2) |

### Entry Rules (whipsaw filter applied via RSI)
| Direction | Condition                                                      |
|---|---|
| LONG      | close < lower Bollinger Band  **AND**  RSI < 40 (oversold)    |
| SHORT     | close > upper Bollinger Band  **AND**  RSI > 60 (overbought)  |

### Exit Rules (first to trigger)
| Trigger    | Condition                                         |
|---|---|
| Target     | Price returns to middle Bollinger Band (mean)     |
| Stop-loss  | −1.5% adverse move from entry                     |
| Time-stop  | 30 bars (~30 minutes) elapsed without exit        |

### Position Sizing
Fixed `TRADE_USD = $2,500` per trade.

### Evaluation
- Triggered on every `on_candle_close` WS hook.
- Periodic fallback every 20 s.

---

## `indicators.py` — Technical Indicator Library

Pure Python, zero external dependencies.  All functions operate on
`List[float]` and return `Optional` values (or lists of `Optional`) so callers
can guard against insufficient data.

| Function           | Signature                                          | Description                                      |
|---|---|---|
| `ema`              | `(prices, period) → List[Optional[float]]`         | Exponential Moving Average (EMA) across full series |
| `rsi`              | `(prices, period=14) → Optional[float]`            | Wilder's RSI for most recent point                |
| `bollinger`        | `(prices, period=20, num_std=2.0) → Optional[Tuple[float,float,float]]` | Bollinger Bands: (upper, middle, lower) |
| `bollinger_width`  | `(prices, period=20) → Optional[float]`            | Normalised width = (upper−lower)/middle, volatility proxy |
| `macd`             | `(prices, fast=12, slow=26, signal=9) → Tuple[Optional[float],Optional[float],Optional[float]]` | MACD line, signal line, histogram |
| `crossover`        | `(fast, slow) → Optional[bool]`                    | True=bullish cross, False=bearish, None=no cross  |
| `sharpe_ratio`     | `(values) → float`                                 | Mean/std of period returns; 0.0 if insufficient data |
| `max_drawdown`     | `(values) → float`                                 | Peak-to-trough as positive fraction               |

---

## `metrics.py` — HTTP Metrics Server

Runs an `aiohttp.web` server on port 9090.  All responses include
`Access-Control-Allow-Origin: *`.

| Endpoint          | Method | Response                              |
|---|---|---|
| `/health`         | GET    | `{"status": "ok", "bots": <count>}`  |
| `/metrics`        | GET    | JSON object — all bots keyed by username |
| `/metrics/{key}`  | GET    | JSON object — single bot snapshot    |

Each bot snapshot (from `BaseBot.get_metrics()`) includes:

```json
{
  "username":        "mm_btc",
  "symbol":          "BTC-USD",
  "strategy":        "MarketMakerBot",
  "cash":            98456.12,
  "position_qty":    0.0023,
  "last_price":      67234.50,
  "unrealized_pnl":  154.71,
  "realized_pnl":    902.43,
  "total_value":     99513.26,
  "trade_count":     412,
  "win_count":       238,
  "loss_count":      174,
  "win_rate":        0.578,
  "sharpe_ratio":    1.34,
  "max_drawdown":    0.024,
  "current_drawdown": 0.003,
  "ws_connected":    true,
  "candle_count":    287,
  "pnl_history":     [[1743590400000, 100000.0], ["...", "..."]]
}
```

---

## Dockerfile

```
Base image : python:3.12-slim
Workdir    : /app
Install    : requirements.txt (aiohttp>=3.9.0)
Expose     : 9090
CMD        : python main.py
```

The service depends on `exchange-engine` in `docker-compose.yml` and waits for
the engine to be healthy before the bots attempt to register or connect.

---

## Checklist Against Problem Statement

| Requirement                                   | Status |
|---|---|
| Market Maker bot — spread quoting              |  `MarketMakerBot` |
| Directional / Alpha bot — RSI + EMA            |  `AlphaBot` |
| $100,000 starting capital per bot              |  Exchange engine seeds on register |
| WebSocket client connections to engine         |  Each bot maintains its own persistent WS |
| REST order placement (limit, market, cancel)   |  All three order types used |
| Short selling                                  |  All strategies place SELL market orders |
| Metrics endpoint for bot dashboard             |  `/metrics` on port 9090 |
| Dockerfile                                     |  Python 3.12-slim |
| `docker-compose up` launches everything        |  `trading-bots` service in compose |

### Bonus (beyond spec)
| Feature                                       | Detail |
|---|---|
| MomentumBot — MACD(12,26,9) + EMA(50)         | 4th strategy, 5s candles for fast warm-up |
| MeanReversionBot — Bollinger Bands fade        | 5th strategy, time-stop after 30 bars |
| Dynamic symbol discovery                       | Calls `/api/symbols` at startup; no hardcoded list |
| Volatility-adaptive spread (MarketMaker)       | BB-width multiplier, capped at 3× |
| Inventory skew (MarketMaker)                   | Linear skew pushes quotes to reduce position risk |
| Candle bootstrap with interval fallback        | `1m → 5s → 1s` so bots start on fresh engines |
| Sharpe ratio, max drawdown, win rate in metrics | Computed from live pnl_history |
| Graceful SIGINT/SIGTERM shutdown               | Cancels all 32 asyncio tasks cleanly |
