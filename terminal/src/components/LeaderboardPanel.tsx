'use client'
import { useEffect } from 'react'
import { useAuthModal } from '@/context/AuthModalContext'
import { useTerminalStore } from '@/store/terminal'
import { fetchLeaderboard } from '@/lib/market'
import { fmtUSD, fmtPct } from '@/lib/formatters'

export default function LeaderboardPanel() {
  const { user } = useAuthModal()
  const { leaderboard, setLeaderboard } = useTerminalStore()

  useEffect(() => {
    fetchLeaderboard().then(setLeaderboard).catch(() => {})
    const id = setInterval(() => fetchLeaderboard().then(setLeaderboard).catch(() => {}), 15_000)
    return () => clearInterval(id)
  }, [setLeaderboard])

  if (leaderboard.length === 0) return <div className="empty-state">Loading leaderboard…</div>

  const medals = ['🥇', '🥈', '🥉']

  return (
    <div style={{ padding: '4px 16px' }}>
      {leaderboard.map(e => {
        const pct = (e.total_value / 100_000 - 1) * 100
        const isMe = e.user_id === user?.user_id
        return (
          <div key={e.user_id} className="lb-row" style={isMe ? { background: 'rgba(52,211,153,0.04)' } : undefined}>
            <div className={`lb-rank ${e.rank === 1 ? 'lb-medal-1' : e.rank === 2 ? 'lb-medal-2' : e.rank === 3 ? 'lb-medal-3' : ''}`}>
              {e.rank <= 3 ? medals[e.rank - 1] : e.rank}
            </div>
            <div className="lb-name">
              {e.username}
              {isMe && <span className="lb-you">YOU</span>}
            </div>
            <div>
              <div className="lb-value">{fmtUSD(e.total_value)}</div>
              <div className={`lb-pct ${pct >= 0 ? 'text-buy' : 'text-sell'}`}>{fmtPct(pct)}</div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
