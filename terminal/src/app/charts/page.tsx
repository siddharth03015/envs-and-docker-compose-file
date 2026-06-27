'use client'
import { useCallback, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useAuthModal } from '@/context/AuthModalContext'
import { useTerminalStore } from '@/store/terminal'
import type { LayoutNode } from '@/store/chartLayout'
import { KB_EVENT_CHART_FULLSCREEN, KB_EVENT_CHARTS_UNDO } from '@/hooks/useKeyboardShortcuts'
import Header from '@/components/Header'
import wsManager from '@/ws/manager'
import { useChartLayoutStore } from '@/store/chartLayout'
import { SplitNode } from './SplitNode'

export default function ChartsPage() {
  const router                = useRouter()
  const { user, initialized } = useAuthModal()
  const { setSymbol }         = useTerminalStore()
  
  const tree = useChartLayoutStore(s => s.tree)
  const activePanelId = useChartLayoutStore(s => s.activePanelId)
  const undo = useChartLayoutStore(s => s.undo)
  const canUndo = useChartLayoutStore(s => s.canUndo)

  const chartsContainerRef = useRef<HTMLDivElement>(null)

  // One-time symbol injection can be handled at store layer, but we leave the defaults
  // via localstorage/defaultTree.
  useEffect(() => {
    if (initialized && !user) router.replace('/')
  }, [initialized, user, router])

  const navigateToTrade = (sym: string) => {
    setSymbol(sym)
    wsManager.changeSymbol(sym)
    router.push('/trade')
  }

  // To find currently active symbol for the "Terminal" button:
  // Using a quick lookup on the tree
  const getActiveSymbol = (node: LayoutNode | null, targetId: string | null): string => {
    if (!targetId || !node) return 'BTC-USD';
    if (node.type === 'leaf') return node.id === targetId ? node.panelState.symbol : '';
    const left = getActiveSymbol(node.children[0], targetId);
    if (left) return left;
    return getActiveSymbol(node.children[1], targetId) || 'BTC-USD';
  }

  const activeSymbol = getActiveSymbol(tree, activePanelId) || 'BTC-USD'

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      chartsContainerRef.current?.requestFullscreen().catch(err => console.error(err))
    } else {
      document.exitFullscreen()
    }
  }, [])

  useEffect(() => {
    const onChartFullscreen = () => {
      toggleFullscreen()
    }

    document.addEventListener(KB_EVENT_CHART_FULLSCREEN, onChartFullscreen)
    return () => document.removeEventListener(KB_EVENT_CHART_FULLSCREEN, onChartFullscreen)
  }, [toggleFullscreen])

  useEffect(() => {
    const onChartUndo = () => {
      if (canUndo) undo()
    }

    document.addEventListener(KB_EVENT_CHARTS_UNDO, onChartUndo)
    return () => document.removeEventListener(KB_EVENT_CHARTS_UNDO, onChartUndo)
  }, [canUndo, undo])

  if (!initialized || !user) return null

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--chart-shell-bg)', overflow: 'hidden' }}>
      <Header />
      <div style={{ height: 56, flexShrink: 0 }} />

      {/* Main Container that can go fullscreen */}
      <div ref={chartsContainerRef} style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, background: 'var(--chart-shell-bg)' }}>
        
        {/* Top bar */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '0 16px', height: 36, flexShrink: 0,
          borderBottom: '1px solid var(--chart-shell-border)',
          background: 'var(--chart-shell-elevated)',
        }}>
          <span style={{ fontSize: 10, color: 'var(--chart-text-muted-strong)', textTransform: 'uppercase', letterSpacing: '0.8px', fontFamily: 'var(--font-mono)' }}>
            Multi-Chart View
          </span>
          <button
            onClick={undo}
            disabled={!canUndo}
            style={{
              fontSize: 10, padding: '3px 10px', marginLeft: 16,
              background: canUndo ? 'var(--chart-toolbar-btn-bg)' : 'var(--chart-toolbar-btn-bg-disabled)',
              border: '1px solid var(--chart-toolbar-btn-border)',
              color: canUndo ? 'var(--text-main)' : 'var(--chart-toolbar-btn-text-disabled)',
              borderRadius: 2, cursor: canUndo ? 'pointer' : 'not-allowed', fontFamily: 'var(--font-mono)',
              transition: 'all 0.2s'
            }}
          >
            ↶ Undo
          </button>
          
          <div style={{ flex: 1 }} />
          
          <button
            onClick={toggleFullscreen}
            title="Toggle Fullscreen"
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 24, height: 24,
              background: 'transparent',
              border: 'none', color: 'var(--chart-text-muted-strong)', cursor: 'pointer',
              borderRadius: 4, transition: 'background 0.2s, color 0.2s', marginRight: 4
            }}
            onMouseEnter={e => { e.currentTarget.style.color = 'var(--text-main)'; e.currentTarget.style.background = 'var(--chart-toolbar-btn-hover-bg)' }}
            onMouseLeave={e => { e.currentTarget.style.color = 'var(--chart-text-muted-strong)'; e.currentTarget.style.background = 'transparent' }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
            </svg>
          </button>

          <button
            onClick={() => navigateToTrade(activeSymbol)}
            style={{
              fontSize: 10, padding: '3px 10px',
              background: 'rgba(52,211,153,0.1)', border: '1px solid rgba(52,211,153,0.25)',
              color: '#34d399', borderRadius: 2, cursor: 'pointer', fontFamily: 'var(--font-mono)',
            }}
          >
            → Terminal
          </button>
        </div>

        {/* Recursive chart layout */}
        <div className="split-chart-layout" style={{
          flex: 1, minHeight: 0,
          display: 'flex',
          background: 'var(--chart-split-bg)',
        }}>
          <SplitNode node={tree} navigateToTrade={navigateToTrade} />
        </div>
      </div>
    </div>
  )
}
