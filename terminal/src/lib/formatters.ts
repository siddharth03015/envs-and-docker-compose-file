export const fmtPrice = (v: number, dp = 2) =>
  (v ?? 0).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp })

export const fmtQty = (v: number, dp = 4) =>
  (v ?? 0).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp })

export const fmtUSD = (v: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(v ?? 0)

// For USD totals (market cap etc.)
export const fmtCompact = (v: number) => {
  const a = Math.abs(v ?? 0)
  if (a >= 1e12) return `$${(v / 1e12).toFixed(2)}T`
  if (a >= 1e9)  return `$${(v / 1e9).toFixed(2)}B`
  if (a >= 1e6)  return `$${(v / 1e6).toFixed(2)}M`
  return fmtUSD(v)
}

// For asset volume (no dollar sign)
export const fmtVol = (v: number) => {
  const a = Math.abs(v ?? 0)
  if (a >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`
  if (a >= 1_000)     return `${(v / 1_000).toFixed(2)}K`
  if (a >= 1)         return v.toFixed(2)
  return v.toFixed(4)
}

export const fmtPct = (v: number, showSign = true) =>
  `${showSign && (v ?? 0) > 0 ? '+' : ''}${(v ?? 0).toFixed(2)}%`

export const fmtPnL = (v: number) => `${(v ?? 0) >= 0 ? '+' : ''}${fmtUSD(v)}`

export const fmtTime = (ms: number) =>
  new Date(ms).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })

export const fmtDateTime = (ms: number) =>
  new Date(ms).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
