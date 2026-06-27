"""
Market Maker Bot

Strategy:
  • Every QUOTE_INTERVAL seconds, cancel existing bid/ask and place fresh ones
    around the current mid-price.
  • Spread = SPREAD_PCT on each side of mid.
  • Inventory skew: if net position grows toward MAX_INVENTORY, push quotes
    to encourage the exchange to reduce the position (widen the unfavourable
    side, tighten the favourable side).
  • Operates on one symbol per bot instance.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Optional

from .base_bot import BaseBot
try:
    from indicators import bollinger_width
except ImportError:
    def bollinger_width(p, **kw): return None  # type: ignore[misc]


class MarketMakerBot(BaseBot):
    SPREAD_PCT:     float = 0.0015   # 0.15 % each side → 0.30 % total spread
    QUOTE_INTERVAL: float = 0.5      # seconds between quote refreshes
    MAX_INVENTORY:  float = 1.0      # max absolute position in base asset units
    MIN_CASH_RATIO: float = 0.10     # never use more than 90 % of cash on one order

    # Target ~$500 USD per side per quote; computed from live price on first cycle
    QUOTE_VALUE_USD: float = 500.0

    def __init__(self, *args, **kwargs) -> None:
        super().__init__(*args, **kwargs)
        self._bid_id: Optional[str] = None
        self._ask_id: Optional[str] = None
        self._qty: Optional[float] = None  # computed once we see a live price

    def _resolve_qty(self, mid: float) -> float:
        """
        Derive order quantity from live mid-price so any symbol works.
        Target QUOTE_VALUE_USD per order, rounded to a sensible precision.
        """
        if mid <= 0:
            return 0.0
        raw = self.QUOTE_VALUE_USD / mid
        # Use enough decimal places to represent small fractions of expensive assets
        if raw >= 1.0:
            return round(raw, 2)
        if raw >= 0.01:
            return round(raw, 4)
        return round(raw, 6)

    # ── Mid-price from order book or last trade ───────────────────────────────

    def _mid_price(self) -> Optional[float]:
        bids = self.orderbook.get("bids", [])
        asks = self.orderbook.get("asks", [])
        if bids and asks:
            return (float(bids[0]["price"]) + float(asks[0]["price"])) / 2.0
        last = float(self.ticker.get("last_price", 0.0))
        return last if last > 0 else None

    # ── Inventory skew [-1, 1] ────────────────────────────────────────────────

    def _skew(self) -> float:
        qty     = self.positions.get(self.symbol, 0.0)
        max_inv = self.MAX_INVENTORY
        return max(-1.0, min(1.0, qty / max_inv)) if max_inv > 0 else 0.0

    # ── Quote management ──────────────────────────────────────────────────────

    async def _cancel_quotes(self) -> None:
        for oid in [self._bid_id, self._ask_id]:
            if oid:
                await self.cancel_order(oid)
        self._bid_id = None
        self._ask_id = None

    def _vol_spread(self) -> float:
        """
        Widen spread during high-volatility periods using BB width.
        Returns a multiplier >= 1.0.  Capped at 3× to avoid quoting too wide.
        """
        if len(self.candles) < 20:
            return 1.0
        closes = [c["close"] for c in self.candles]
        bw = bollinger_width(closes, period=20)
        if bw is None or bw <= 0:
            return 1.0
        # BB width ~0.01 (1%) → multiplier 1.0 baseline; each +0.5% adds 0.5×
        multiplier = 1.0 + max(0.0, (bw - 0.01) / 0.01) * 0.5
        return min(multiplier, 3.0)

    async def _place_quotes(self, mid: float) -> None:
        skew       = self._skew()
        vol_mult   = self._vol_spread()
        half_sprd  = mid * self.SPREAD_PCT * vol_mult
        qty        = self._resolve_qty(mid)

        # Skew: long → widen bid, tighten ask (to sell off inventory)
        bid_price = round(mid - half_sprd * (1.0 + 0.5 * skew),  8)
        ask_price = round(mid + half_sprd * (1.0 - 0.5 * skew),  8)

        # ── Bid ──────────────────────────────────────────────────────────────
        bid_cost = bid_price * qty
        if self.cash > bid_cost * (1.0 + self.MIN_CASH_RATIO):
            self._bid_id = await self.place_limit("BUY", bid_price, qty)
        else:
            self.log.debug("Skipping bid — insufficient cash (%.2f < %.2f)", self.cash, bid_cost)

        # ── Ask (short selling permitted) ────────────────────────────────────
        self._ask_id = await self.place_limit("SELL", ask_price, qty)

        if self._bid_id or self._ask_id:
            self.log.debug(
                "mid=%.4f  bid=%.4f id=%s  ask=%.4f id=%s  skew=%.2f",
                mid, bid_price, (self._bid_id or "–")[:8],
                ask_price, (self._ask_id or "–")[:8], skew,
            )

    # ── WS hooks ─────────────────────────────────────────────────────────────

    async def on_order_cancel(self, order: dict) -> None:
        oid = order.get("id", "")
        if oid == self._bid_id:
            self._bid_id = None
        elif oid == self._ask_id:
            self._ask_id = None

    # ── Strategy loop ─────────────────────────────────────────────────────────

    async def strategy_loop(self) -> None:
        self.log.info("Market Maker starting on %s", self.symbol)

        # Wait for initial market data
        for _ in range(40):
            if self.ticker or self.orderbook.get("bids"):
                break
            await asyncio.sleep(0.5)

        # On startup, cancel any stale orders left from a previous run
        try:
            await self.cancel_all_symbol_orders()
        except Exception:
            pass

        while self._running:
            try:
                mid = self._mid_price()
                if mid and mid > 0.0:
                    await self._cancel_quotes()
                    await self._place_quotes(mid)
                else:
                    self.log.debug("No mid-price yet, waiting…")
            except Exception as exc:
                self.log.warning("Cycle error: %s", exc)
                await self._cancel_quotes()

            await asyncio.sleep(self.QUOTE_INTERVAL)

        # Cleanup
        await self._cancel_quotes()
        self.log.info("Market Maker stopped on %s", self.symbol)
