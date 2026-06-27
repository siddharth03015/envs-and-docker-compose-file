"""
Momentum Bot — MACD crossover + EMA(50) trend filter.

Uses 5-second candles so it warms up in ~3 minutes instead of 35.

Entry rules:
  • LONG  when MACD line crosses above signal line AND price > EMA(50)
  • SHORT when MACD line crosses below signal line AND price < EMA(50)

Exit rules (first to trigger):
  • Stop-loss:    1.5 % adverse move
  • Take-profit:  3.0 % favourable move
  • Trend flip:   EMA(50) crosses against the position direction
"""

from __future__ import annotations

import asyncio
from typing import Optional

from .base_bot import BaseBot
from indicators import macd, ema, crossover


class MomentumBot(BaseBot):
    CANDLE_INTERVAL: str = "5s"   # fast warm-up: needs ~(26+9)*5s ≈ 3 min

    # MACD parameters
    MACD_FAST:   int = 12
    MACD_SLOW:   int = 26
    MACD_SIGNAL: int = 9

    # Trend filter
    EMA_TREND: int = 50           # ~4 min of 5s bars

    # Risk management
    STOP_LOSS_PCT:   float = 0.015  # 1.5 %
    TAKE_PROFIT_PCT: float = 0.030  # 3.0 %

    # Position sizing — fixed USD value per trade
    TRADE_USD: float = 2_500.0

    MIN_CANDLES: int = EMA_TREND + MACD_SLOW + MACD_SIGNAL + 2

    def __init__(self, *args, **kwargs) -> None:
        super().__init__(*args, **kwargs)
        self.position_side: Optional[str] = None   # "LONG" | "SHORT" | None
        self.entry_price:   float         = 0.0
        self.position_qty:  float         = 0.0
        self._last_bar_processed: int     = -1

    # ── Signal computation ────────────────────────────────────────────────────

    def _signals(self) -> Optional[dict]:
        if len(self.candles) < self.MIN_CANDLES:
            return None

        closes = [c["close"] for c in self.candles]

        macd_line, sig_line, histogram = macd(closes, self.MACD_FAST, self.MACD_SLOW, self.MACD_SIGNAL)
        if None in (macd_line, sig_line, histogram):
            return None

        ema_trend = ema(closes, self.EMA_TREND)
        trend_val = next((v for v in reversed(ema_trend) if v is not None), None)
        if trend_val is None:
            return None

        last_close = closes[-1]

        # Detect MACD crossover using last two MACD and signal values
        # We rebuild a mini 2-element list to reuse the crossover() helper
        # by comparing the sign of histogram[-2] vs histogram[-1]
        # (simpler than tracking full MACD line history)
        prev_hist = _prev_histogram(closes, self.MACD_FAST, self.MACD_SLOW, self.MACD_SIGNAL)

        if prev_hist is None:
            return None

        bullish_cross = prev_hist <= 0 and histogram > 0   # type: ignore[operator]
        bearish_cross = prev_hist >= 0 and histogram < 0   # type: ignore[operator]

        return {
            "macd":          macd_line,
            "signal":        sig_line,
            "histogram":     histogram,
            "prev_histogram": prev_hist,
            "ema_trend":     trend_val,
            "trend_up":      last_close > trend_val,
            "trend_down":    last_close < trend_val,
            "bullish_cross": bullish_cross,
            "bearish_cross": bearish_cross,
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

        # ── SL / TP ───────────────────────────────────────────────────────
        if self.position_side == "LONG" and self.entry_price:
            chg = (price - self.entry_price) / self.entry_price
            if chg <= -self.STOP_LOSS_PCT:
                await self._close_position("SELL", price, f"stop-loss {chg:.2%}")
                return
            if chg >= self.TAKE_PROFIT_PCT:
                await self._close_position("SELL", price, f"take-profit {chg:.2%}")
                return

        if self.position_side == "SHORT" and self.entry_price:
            chg = (self.entry_price - price) / self.entry_price
            if chg <= -self.STOP_LOSS_PCT:
                await self._close_position("BUY", price, f"stop-loss {chg:.2%}")
                return
            if chg >= self.TAKE_PROFIT_PCT:
                await self._close_position("BUY", price, f"take-profit {chg:.2%}")
                return

        # ── Entry ─────────────────────────────────────────────────────────
        if self.position_side is None:
            if sig["bullish_cross"] and sig["trend_up"]:
                await self._enter_long(price, f"MACD↑ EMA_trend_up hist={sig['histogram']:.4f}")
            elif sig["bearish_cross"] and sig["trend_down"]:
                await self._enter_short(price, f"MACD↓ EMA_trend_down hist={sig['histogram']:.4f}")

        # ── Trend-flip exit ───────────────────────────────────────────────
        elif self.position_side == "LONG" and sig["trend_down"]:
            await self._close_position("SELL", price, "trend-flip bearish")
        elif self.position_side == "SHORT" and sig["trend_up"]:
            await self._close_position("BUY", price, "trend-flip bullish")

    # ── WS hook ───────────────────────────────────────────────────────────────

    async def on_candle_close(self, candle: dict) -> None:
        await self._evaluate()

    # ── Strategy loop ─────────────────────────────────────────────────────────

    async def strategy_loop(self) -> None:
        self.log.info("Momentum Bot starting on %s (interval=%s)", self.symbol, self.CANDLE_INTERVAL)

        while self._running:
            if len(self.candles) >= self.MIN_CANDLES and self.ticker:
                break
            await asyncio.sleep(1)

        self.log.info("Ready: %d candles, warming up complete", len(self.candles))

        # Periodic fallback in case candle WS events are missed
        while self._running:
            await asyncio.sleep(15)
            if self._running:
                await self._evaluate()

        self.log.info("Momentum Bot stopped on %s", self.symbol)


# ── Helper: previous MACD histogram ──────────────────────────────────────────

def _prev_histogram(
    prices: list,
    fast: int, slow: int, signal: int,
) -> Optional[float]:
    """
    Compute histogram for prices[:-1] to detect a crossover vs the current bar.
    """
    if len(prices) < slow + signal + 2:
        return None
    from indicators import macd as _macd
    _, _, h = _macd(prices[:-1], fast, slow, signal)
    return h
