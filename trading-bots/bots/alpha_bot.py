"""
Alpha Bot — Directional / Trend-following strategy

Signals:
  • Candle interval: 1 minute
  • Indicators: RSI(14), EMA(9) vs EMA(21)

Entry rules:
  • BUY  when EMA9 crosses above EMA21  AND  RSI is below RSI_UPPER (not overbought)
  • SELL when EMA9 crosses below EMA21  AND  RSI is above RSI_LOWER (not oversold)

Exit rules (whichever triggers first):
  • Stop-loss:   2 % adverse move from entry price
  • Take-profit: 4 % favourable move from entry price
  • Signal reversal: opposite crossover while in position

Position sizing: fixed USD value per trade (TRADE_USD), converted to qty at
current price.  Short selling is fully supported.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Optional

from .base_bot import BaseBot
from indicators import ema, rsi, crossover


class AlphaBot(BaseBot):
    CANDLE_INTERVAL: str = "1m"

    # Indicator parameters
    RSI_PERIOD: int   = 14
    EMA_FAST:   int   = 9
    EMA_SLOW:   int   = 21

    # Signal thresholds (relaxed slightly to generate more trades in competition)
    RSI_UPPER: float = 70.0   # do not enter long if RSI is overbought
    RSI_LOWER: float = 30.0   # do not enter short if RSI is oversold

    # Risk management
    STOP_LOSS_PCT:   float = 0.02   # 2 %
    TAKE_PROFIT_PCT: float = 0.04   # 4 %

    # Position sizing — fixed USD value per trade
    TRADE_USD: float = 3_000.0

    # Minimum candles needed before trading
    MIN_CANDLES: int = EMA_SLOW + RSI_PERIOD + 5

    def __init__(self, *args, **kwargs) -> None:
        super().__init__(*args, **kwargs)

        self.position_side: Optional[str] = None  # "LONG" | "SHORT" | None
        self.entry_price:   float         = 0.0
        self.position_qty:  float         = 0.0

        self._last_bar_processed: int = -1  # guard against duplicate processing

    # ── Signal computation ────────────────────────────────────────────────────

    def _signals(self) -> Optional[dict]:
        if len(self.candles) < self.MIN_CANDLES:
            return None

        closes = [c["close"] for c in self.candles]

        rsi_val    = rsi(closes, self.RSI_PERIOD)
        ema_fast_v = ema(closes, self.EMA_FAST)
        ema_slow_v = ema(closes, self.EMA_SLOW)

        cross = crossover(ema_fast_v, ema_slow_v)

        if rsi_val is None:
            return None

        # Latest valid EMAs
        ema_f = next((v for v in reversed(ema_fast_v) if v is not None), None)
        ema_s = next((v for v in reversed(ema_slow_v) if v is not None), None)
        if ema_f is None or ema_s is None:
            return None

        return {
            "rsi":          rsi_val,
            "ema_fast":     ema_f,
            "ema_slow":     ema_s,
            "trend_up":     ema_f > ema_s,
            "trend_down":   ema_f < ema_s,
            "bullish_cross": cross is True,
            "bearish_cross": cross is False,
        }

    def _qty_for(self, price: float) -> float:
        if price <= 0.0:
            return 0.0
        return round(self.TRADE_USD / price, 8)

    # ── Position management ───────────────────────────────────────────────────

    async def _enter_long(self, price: float, reason: str) -> None:
        qty = self._qty_for(price)
        if qty <= 0.0:
            return
        oid = await self.place_market("BUY", qty)
        if oid:
            self.position_side = "LONG"
            self.entry_price   = price
            self.position_qty  = qty
            self.log.info(
                "ENTERED LONG  qty=%.6f  entry=%.4f  reason=%s",
                qty, price, reason,
            )

    async def _enter_short(self, price: float, reason: str) -> None:
        qty = self._qty_for(price)
        if qty <= 0.0:
            return
        oid = await self.place_market("SELL", qty)
        if oid:
            self.position_side = "SHORT"
            self.entry_price   = price
            self.position_qty  = qty
            self.log.info(
                "ENTERED SHORT  qty=%.6f  entry=%.4f  reason=%s",
                qty, price, reason,
            )

    async def _exit_position(self, side: str, price: float, reason: str) -> None:
        if self.position_qty <= 0.0:
            self._reset_position()
            return
        oid = await self.place_market(side, self.position_qty)
        if oid:
            self.log.info(
                "EXITED %s  qty=%.6f  price=%.4f  reason=%s",
                self.position_side, self.position_qty, price, reason,
            )
        self._reset_position()

    def _reset_position(self) -> None:
        self.position_side = None
        self.entry_price   = 0.0
        self.position_qty  = 0.0

    # ── Core evaluation ───────────────────────────────────────────────────────

    async def _evaluate(self) -> None:
        current_bar = len(self.candles)
        if current_bar == self._last_bar_processed:
            return
        self._last_bar_processed = current_bar

        last_price = float(self.ticker.get("last_price", 0.0))
        if last_price <= 0.0:
            return

        sig = self._signals()
        if not sig:
            return

        # ── Check stop-loss / take-profit on open position ────────────────
        if self.position_side == "LONG" and self.entry_price > 0.0:
            chg = (last_price - self.entry_price) / self.entry_price
            if chg <= -self.STOP_LOSS_PCT:
                await self._exit_position("SELL", last_price, f"stop-loss ({chg:.2%})")
                return
            if chg >= self.TAKE_PROFIT_PCT:
                await self._exit_position("SELL", last_price, f"take-profit ({chg:.2%})")
                return

        if self.position_side == "SHORT" and self.entry_price > 0.0:
            chg = (self.entry_price - last_price) / self.entry_price
            if chg <= -self.STOP_LOSS_PCT:
                await self._exit_position("BUY", last_price, f"stop-loss ({chg:.2%})")
                return
            if chg >= self.TAKE_PROFIT_PCT:
                await self._exit_position("BUY", last_price, f"take-profit ({chg:.2%})")
                return

        # ── Signal-driven entry / reversal ────────────────────────────────
        if self.position_side is None:
            if sig["bullish_cross"] and sig["rsi"] < self.RSI_UPPER:
                await self._enter_long(last_price, f"ema-cross + RSI={sig['rsi']:.1f}")
            elif sig["bearish_cross"] and sig["rsi"] > self.RSI_LOWER:
                await self._enter_short(last_price, f"ema-cross + RSI={sig['rsi']:.1f}")

        elif self.position_side == "LONG" and sig["bearish_cross"]:
            await self._exit_position("SELL", last_price, "signal-reversal")

        elif self.position_side == "SHORT" and sig["bullish_cross"]:
            await self._exit_position("BUY", last_price, "signal-reversal")

    # ── WS hook: called on every candle close ─────────────────────────────────

    async def on_candle_close(self, candle: dict) -> None:
        await self._evaluate()

    # ── Strategy loop ─────────────────────────────────────────────────────────

    async def strategy_loop(self) -> None:
        self.log.info("Alpha Bot starting on %s", self.symbol)

        # Wait until we have enough candles + ticker data
        while self._running:
            if len(self.candles) >= self.MIN_CANDLES and self.ticker:
                break
            await asyncio.sleep(2)

        self.log.info(
            "Ready: %d candles, last_price=%.4f",
            len(self.candles),
            float(self.ticker.get("last_price", 0)),
        )

        # Periodic fallback evaluation (handles gaps between candle closes)
        while self._running:
            await asyncio.sleep(30)
            if self._running:
                await self._evaluate()

        self.log.info("Alpha Bot stopped on %s", self.symbol)
