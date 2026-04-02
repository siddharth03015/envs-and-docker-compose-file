# Synthetic Bull

A fully self-contained, real-time simulated crypto and stock exchange built for
NextBull x IIT Kharagpur OpenSoft 2026. No external market data. No price feeds.
Every price, every trade, every candlestick is generated locally.

---

## Services

| Service | Language | Port | Description |
|---|---|---|---|
| `exchange-engine` | Go 1.25 | 8080 | Matching engine, GBM market generator, REST + WebSocket API |
| `terminal` | Next.js 16 / React 19 | 3000 | Trading terminal, charts, dashboard |
| `trading-bots` | Python 3.12 | 9090 (metrics) | 4 autonomous quant strategies |

All three start with a single command. The bots and terminal wait for the engine's
health check before connecting.

---

## Quick Start

```bash
git clone <repo>
cd opensoft
docker-compose up --build
```

That is it. No environment setup required. Default secrets are baked into the
compose file for local use — change them before any public deployment.

| URL | What it is |
|---|---|
| http://localhost:3000 | Trading terminal |
| http://localhost:8080/health | Engine health check |
| http://localhost:9090/metrics | Bot metrics (JSON) |

---

## Stopping and cleanup

```bash
# Stop all services
docker-compose down

# Stop and wipe the database volume (full reset)
docker-compose down -v

# Rebuild a single service after code changes
docker-compose up --build exchange-engine
docker-compose up --build web-terminal
docker-compose up --build trading-bots
```

---

## Running services individually (dev mode)

Each service has its own README with local dev instructions. Short version:

```bash
# Exchange engine
cd exchange-engine
go run ./cmd/server

# Web terminal
cd terminal
npm install
npm run dev

# Trading bots
cd trading-bots
pip install -r requirements.txt
python main.py
```

The engine must be running before starting the bots or the terminal.

---

## Environment variables

All are set in `docker-compose.yml`. For local dev, copy `.env.example` inside
each subdirectory.

| Variable | Service | Default | Description |
|---|---|---|---|
| `PORT` | engine | `8080` | HTTP listen port |
| `DB_PATH` | engine | `./exchange.db` | SQLite file path |
| `JWT_SECRET` | engine | see compose | HS256 signing key |
| `ADMIN_SECRET` | engine | `admin` | Admin panel password |
| `NEXT_PUBLIC_API_URL` | terminal | `http://localhost:8080` | REST base URL |
| `NEXT_PUBLIC_WS_URL` | terminal | `ws://localhost:8080` | WebSocket base URL |
| `ENGINE_URL` | bots | `http://localhost:8080` | Engine address |
| `BOT_PASSWORD` | bots | `bot-secret-2026` | Shared bot account password |
| `METRICS_PORT` | bots | `9090` | Metrics HTTP port |

---

## Admin panel

Go to `http://localhost:8080/admin`, enter the admin secret (default: `admin`).

From there you can:
- View all registered users and their portfolio values
- Seed a demo account with 30 days of realistic history (trades, equity curve,
  calendar entries, journal notes) — useful for showing the dashboard without
  having to trade manually for a month
- Reset any user's portfolio back to $100,000

The admin panel is compiled into the engine binary (`//go:embed admin.html`) so
it is available wherever the engine is deployed.

---

## Seed script (alternative)

There is also a standalone Python seed script at the project root:

```bash
pip install requests
python seed_demo.py
```

This registers a user (`username: user, password: user`), places ~80 orders
across all symbols, and writes 30 days of portfolio snapshots and 15 notes
directly to SQLite. Useful for seeding a local dev database without going
through the admin panel.

---

## Architecture

```
                        REST / WebSocket
exchange-engine:8080 <─────────────────────> terminal:3000
        ^
        │  REST  (same public API as human traders)
        │
trading-bots:9090 (metrics only, no inbound connections from engine)

Persistence: SQLite WAL mode, mounted as Docker volume "exchange_data"
```

The engine has no knowledge of the frontend or the bots. Both connect as
regular API clients using JWT tokens. The bots register accounts on startup
and appear on the leaderboard like any other user.

---

## Symbols

| Symbol | Initial Price | Volatility (σ ann.) |
|---|---|---|
| BTC-USD | $45,000 | 2.0% |
| ETH-USD | $2,500 | 2.5% |
| SOL-USD | $150 | 3.0% |
| BNB-USD | $400 | 2.5% |
| XRP-USD | $0.60 | 4.0% |
| AAPL-USD | $185 | 1.8% |
| TSLA-USD | $250 | 4.0% |
| NVDA-USD | $875 | 3.5% |

Prices are simulated using Geometric Brownian Motion. They diverge from real
market prices immediately after startup — that is by design.

---

## Repository layout

```
opensoft/
├── docker-compose.yml
├── exchange-engine/       Go backend
├── terminal/              Next.js frontend
├── trading-bots/          Python bots
```
