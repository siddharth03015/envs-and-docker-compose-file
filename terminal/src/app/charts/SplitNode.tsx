'use client'

import React, { useEffect, useRef } from 'react'
import { LayoutNode, useChartLayoutStore } from '@/store/chartLayout'
import ResizeHandle from '@/components/ResizeHandle'
import MiniChart from '@/components/MiniChart'

interface SplitNodeProps {
  node: LayoutNode
  navigateToTrade: (sym: string) => void
}

const MIN_PIXEL_SIZE = 200
const RESIZE_HANDLE_SIZE = 8

export const SplitNode = React.memo(({ node, navigateToTrade }: SplitNodeProps) => {
  const {
    activePanelId,
    setActivePanel,
    splitPanel,
    closePanel,
    updateSplitRatio,
    updatePanelState,
    tree,
    saveHistoryPoint
  } = useChartLayoutStore()

  const containerRef = useRef<HTMLDivElement>(null)
  const resizeRafRef = useRef<number | null>(null)
  
  // To avoid jitter, track ratio and displacement off drag start
  const dragStateRef = useRef<{ initialRatio: number; accumulatedDelta: number } | null>(null)

  const scheduleChartResize = () => {
    if (typeof window === 'undefined') return
    if (resizeRafRef.current !== null) return

    resizeRafRef.current = window.requestAnimationFrame(() => {
      resizeRafRef.current = null
      window.dispatchEvent(new Event('resize'))
    })
  }

  useEffect(() => {
    return () => {
      if (resizeRafRef.current !== null) {
        window.cancelAnimationFrame(resizeRafRef.current)
      }
    }
  }, [])

  // Track if this node is the only and final panel remaining
  const isLastPanel = tree.type === 'leaf' && tree.id === node.id

  if (node.type === 'leaf') {
    const isActive = activePanelId === node.id
    return (
      <div 
        onClick={(e) => {
          e.stopPropagation()
          setActivePanel(node.id)
        }}
        style={{
          flex: 1, 
          display: 'flex', 
          flexDirection: 'column', 
          minWidth: 0, 
          minHeight: 0,
          overflow: 'hidden',
          background: 'var(--chart-shell-bg)',
          position: 'relative',
          boxSizing: 'border-box',
          border: isActive ? '1px solid #34d399' : '1px solid var(--chart-shell-border-soft)',
          transition: 'border 0.2s',
        }}
      >
        <MiniChart
          symbol={node.panelState.symbol}
          interval={node.panelState.interval}
          onSymbolChange={s => updatePanelState(node.id, { symbol: s })}
          onIntervalChange={iv => updatePanelState(node.id, { interval: iv })}
          onNavigate={() => navigateToTrade(node.panelState.symbol)}
          onSplitHorizontally={() => splitPanel(node.id, 'col')}
          onSplitVertically={() => splitPanel(node.id, 'row')}
          onClosePanel={!isLastPanel ? () => closePanel(node.id) : undefined}
        />
      </div>
    )
  }

  // Split node processing
  const isRowSplit = node.direction === 'row'
  
  const onDragStart = () => {
    saveHistoryPoint()
    dragStateRef.current = {
      initialRatio: node.ratio,
      accumulatedDelta: 0
    }
  }

  const handleResize = (deltaPx: number) => {
    if (!containerRef.current || !dragStateRef.current) return
    const rect = containerRef.current.getBoundingClientRect()
    
    // For 'row' direction (flex-direction: column), we drag vertically
    // For 'col' direction (flex-direction: row), we drag horizontally
    const totalSize = isRowSplit ? rect.height : rect.width
    const availableSize = Math.max(1, totalSize - RESIZE_HANDLE_SIZE)
    
    let minRatioClamp = 0.15
    let maxRatioClamp = 0.85

    const minRatioFromPixels = MIN_PIXEL_SIZE / availableSize
    if (minRatioFromPixels <= 0.5) {
      minRatioClamp = Math.max(minRatioClamp, minRatioFromPixels)
      maxRatioClamp = Math.min(maxRatioClamp, 1 - minRatioFromPixels)
    } else {
      // If space is too small to satisfy both minimum panel sizes, keep split balanced.
      minRatioClamp = 0.5
      maxRatioClamp = 0.5
    }

    // Add immediate incoming delta frame to our accumulator
    dragStateRef.current.accumulatedDelta += deltaPx
    const deltaRatio = dragStateRef.current.accumulatedDelta / availableSize
    let newRatio = dragStateRef.current.initialRatio + deltaRatio

    // Restrict structurally
    newRatio = Math.max(minRatioClamp, Math.min(newRatio, maxRatioClamp))

    updateSplitRatio(node.id, newRatio)
    scheduleChartResize()
  }

  return (
    <div 
      ref={containerRef}
      style={{
        display: 'flex',
        flex: 1,
        flexDirection: isRowSplit ? 'column' : 'row',
        width: '100%',
        height: '100%',
        overflow: 'hidden'
      }}
    >
      <div style={{ 
        flex: `${(node.ratio * 100).toFixed(4)} 1 0%`, 
        display: 'flex', 
        flexDirection: 'column', 
        minWidth: 0, 
        minHeight: 0,
        overflow: 'hidden'
      }}>
        <SplitNode node={node.children[0]} navigateToTrade={navigateToTrade} />
      </div>

      <div
        onDoubleClick={() => {
          saveHistoryPoint()
          updateSplitRatio(node.id, 0.5)
          scheduleChartResize()
        }}
        onMouseDown={onDragStart}
        style={{ 
          display: 'flex', 
          alignItems: 'stretch', 
          justifyContent: 'center',
          flexShrink: 0,
          flexBasis: isRowSplit ? 8 : undefined, 
          width: isRowSplit ? '100%' : 8,
          height: isRowSplit ? 8 : '100%',
          zIndex: 10,
          background: 'transparent',
          position: 'relative'
        }}
        title="Double-click to reset"
      >
        <ResizeHandle 
          direction={isRowSplit ? 'row' : 'col'} 
          onDelta={handleResize} 
        />
      </div>

      <div style={{ 
        flex: `${((1 - node.ratio) * 100).toFixed(4)} 1 0%`, 
        display: 'flex', 
        flexDirection: 'column', 
        minWidth: 0, 
        minHeight: 0,
        overflow: 'hidden'
      }}>
        <SplitNode node={node.children[1]} navigateToTrade={navigateToTrade} />
      </div>
    </div>
  )
})

SplitNode.displayName = 'SplitNode'
