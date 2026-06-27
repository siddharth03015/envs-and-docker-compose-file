"""
Mean Reversion Bot — Bollinger Bands fade strategy.

Hypothesis: price tends to revert toward the mean after extreme deviations.

Entry rules (1-minute candles):
  • LONG  when close < lower Bollinger Band  (price is abnormally cheap)
  • SHORT when close > upper Bollinger Band  (price is abnormally expensive)

Exit rules (first to trigger):
  • Target:    price crosses back through the middle band  (mean reversion complete)
  • Stop-loss: 1.5 % adverse move from entry
  • Time-stop: exit after MAX_BARS_OPEN bars if neither target nor SL hit

Filters to avoid whipsaws in trending markets:
  • Only enter LONG  when RSI(14) < RSI_LOWER (confirms oversold)
  • Only enter SHORT when RSI(14) > RSI_UPPER (confirms overbought)
"""

from __future__ import annotations

import asyncio
from typing import Optional

from .base_bot import BaseBot
from indicators import bollinger, rsi


class MeanReversionBot(BaseBot):
    CANDLE_INTERVAL: str = "1m"

    # Bollinger Band parameters
    BB_PERIOD:  int   = 20
    BB_STD:     float = 2.0

    # RSI confirmation thresholds
    RSI_PERIOD: int   = 14
    RSI_LOWER:  float = 40.0   # enter LONG  only if RSI < this
    RSI_UPPER:  float = 60.0   # enter SHORT only if RSI > this

    # Risk management
    STOP_LOSS_PCT: float = 0.015   # 1.5 %
    MAX_BARS_OPEN: int   = 30      # time-stop: close after 30 bars (~30 min)

    # Position sizing
    TRADE_USD: float = 2_500.0

    # Minimum candles needed
    MIN_CANDLES: int = BB_PERIOD + RSI_PERIOD + 2

    def __init__(self, *args, **kwargs) -> None:
        super().__init__(*args, **kwargs)
        self.position_side:  Optional[str] = None   # "LONG" | "SHORT" | None
        self.entry_price:    float         = 0.0
        self.position_qty:   float         = 0.0
        self.entry_bar:      int           = 0       # candle count when we entered
        self._last_bar_processed: int      = -1

    # ── Signal computation ────────────────────────────────────────────────────

    def _signals(self) -> Optional[dict]:
        if len(self.candles) < self.MIN_CANDLES:
            return None

        closes = [c["close"] for c in self.candles]
        last   = closes[-1]

        bands = bollinger(closes, self.BB_PERIOD, self.BB_STD)
        if bands is None:
            return None
        upper, middle, lower = bands

        rsi_val = rsi(closes, self.RSI_PERIOD)
        if rsi_val is None:
            return None

        bb_width = (upper - lower) / middle if middle > 0 else 0

        return {
            "close":     last,
            "upper":     upper,
            "middle":    middle,
            "lower":     lower,
            "bb_width":  bb_width,
            "rsi":       rsi_val,
            "below_lower": last < lower,
            "above_upper": last > upper,
            "at_middle":   lower <= last <= upper,
        }

    def _qty(self, price: float) -> float:
        return round(self.TRADE_USD / price, 8) if price > 0 else 0.0

    # ── Position helpers ──────────────────────────────────────────────────────

    async def _enter_long(self, price: float, reason: str) -> None:
        qty = self._qty(price)
        if not qty:
            return
        oid = await self.place_market("BUY", qty)
        if oid:
            self.position_side = "LONG"
            self.entry_price   = price
            self.position_qty  = qty
            self.entry_bar     = len(self.candles)
            self.log.info("ENTERED LONG  qty=%.6f  entry=%.4f  [%s]", qty, price, reason)

    async def _enter_short(self, price: float, reason: str) -> None:
        qty = self._qty(price)
        if not qty:
            return
        oid = await self.place_market("SELL", qty)
        if oid:
            self.position_side = "SHORT"
            self.entry_price   = price
            self.position_qty  = qty
            self.entry_bar     = len(self.candles)
            self.log.info("ENTERED SHORT  qty=%.6f  entry=%.4f  [%s]", qty, price, reason)

    async def _close_position(self, side: str, price: float, reason: str) -> None:
        if self.position_qty <= 0:
            self._reset()
            return
        oid = await self.place_market(side, self.position_qty)
        if oid:
            self.log.info("EXITED %s  qty=%.6f  price=%.4f  [%s]",
                          self.position_side, self.position_qty, price, reason)
        self._reset()

    def _reset(self) -> None:
        self.position_side = None
        self.entry_price   = 0.0
        self.position_qty  = 0.0
        self.entry_bar     = 0

    # ── Core evaluation ───────────────────────────────────────────────────────

    async def _evaluate(self) -> None:
        bar = len(self.candles)
        if bar == self._last_bar_processed:
            return
        self._last_bar_processed = bar

        price = float(self.ticker.get("last_price", 0.0))
        if not price:
            return

        sig = self._signals()
        if not sig:
            return

        bars_open = bar - self.entry_bar

        # ── Manage open LONG ──────────────────────────────────────────────
        if self.position_side == "LONG":
            chg = (price - self.entry_price) / self.entry_price
            if chg <= -self.STOP_LOSS_PCT:
                await self._close_position("SELL", price, f"stop-loss {chg:.2%}")
                return
            if sig["at_middle"]:
                await self._close_position("SELL", price, "mean-reversion target")
                return
            if bars_open >= self.MAX_BARS_OPEN:
                await self._close_position("SELL", price, f"time-stop ({bars_open} bars)")
                return

        # ── Manage open SHORT ─────────────────────────────────────────────
        elif self.position_side == "SHORT":
            chg = (self.entry_price - price) / self.entry_price
            if chg <= -self.STOP_LOSS_PCT:
                await self._close_position("BUY", price, f"stop-loss {chg:.2%}")
                return
            if sig["at_middle"]:
                await self._close_position("BUY", price, "mean-reversion target")
                return
            if bars_open >= self.MAX_BARS_OPEN:
                await self._close_position("BUY", price, f"time-stop ({bars_open} bars)")
                return

        # ── Entry ─────────────────────────────────────────────────────────
        elif self.position_side is None:
            if sig["below_lower"] and sig["rsi"] < self.RSI_LOWER:
                await self._enter_long(
                    price,
                    f"below-lower-band RSI={sig['rsi']:.1f} lower={sig['lower']:.4f}",
                )
            elif sig["above_upper"] and sig["rsi"] > self.RSI_UPPER:
                await self._enter_short(
                    price,
                    f"above-upper-band RSI={sig['rsi']:.1f} upper={sig['upper']:.4f}",
                )

    # ── WS hook ───────────────────────────────────────────────────────────────

    async def on_candle_close(self, candle: dict) -> None:
        await self._evaluate()

    # ── Strategy loop ─────────────────────────────────────────────────────────

    async def strategy_loop(self) -> None:
        self.log.info(
            "Mean Reversion Bot starting on %s (BB%d RSI%d)",
            self.symbol, self.BB_PERIOD, self.RSI_PERIOD,
        )

        # Wait for warm-up
        while self._running:
            if len(self.candles) >= self.MIN_CANDLES and self.ticker:
                break
            await asyncio.sleep(2)

        self.log.info("Ready: %d candles, last_price=%.4f",
                      len(self.candles), float(self.ticker.get("last_price", 0)))

        # Periodic fallback evaluation
        while self._running:
            await asyncio.sleep(20)
            if self._running:
                await self._evaluate()

        self.log.info("Mean Reversion Bot stopped on %s", self.symbol)
