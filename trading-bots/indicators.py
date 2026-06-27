"""
Technical indicators — pure functions, no external deps.
All functions operate on a list of floats (close prices or otherwise).
"""

from __future__ import annotations
from typing import List, Optional, Tuple


def ema(prices: List[float], period: int) -> List[Optional[float]]:
    """
    Exponential Moving Average.
    Returns a list the same length as prices; first (period-1) values are None.
    """
    n = len(prices)
    result: List[Optional[float]] = [None] * n
    if n < period:
        return result
    k = 2.0 / (period + 1)
    result[period - 1] = sum(prices[:period]) / period
    for i in range(period, n):
        prev = result[i - 1]
        assert prev is not None
        result[i] = prices[i] * k + prev * (1.0 - k)
    return result


def rsi(prices: List[float], period: int = 14) -> Optional[float]:
    """
    Wilder's RSI for the most recent data point.
    Returns None if there aren't enough candles.
    """
    if len(prices) < period + 1:
        return None

    deltas = [prices[i] - prices[i - 1] for i in range(1, len(prices))]
    gains  = [max(d, 0.0) for d in deltas]
    losses = [max(-d, 0.0) for d in deltas]

    avg_gain = sum(gains[:period]) / period
    avg_loss = sum(losses[:period]) / period

    for i in range(period, len(gains)):
        avg_gain = (avg_gain * (period - 1) + gains[i]) / period
        avg_loss = (avg_loss * (period - 1) + losses[i]) / period

    if avg_loss == 0.0:
        return 100.0
    rs = avg_gain / avg_loss
    return 100.0 - (100.0 / (1.0 + rs))


def bollinger(
    prices: List[float], period: int = 20, num_std: float = 2.0
) -> Optional[Tuple[float, float, float]]:
    """
    Bollinger Bands for the most recent point.
    Returns (upper, middle, lower) or None if not enough data.
    """
    if len(prices) < period:
        return None
    window  = prices[-period:]
    mid     = sum(window) / period
    std     = (sum((p - mid) ** 2 for p in window) / period) ** 0.5
    return (mid + num_std * std, mid, mid - num_std * std)


def bollinger_width(prices: List[float], period: int = 20, num_std: float = 2.0) -> Optional[float]:
    """
    Normalised Bollinger Band width = (upper - lower) / middle.
    Useful as a volatility proxy for spread adjustment.
    """
    bands = bollinger(prices, period, num_std)
    if bands is None or bands[1] == 0:
        return None
    return (bands[0] - bands[2]) / bands[1]


def macd(
    prices: List[float],
    fast: int = 12,
    slow: int = 26,
    signal: int = 9,
) -> Tuple[Optional[float], Optional[float], Optional[float]]:
    """
    MACD indicator for the most recent point.

    Returns (macd_line, signal_line, histogram) or (None, None, None)
    if there isn't enough data.

    Algorithm:
      macd_line  = EMA(fast) - EMA(slow)   [computed across full price series]
      signal_line = EMA(macd_line, signal)
      histogram   = macd_line - signal_line
    """
    if len(prices) < slow + signal:
        return None, None, None

    ema_fast = ema(prices, fast)
    ema_slow = ema(prices, slow)

    # Build MACD line only where both EMAs exist
    macd_line: List[Optional[float]] = []
    for f, s in zip(ema_fast, ema_slow):
        if f is None or s is None:
            macd_line.append(None)
        else:
            macd_line.append(f - s)

    # Extract the valid (non-None) segment for signal EMA calculation
    valid_values: List[float] = [m for m in macd_line if m is not None]
    if len(valid_values) < signal:
        return None, None, None

    signal_values = ema(valid_values, signal)
    sig_curr = signal_values[-1]
    sig_prev = signal_values[-2] if len(signal_values) >= 2 else None

    macd_curr = macd_line[-1]
    macd_prev = next((m for m in reversed(macd_line[:-1]) if m is not None), None)

    if None in (macd_curr, macd_prev, sig_curr, sig_prev):
        return None, None, None

    histogram = macd_curr - sig_curr  # type: ignore[operator]
    return macd_curr, sig_curr, histogram


def crossover(
    fast: List[Optional[float]], slow: List[Optional[float]]
) -> Optional[bool]:
    """
    Detects a crossover on the last two bars.
    Returns True  = bullish (fast crossed above slow)
            False = bearish (fast crossed below slow)
            None  = no cross this bar
    """
    if len(fast) < 2 or len(slow) < 2:
        return None
    f_curr, f_prev = fast[-1], fast[-2]
    s_curr, s_prev = slow[-1], slow[-2]
    if None in (f_curr, f_prev, s_curr, s_prev):
        return None
    if f_prev <= s_prev and f_curr > s_curr:  # type: ignore[operator]
        return True
    if f_prev >= s_prev and f_curr < s_curr:  # type: ignore[operator]
        return False
    return None


def sharpe_ratio(values: List[float]) -> float:
    """
    Simplified Sharpe ratio from a series of portfolio values.
    Uses period-over-period returns; not annualised (time steps are irregular).
    Returns 0.0 if there isn't enough data.
    """
    if len(values) < 3:
        return 0.0
    returns = [
        (values[i] - values[i - 1]) / values[i - 1]
        for i in range(1, len(values))
        if values[i - 1] != 0
    ]
    if len(returns) < 2:
        return 0.0
    mean_r = sum(returns) / len(returns)
    std_r  = (sum((r - mean_r) ** 2 for r in returns) / len(returns)) ** 0.5
    return (mean_r / std_r) if std_r > 0 else 0.0


def max_drawdown(values: List[float]) -> float:
    """
    Maximum drawdown as a positive fraction (e.g. 0.05 = 5 % drawdown).
    Returns 0.0 if not enough data.
    """
    if len(values) < 2:
        return 0.0
    peak = values[0]
    mdd  = 0.0
    for v in values:
        if v > peak:
            peak = v
        if peak > 0:
            dd = (peak - v) / peak
            if dd > mdd:
                mdd = dd
    return mdd
