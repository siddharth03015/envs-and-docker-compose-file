# terminal

The web trading terminal for Synthetic Bull. A dark, real-time trading interface
built with Next.js 16, React 19, and TypeScript. Connects to the exchange engine
over REST and WebSocket.

---

## Running locally

```bash
cd terminal
npm install
npm run dev
```

Opens at http://localhost:3000. The exchange engine must be running at
`http://localhost:8080` or the URL set in the environment.

For production build:

```bash
npm run build
npm run start
```

Docker:

```bash
docker build -t synthetic-bull-terminal .
docker run -p 3000:3000 \
  -e NEXT_PUBLIC_API_URL=http://localhost:8080 \
  -e NEXT_PUBLIC_WS_URL=ws://localhost:8080 \
  synthetic-bull-terminal
```

---

## Environment variables

Create a `.env.local` file in this directory for local dev:

```
NEXT_PUBLIC_API_URL=http://localhost:8080
NEXT_PUBLIC_WS_URL=ws://localhost:8080
```

Both variables are required. The `NEXT_PUBLIC_` prefix means they are inlined
at build time — the values baked into a Docker image point to whatever URLs
were set during `docker build`.

---

## Pages

| Route | Description |
|---|---|
| `/` | Landing page — register or login |
| `/trade` | Main trading terminal |
| `/dashboard` | 30-day performance dashboard and trading journal |
| `/public-market` | Accessible to anyone not signed user |
| `/charts` | For doing a proper 4x$ or 2x2 analysis of stocks |

---

## Tech stack

| Library | Version | Purpose |
|---|---|---|
| Next.js | 16.2.1 | Framework, app router, standalone build |
| React | 19.2.4 | UI |
| TypeScript | 5 | Types throughout |
| KlineCharts Pro | 0.1.1 | Candlestick chart with built-in indicators |
| KlineCharts | 9.8.12 | Core charting (used by Pro) |
| Recharts | 3.8.1 | P&L equity curve and daily P&L bar chart |
| Zustand | 5.0.12 | Global state (auth, symbols, portfolio, orders) |
| Axios | 1.14.0 | REST API client |
| TailwindCSS | — | Styling |

---

## Component layout

```
src/
  app/
    page.tsx                  — landing / auth page
    layout.tsx                — root layout, font setup
    trade/page.tsx            — main trading terminal
    dashboard/page.tsx        — performance dashboard

  components/
    AppBoot.tsx               — auth gate, bootstraps WS connection
    AuthModal.tsx             — register / login modal
    Header.tsx                — navbar, symbol ticker bar, WS latency indicator
    ChartArea.tsx             — chart container with resize handle
    KlineProChart.tsx         — KlineCharts Pro wrapper (SSR-safe dynamic import)
    KlineProInner.tsx         — chart logic: OHLCV feed, EMA/BOLL/MACD/VOL, fill markers
    OrderBook.tsx             — live bid/ask table with quantity bars
    FillFlash.tsx             — price flash animation on order book update
    OrderEntry.tsx            — LIMIT/MARKET/STOP_LIMIT order form
    OpenOrders.tsx            — open orders table with cancel button
    PortfolioSummary.tsx      — positions, cash, P&L, close position button
    PnLChart.tsx              — equity curve (Recharts AreaChart)
    MyTrades.tsx              — trade history blotter
    LeaderboardPanel.tsx      — ranked user table
    DepthChart.tsx            — bid/ask depth area chart
    ToastStack.tsx            — order fill / error toast notifications
    ResizeHandle.tsx          — draggable panel resize

    dashboard/
      DashStats.tsx           — 5 stat cards with sparklines and arc gauges
      DashNotesPanel.tsx      — trades tab + notes tab with full CRUD
      DashCalendar.tsx        — monthly calendar, daily P&L, trade/note counts
      DashOpenPositions.tsx   — open positions table
      DashCumPnL.tsx          — 30-day cumulative P&L area chart
      DashDailyPnL.tsx        — daily P&L bar chart

  ws/
    manager.ts                — WebSocket client, reconnect logic, latency tracking

  store/
    auth.ts                   — JWT, user info
    symbols.ts                — symbol list, active symbol
    orderbook.ts              — bid/ask state
    trades.ts                 — recent trades ring buffer
    portfolio.ts              — cash, positions, P&L
    orders.ts                 — open orders
    ohlcv.ts                  — candle buffer

  lib/
    api.ts                    — axios instance with JWT interceptor
    dashboard.ts              — daily data grouping, stats computation
    notes.ts                  — notes CRUD helpers

  hooks/
    useAnimatedNumber.ts      — cubic ease-out number animation via rAF
    useWebSocket.ts           — subscribe to WS events by type

  types/
    index.ts                  — shared TypeScript interfaces
```

---

## WebSocket connection

The `WebSocketManager` in `src/ws/manager.ts` manages a single connection per
active symbol. On connect it records the open timestamp and calculates round-trip
latency, which is displayed in the navbar.

Auto-reconnect fires after 3 seconds on unexpected close. Symbol changes are
sent as `{"type":"change_symbol","symbol":"ETH-USD"}` rather than reconnecting.

Events consumed by the frontend:
- `orderbook` — full LOB snapshot, replaces state
- `trade` — single trade, prepended to tape
- `ohlcv` — candle update (`is_closed:false`) or new closed candle (`is_closed:true`)
- `ticker` — 24h stats update
- `portfolio` — cash and positions after any fill
- `order_ack` — confirmation a submitted order entered the LOB
- `order_cancel` — confirmation of cancel

---

## Chart indicators

All indicators are computed client-side from the OHLCV candle buffer. No backend
calls are made for indicator data.

KlineCharts Pro handles: EMA(9), EMA(21), EMA(50), Bollinger Bands(20, 2σ),
MACD(12,26,9), Volume.

The chart loads the full OHLCV history via `GET /api/history/ohlcv/:symbol` on
connect, then appends live candles from the WebSocket. On each `order_fill`
event, a fill marker is drawn on the chart at the execution price.

---

## Dashboard data

The dashboard fetches four endpoints on load and refreshes every 30 seconds:

- `GET /api/portfolio` — current positions
- `GET /api/history/pnl` — all portfolio snapshots (equity curve source)
- `GET /api/history/my-trades` — full trade history
- `GET /api/notes` — journal notes

`buildDailyData()` in `src/lib/dashboard.ts` groups snapshots by calendar day.
`computeStats()` derives win rate, profit factor, and average win/loss from
the trade and snapshot records. All chart data is computed in the browser.