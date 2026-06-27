'use client'
import dynamic from 'next/dynamic'

// ── Old LWC mini chart (commented out, replaced by KlineChartPro) ─────────────
// const MiniChartInner = dynamic(() => import('./MiniChartInner'), {
//   ssr: false,
//   loading: () => <div style={{ flex: 1, background: '#000' }} />,
// })

const KlineProMiniInner = dynamic(() => import('./KlineProMiniInner'), {
  ssr: false,
  loading: () => <div style={{ flex: 1, background: 'var(--chart-shell-bg)' }} />,
})

interface Props {
  symbol: string
  interval?: string
  onSymbolChange?: (s: string) => void
  onIntervalChange?: (i: string) => void
  onNavigate?: () => void
  onSplitHorizontally?: () => void
  onSplitVertically?: () => void
  onClosePanel?: () => void
}

export default function MiniChart(props: Props) {
  return (
    <div style={{ display: 'flex', flex: 1, minWidth: 0, minHeight: 0, width: '100%', height: '100%', background: 'var(--chart-shell-bg)' }}>
      <KlineProMiniInner {...props} />
    </div>
  )
}
