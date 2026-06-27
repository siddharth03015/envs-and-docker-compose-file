'use client'
import dynamic from 'next/dynamic'

const KlineProInner = dynamic(() => import('./KlineProInner'), {
  ssr: false,
  loading: () => <div style={{ flex: 1, background: 'var(--chart-shell-bg)' }} />,
})

interface Props { symbol: string }

export default function KlineProChart({ symbol }: Props) {
  return (
    <div style={{ flex: 1, display: 'flex', minWidth: 0, minHeight: 0, width: '100%', height: '100%', background: 'var(--chart-shell-bg)' }}>
      <KlineProInner symbol={symbol} />
    </div>
  )
}
