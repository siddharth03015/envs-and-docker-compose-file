"""
BaseBot — abstract base class for all trading bots.

Responsibilities:
  • Auth (register + login with retry)
  • REST helpers  (place_limit, place_market, cancel_order, get_portfolio …)
  • WebSocket connection with auto-reconnect
  • Candle buffer seeded from REST /api/history/ohlcv, updated via WS ohlcv events
  • Periodic portfolio sync
  • Metrics snapshot for the /metrics HTTP endpoint
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from abc import ABC, abstractmethod
from collections import deque
from typing import Deque, Dict, List, Optional

import aiohttp

# Import after the package is on the path (main.py sets cwd)
try:
    from indicators import sharpe_ratio, max_drawdown
except ImportError:
    def sharpe_ratio(v): return 0.0   # type: ignore[misc]
    def max_drawdown(v):  return 0.0  # type: ignore[misc]


class BaseBot(ABC):
    # Subclasses may override
    CANDLE_INTERVAL: str = "1m"
    MAX_CANDLES:     int = 300

    def __init__(
        self,
        username:   str,
        password:   str,
        symbol:     str,
        engine_url: str,
    ) -> None:
        self.username   = username
        self.password   = password
        self.symbol     = symbol
        self.engine_url = engine_url.rstrip("/")
        self.ws_url     = (
            self.engine_url
            .replace("http://", "ws://")
            .replace("https://", "wss://")
        )

        self.token:   Optional[str]              = None
        self.session: Optional[aiohttp.ClientSession] = None

        # ── Live market state (updated by WS) ────────────────────────────
        self.candles:     Deque[dict] = deque(maxlen=self.MAX_CANDLES)
        self.live_candle: Optional[dict] = None   # current open bar
        self.ticker:      dict = {}
        self.orderbook:   dict = {"bids": [], "asks": []}

        # ── Portfolio state ───────────────────────────────────────────────
        self.cash:         float            = 100_000.0
        self.positions:    Dict[str, float] = {}   # symbol → quantity
        self.realized_pnl: float            = 0.0
        self.trade_count:  int              = 0
        self.win_count:    int              = 0
        self.loss_count:   int              = 0
        self.pnl_history:  Deque[dict]      = deque(maxlen=500)
        self._peak_value:  float            = 100_000.0   # for drawdown tracking

        self._running:      bool = False
        self._ws_connected: bool = False

        self.log = logging.getLogger(f"{self.__class__.__name__}[{username}]")

    # ── Authentication ────────────────────────────────────────────────────────

    async def _auth(self) -> None:
        """Try login first; register if needed; handle concurrent-registration race."""
        assert self.session is not None

        # 1. Try login (account may already exist from a previous run)
        async with self.session.post(
            f"{self.engine_url}/api/auth/login",
            json={"username": self.username, "password": self.password},
        ) as resp:
            if resp.status == 200:
                data = await resp.json()
                self.token = data["token"]
                self.log.info("Authenticated (login)")
                return

        # 2. Try register
        async with self.session.post(
            f"{self.engine_url}/api/auth/register",
            json={"username": self.username, "password": self.password},
        ) as resp:
            if resp.status in (200, 201):
                data = await resp.json()
                self.token = data["token"]
                self.log.info("Authenticated (register)")
                return
            # 409 = another instance of the same bot already registered this
            # account a moment ago — just login now
            if resp.status == 409:
                pass
            else:
                body = await resp.text()
                raise RuntimeError(f"Auth failed {resp.status}: {body}")

        # 3. Race: account was registered by a sibling instance — login
        async with self.session.post(
            f"{self.engine_url}/api/auth/login",
            json={"username": self.username, "password": self.password},
        ) as resp:
            if resp.status == 200:
                data = await resp.json()
                self.token = data["token"]
                self.log.info("Authenticated (login after 409 race)")
                return
            body = await resp.text()
            raise RuntimeError(f"Auth failed after register race {resp.status}: {body}")

    # ── REST helpers ──────────────────────────────────────────────────────────

    def _hdrs(self) -> dict:
        return {"Authorization": f"Bearer {self.token}"}

    async def get_portfolio(self) -> dict:
        assert self.session is not None
        async with self.session.get(
            f"{self.engine_url}/api/portfolio", headers=self._hdrs()
        ) as resp:
            return await resp.json()

    async def place_limit(
        self, side: str, price: float, qty: float
    ) -> Optional[str]:
        """Submit a LIMIT order. Returns order_id or None on failure."""
        assert self.session is not None
        try:
            async with self.session.post(
                f"{self.engine_url}/api/orders",
                headers=self._hdrs(),
                json={
                    "symbol":   self.symbol,
                    "side":     side,
                    "type":     "LIMIT",
                    "price":    round(price, 8),
                    "quantity": round(qty,   8),
                },
            ) as resp:
                if resp.status in (200, 201):
                    data = await resp.json()
                    return data.get("order_id") or data.get("id")
                self.log.debug("place_limit %s: %d %s", side, resp.status, await resp.text())
        except Exception as exc:
            self.log.debug("place_limit error: %s", exc)
        return None

    async def place_market(self, side: str, qty: float) -> Optional[str]:
        """Submit a MARKET order. Returns order_id or None on failure."""
        assert self.session is not None
        try:
            async with self.session.post(
                f"{self.engine_url}/api/orders",
                headers=self._hdrs(),
                json={
                    "symbol":   self.symbol,
                    "side":     side,
                    "type":     "MARKET",
                    "quantity": round(qty, 8),
                },
            ) as resp:
                if resp.status in (200, 201):
                    data = await resp.json()
                    return data.get("order_id") or data.get("id")
                self.log.debug("place_market %s: %d %s", side, resp.status, await resp.text())
        except Exception as exc:
            self.log.debug("place_market error: %s", exc)
        return None

    async def cancel_order(self, order_id: str) -> bool:
        assert self.session is not None
        try:
            async with self.session.delete(
                f"{self.engine_url}/api/orders/{order_id}",
                headers=self._hdrs(),
                params={"symbol": self.symbol},
            ) as resp:
                return resp.status in (200, 204)
        except Exception as exc:
            self.log.debug("cancel_order error: %s", exc)
            return False

    async def get_open_orders(self) -> List[dict]:
        assert self.session is not None
        try:
            async with self.session.get(
                f"{self.engine_url}/api/orders",
                headers=self._hdrs(),
                params={"symbol": self.symbol},
            ) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    return data.get("orders", [])
        except Exception as exc:
            self.log.debug("get_open_orders error: %s", exc)
        return []

    async def cancel_all_symbol_orders(self) -> None:
        """Fetch all open orders for this symbol and cancel them."""
        orders = await self.get_open_orders()
        for o in orders:
            await self.cancel_order(o["id"])

    # ── Data bootstrap ────────────────────────────────────────────────────────

    async def _bootstrap_candles(self) -> None:
        """
        Load historical candles on startup.
        If the primary interval has no data yet (engine just started),
        fall back through coarser intervals so the bot isn't stuck waiting.
        """
        assert self.session is not None
        fallback_intervals = [self.CANDLE_INTERVAL, "5s", "1s"]
        seen = set()
        for interval in fallback_intervals:
            if interval in seen:
                continue
            seen.add(interval)
            try:
                async with self.session.get(
                    f"{self.engine_url}/api/history/ohlcv/{self.symbol}",
                    params={"interval": interval, "limit": self.MAX_CANDLES},
                ) as resp:
                    if resp.status == 200:
                        raw     = await resp.json()
                        candles = raw.get("candles") or []   # guard against null
                        for c in candles:
                            self.candles.append(_norm_candle(c))
                        if self.candles:
                            self.log.info(
                                "Bootstrapped %d candles (interval=%s)", len(self.candles), interval
                            )
                            return
            except Exception as exc:
                self.log.warning("Bootstrap(%s) failed: %s", interval, exc)

        self.log.warning("No historical candles available yet — will build from live WS data")

    async def _sync_portfolio(self) -> None:
        try:
            data = await self.get_portfolio()
            self.cash         = float(data.get("cash", self.cash))
            self.realized_pnl = float(data.get("realized_pnl", self.realized_pnl))
            positions         = data.get("positions", {})
            self.positions    = {
                sym: float(pos.get("quantity", 0.0))
                for sym, pos in positions.items()
            }
            total = float(data.get("total_value", self.cash))
            self.pnl_history.append({"t": int(time.time() * 1000), "v": total})
        except Exception as exc:
            self.log.debug("sync_portfolio error: %s", exc)

    # ── WebSocket ─────────────────────────────────────────────────────────────

    async def _ws_loop(self) -> None:
        """Maintain a single WS connection with exponential back-off reconnect."""
        backoff = 2.0
        while self._running:
            try:
                url = f"{self.ws_url}/ws?token={self.token}&symbol={self.symbol}"
                async with self.session.ws_connect(url, heartbeat=30) as ws:  # type: ignore[union-attr]
                    self._ws_connected = True
                    backoff = 2.0
                    self.log.info("WS connected")
                    async for msg in ws:
                        if not self._running:
                            break
                        if msg.type == aiohttp.WSMsgType.TEXT:
                            try:
                                await self._handle_ws_msg(json.loads(msg.data))
                            except Exception:
                                pass
                        elif msg.type in (aiohttp.WSMsgType.CLOSED, aiohttp.WSMsgType.ERROR):
                            break
            except asyncio.CancelledError:
                return
            except Exception as exc:
                self.log.debug("WS error: %s", exc)
            finally:
                self._ws_connected = False

            if self._running:
                await asyncio.sleep(backoff)
                backoff = min(backoff * 1.5, 30.0)

    async def _handle_ws_msg(self, msg: dict) -> None:
        t = msg.get("type")

        if t == "ticker":
            self.ticker = msg

        elif t == "orderbook":
            self.orderbook = {"bids": msg.get("bids", []), "asks": msg.get("asks", [])}

        elif t == "ohlcv":
            if msg.get("interval") != self.CANDLE_INTERVAL:
                return
            raw_c  = msg.get("candle", {})
            candle = _norm_candle(raw_c)
            if msg.get("is_closed", False):
                # Only append if it's a new bar
                if not self.candles or self.candles[-1]["time"] != candle["time"]:
                    self.candles.append(candle)
                    await self.on_candle_close(candle)
            else:
                self.live_candle = candle

        elif t == "portfolio":
            snap = msg.get("data", {})
            prev_realized     = self.realized_pnl
            self.cash         = float(snap.get("cash", self.cash))
            self.realized_pnl = float(snap.get("realized_pnl", self.realized_pnl))
            positions         = snap.get("positions", {})
            self.positions    = {
                sym: float(pos.get("quantity", 0.0))
                for sym, pos in positions.items()
            }
            total = float(snap.get("total_value", self.cash))
            self.pnl_history.append({"t": int(time.time() * 1000), "v": total})
            self.trade_count += 1
            # Track peak for drawdown; infer win/loss from realized PnL change
            if total > self._peak_value:
                self._peak_value = total
            pnl_delta = self.realized_pnl - prev_realized
            if pnl_delta > 0:
                self.win_count  += 1
            elif pnl_delta < 0:
                self.loss_count += 1
            await self.on_portfolio_update(snap)

        elif t == "order_ack":
            order = msg.get("payload", {})
            await self.on_order_ack(order)

        elif t == "order_cancel":
            order = msg.get("payload", {})
            await self.on_order_cancel(order)

        await self.on_ws_msg(msg)

    # ── Hooks — override in subclasses ────────────────────────────────────────

    async def on_candle_close(self, candle: dict) -> None:
        """Called every time a candle closes (is_closed=true)."""

    async def on_portfolio_update(self, snap: dict) -> None:
        """Called when a portfolio update arrives (after a fill)."""

    async def on_order_ack(self, order: dict) -> None:
        """Called when an order is acknowledged by the engine."""

    async def on_order_cancel(self, order: dict) -> None:
        """Called when one of our orders is cancelled."""

    async def on_ws_msg(self, msg: dict) -> None:
        """Called for every WS message (after specific handlers run)."""

    # ── Strategy (must implement) ─────────────────────────────────────────────

    @abstractmethod
    async def strategy_loop(self) -> None:
        """Main strategy loop. Runs concurrently with the WS loop."""

    # ── Metrics ───────────────────────────────────────────────────────────────

    def get_metrics(self) -> dict:
        last_price = float(self.ticker.get("last_price", 0.0))
        qty        = self.positions.get(self.symbol, 0.0)
        unrealized = qty * last_price if last_price else 0.0
        total      = self.cash + sum(
            self.positions.get(s, 0.0) * last_price
            for s in self.positions
        )
        history    = list(self.pnl_history)
        values     = [p["v"] for p in history]

        # Current drawdown from peak
        cur_dd = ((self._peak_value - total) / self._peak_value) if self._peak_value > 0 else 0.0

        total_closed = self.win_count + self.loss_count
        win_rate = (self.win_count / total_closed) if total_closed > 0 else None

        return {
            "username":        self.username,
            "symbol":          self.symbol,
            "strategy":        self.__class__.__name__,
            "cash":            round(self.cash, 2),
            "position_qty":    round(qty, 6),
            "last_price":      round(last_price, 4),
            "unrealized_pnl":  round(unrealized, 2),
            "realized_pnl":    round(self.realized_pnl, 2),
            "total_value":     round(total, 2),
            "trade_count":     self.trade_count,
            "win_count":       self.win_count,
            "loss_count":      self.loss_count,
            "win_rate":        round(win_rate, 4) if win_rate is not None else None,
            "sharpe_ratio":    round(sharpe_ratio(values), 4),
            "max_drawdown":    round(max_drawdown(values), 4),
            "current_drawdown": round(cur_dd, 4),
            "ws_connected":    self._ws_connected,
            "candle_count":    len(self.candles),
            "pnl_history":     history[-60:],
        }

    # ── Lifecycle ─────────────────────────────────────────────────────────────

    async def run(self) -> None:
        self._running = True
        self.session  = aiohttp.ClientSession()
        try:
            # Auth with exponential back-off
            for attempt in range(6):
                try:
                    await self._auth()
                    break
                except Exception as exc:
                    wait = 3 * (2 ** attempt)
                    self.log.warning("Auth attempt %d failed (%s) — retry in %ds", attempt + 1, exc, wait)
                    await asyncio.sleep(wait)
            else:
                self.log.error("Could not authenticate after 6 attempts; aborting")
                return

            await self._bootstrap_candles()
            await self._sync_portfolio()

            # Run WS listener and strategy concurrently
            await asyncio.gather(
                self._ws_loop(),
                self.strategy_loop(),
            )
        except asyncio.CancelledError:
            self.log.info("Cancelled")
        finally:
            self._running = False
            await self.session.close()
            self.log.info("Stopped")

    async def stop(self) -> None:
        self._running = False


# ── Helpers ───────────────────────────────────────────────────────────────────

def _norm_candle(c: dict) -> dict:
    """Normalise a candle dict from either camelCase or lowercase keys."""
    return {
        "time":   int(c.get("time",   c.get("Time",   0))),
        "open":   float(c.get("open",   c.get("Open",   0))),
        "high":   float(c.get("high",   c.get("High",   0))),
        "low":    float(c.get("low",    c.get("Low",    0))),
        "close":  float(c.get("close",  c.get("Close",  0))),
        "volume": float(c.get("volume", c.get("Volume", 0))),
    }
