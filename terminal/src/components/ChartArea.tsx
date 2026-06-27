'use client'
import dynamic from 'next/dynamic'

// ── Old LWC chart (commented out, replaced by KlineChartPro) ─────────────────
// const ChartAreaInner = dynamic(() => import('./ChartAreaInner'), {
//   ssr: false,
//   loading: () => <div style={{ flex: 1, background: '#000' }} />,
// })

const KlineProInner = dynamic(() => import('./KlineProInner'), {
  ssr: false,
  loading: () => <div style={{ flex: 1, background: 'var(--chart-shell-bg)' }} />,
})

interface Props { symbol: string }

export default function ChartArea({ symbol }: Props) {
  return (
    <div style={{ flex: 1, display: 'flex', minWidth: 0, minHeight: 0, width: '100%', height: '100%', background: 'var(--chart-shell-bg)' }}>
      <KlineProInner symbol={symbol} />
    </div>
  )
}
