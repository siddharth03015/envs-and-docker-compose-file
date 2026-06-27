import type { Candle } from '@/types'

export function calcEMA(closes: number[], period: number): (number | null)[] {
  if (closes.length < period) return closes.map(() => null)
  const k = 2 / (period + 1)
  const result: (number | null)[] = new Array(period - 1).fill(null)
  let ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period
  result.push(ema)
  for (let i = period; i < closes.length; i++) {
    ema = closes[i] * k + ema * (1 - k)
    result.push(ema)
  }
  return result
}

export function calcBB(closes: number[], period = 20, std = 2) {
  return closes.map((_, i) => {
    if (i < period - 1) return { upper: null, middle: null, lower: null }
    const sl = closes.slice(i - period + 1, i + 1)
    const mean = sl.reduce((a, b) => a + b, 0) / period
    const variance = sl.reduce((s, v) => s + (v - mean) ** 2, 0) / period
    const sigma = Math.sqrt(variance)
    return { upper: mean + std * sigma, middle: mean, lower: mean - std * sigma }
  })
}

export function calcRSI(closes: number[], period = 14): (number | null)[] {
  if (closes.length <= period) return closes.map(() => null)
  const result: (number | null)[] = new Array(period).fill(null)
  const changes = closes.slice(1).map((c, i) => c - closes[i])
  let avgGain = changes.slice(0, period).filter(c => c > 0).reduce((a, b) => a + b, 0) / period
  let avgLoss = Math.abs(changes.slice(0, period).filter(c => c < 0).reduce((a, b) => a + b, 0)) / period
  const rsi = (ag: number, al: number) => al === 0 ? 100 : 100 - 100 / (1 + ag / al)
  result.push(rsi(avgGain, avgLoss))
  for (let i = period; i < changes.length; i++) {
    const gain = changes[i] > 0 ? changes[i] : 0
    const loss = changes[i] < 0 ? -changes[i] : 0
    avgGain = (avgGain * (period - 1) + gain) / period
    avgLoss = (avgLoss * (period - 1) + loss) / period
    result.push(rsi(avgGain, avgLoss))
  }
  return result
}

export interface MACDPoint { macd: number | null; signal: number | null; histogram: number | null }

export function calcMACD(closes: number[], fast = 12, slow = 26, signal = 9): MACDPoint[] {
  const emaFast  = calcEMA(closes, fast)
  const emaSlow  = calcEMA(closes, slow)
  const macdLine = closes.map((_, i) =>
    emaFast[i] != null && emaSlow[i] != null ? emaFast[i]! - emaSlow[i]! : null
  )
  const start = macdLine.findIndex(v => v !== null)
  const result: MACDPoint[] = macdLine.map(() => ({ macd: null, signal: null, histogram: null }))
  if (start === -1) return result
  const vals    = macdLine.slice(start) as number[]
  const sigLine = calcEMA(vals, signal)
  for (let i = 0; i < vals.length; i++) {
    const m = vals[i]; const s = sigLine[i]
    result[start + i] = { macd: m, signal: s, histogram: m != null && s != null ? m - s : null }
  }
  return result
}

export function candleIndicators(candles: Candle[]) {
  const closes = candles.map(c => c.close)
  return {
    ema9:  calcEMA(closes, 9),
    ema20: calcEMA(closes, 20),
    ema50: calcEMA(closes, 50),
    bb:    calcBB(closes),
    rsi:   calcRSI(closes),
    macd:  calcMACD(closes),
  }
}
