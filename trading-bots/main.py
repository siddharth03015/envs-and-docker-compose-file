"""
main.py — launch all trading bots.

Four distinct bot strategies, each with ONE shared account that trades ALL symbols:

  • market_maker    — MarketMakerBot   — quotes bid/ask every 500 ms, spread profit
  • momentum_trader — MomentumBot      — MACD(12,26,9) + EMA(50) trend filter
  • alpha_trader    — AlphaBot         — RSI(14) + EMA(9/21) crossover
  • mean_reversion  — MeanReversionBot — Bollinger Bands + RSI confirmation

For each strategy, ONE account is registered and multiple tasks run under it —
one per symbol. This gives 4 bot accounts on the leaderboard (not N×symbols).

Metrics server: http://0.0.0.0:9090/metrics
  GET /metrics          — all running instances
  GET /metrics/<key>    — e.g. /metrics/market_maker:BTC-USD
  GET /health
"""

from __future__ import annotations

import asyncio
import logging
import os
import signal
import sys
from typing import List

import aiohttp
from dotenv import load_dotenv

load_dotenv()

from bots.market_maker       import MarketMakerBot
from bots.alpha_bot          import AlphaBot
from bots.momentum_bot       import MomentumBot
from bots.mean_reversion_bot import MeanReversionBot
import metrics

# ── Logging ───────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-7s  %(name)-32s  %(message)s",
    datefmt="%H:%M:%S",
    stream=sys.stdout,
)
log = logging.getLogger("main")

# ── Configuration ─────────────────────────────────────────────────────────────
ENGINE_URL   = os.getenv("ENGINE_URL",   "http://localhost:8080")
BOT_PASSWORD = os.getenv("BOT_PASSWORD", "bot-secret-2026")
METRICS_PORT = int(os.getenv("METRICS_PORT", "9090"))

# One account name per strategy — shared across all symbols.
# Each BotClass is paired with its fixed account username.
STRATEGIES = [
    (MarketMakerBot,    "market_maker"),
    (MomentumBot,       "momentum_trader"),
    (AlphaBot,          "alpha_trader"),
    (MeanReversionBot,  "mean_reversion"),
]


# ── Fetch symbols from the engine ─────────────────────────────────────────────

async def fetch_symbols(engine_url: str, retries: int = 10) -> List[str]:
    """GET /api/symbols with retry so bots survive a slow engine startup."""
    url = f"{engine_url}/api/symbols"
    for attempt in range(1, retries + 1):
        try:
            async with aiohttp.ClientSession() as s:
                async with s.get(url, timeout=aiohttp.ClientTimeout(total=5)) as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        syms = [
                            item["symbol"]
                            for item in (data.get("symbols") or [])
                            if item.get("symbol")
                        ]
                        if syms:
                            log.info("Fetched %d symbols: %s", len(syms), syms)
                            return syms
        except Exception as exc:
            log.warning("fetch_symbols attempt %d/%d: %s", attempt, retries, exc)
        await asyncio.sleep(3)
    raise RuntimeError(f"Could not fetch symbols from {url} after {retries} attempts")


# ── Entry point ───────────────────────────────────────────────────────────────

async def main() -> None:
    log.info("Engine  : %s", ENGINE_URL)
    log.info("Metrics : 0.0.0.0:%d", METRICS_PORT)

    symbols = await fetch_symbols(ENGINE_URL)

    # Build bot instances: one per (strategy, symbol) pair,
    # but all instances of the same strategy share ONE username.
    bots = []
    for BotClass, username in STRATEGIES:
        for sym in symbols:
            bot = BotClass(
                username=username,
                password=BOT_PASSWORD,
                symbol=sym,
                engine_url=ENGINE_URL,
            )
            # Metrics key includes symbol so each instance is addressable
            metrics.register(f"{username}:{sym}", bot)
            bots.append(bot)

    await metrics.start(port=METRICS_PORT)

    tasks = [asyncio.create_task(bot.run(), name=f"{bot.username}:{bot.symbol}") for bot in bots]
    log.info(
        "Launched %d instances  (%d strategies × %d symbols)  →  %d leaderboard accounts",
        len(bots), len(STRATEGIES), len(symbols), len(STRATEGIES),
    )

    loop = asyncio.get_running_loop()

    def _shutdown() -> None:
        log.info("Shutdown signal — cancelling all bots…")
        for t in tasks:
            t.cancel()

    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, _shutdown)

    try:
        await asyncio.gather(*tasks, return_exceptions=True)
    except asyncio.CancelledError:
        pass

    log.info("All bots stopped cleanly")


if __name__ == "__main__":
    asyncio.run(main())
