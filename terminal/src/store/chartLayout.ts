import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type LayoutNode =
  | {
      type: 'leaf'
      id: string
      panelState: {
        symbol: string
        interval: string
      }
    }
  | {
      type: 'split'
      id: string
      direction: 'row' | 'col'
      ratio: number // 0.15 to 0.85
      children: [LayoutNode, LayoutNode]
    }

interface ChartLayoutState {
  version: number
  tree: LayoutNode
  activePanelId: string | null
  history: LayoutNode[]
  canUndo: boolean
  undo: () => void
  saveHistoryPoint: () => void
  splitPanel: (targetId: string, direction: 'row' | 'col') => void
  closePanel: (targetId: string) => void
  updateSplitRatio: (nodeId: string, newRatio: number) => void
  updatePanelState: (id: string, state: Partial<{ symbol: string; interval: string }>) => void
  setActivePanel: (id: string) => void
}

const generateId = () => Math.random().toString(36).substring(2, 9)

// Pure function to map over the tree and perform immutable updates
const mapTree = (node: LayoutNode, fn: (n: LayoutNode) => LayoutNode): LayoutNode => {
  // We only apply the function payload to the current node.
  const updated = fn(node)
  
  // If the returned mutated node is a Leaf, there's no deeper iteration possible. 
  // Base case: Terminate recursion here.
  if (updated.type === 'leaf') {
    return updated
  }

  // CRITICAL FIX: To prevent infinite recursion, we only recursively map if the ORIGINAL node was 
  // also a split node. If `fn` converted a leaf into a split (which splitPanel does), the new 
  // children inside `updated` are already freshly generated leaves. If we map them again, `fn` 
  // processes them, converts them to splits again, and the loop repeats forever.
  
  if (node.type === 'split' && updated.type === 'split') {
    return {
      ...updated,
      children: [
        mapTree(node.children[0], fn),
        mapTree(node.children[1], fn)
      ],
    }
  }

  // The node was a leaf, but `fn` just upgraded it to a split.
  // We can safely return it directly because its children are newly instantiated base leaves.
  return updated
}

// Tree validation to ensure localStorage doesn't crash the app
const isValidTree = (tree: any): tree is LayoutNode => {
  if (!tree || !tree.id || !tree.type) return false
  if (tree.type === 'leaf') {
    return tree.panelState && typeof tree.panelState.symbol === 'string' && typeof tree.panelState.interval === 'string'
  }
  if (tree.type === 'split') {
    return (
      (tree.direction === 'row' || tree.direction === 'col') &&
      typeof tree.ratio === 'number' &&
      Array.isArray(tree.children) &&
      tree.children.length === 2 &&
      isValidTree(tree.children[0]) &&
      isValidTree(tree.children[1])
    )
  }
  return false
}

const defaultTree: LayoutNode = {
  type: 'leaf',
  id: generateId(),
  panelState: { symbol: 'BTC-USD', interval: '1m' },
}

export const useChartLayoutStore = create<ChartLayoutState>()(
  persist(
    (set) => ({
      version: 1,
      tree: defaultTree,
      activePanelId: defaultTree.id,
      history: [],
      canUndo: false,

      undo: () => set((state) => {
        if (state.history.length === 0) return state
        const newHistory = [...state.history]
        const previousTree = newHistory.pop()!
        return {
          tree: previousTree,
          history: newHistory,
          canUndo: newHistory.length > 0
        }
      }),

      saveHistoryPoint: () => set((state) => ({
        history: [...state.history.slice(-49), state.tree],
        canUndo: true
      })),

      splitPanel: (targetId, direction) => set((state) => {
        const updateNode = (node: LayoutNode): LayoutNode => {
          if (node.type === 'leaf' && node.id === targetId) {
            return {
              type: 'split',
              id: generateId(),
              direction,
              ratio: 0.5,
              children: [
                node, // Original
                { type: 'leaf', id: generateId(), panelState: { ...node.panelState } } // Clone
              ],
            }
          }
          return node
        }
        return {
          history: [...state.history.slice(-49), state.tree],
          canUndo: true,
          tree: mapTree(state.tree, updateNode)
        }
      }),

      closePanel: (targetId) => set((state) => {
        // Prevent deleting the last remaining panel
        if (state.tree.type === 'leaf' && state.tree.id === targetId) {
          return state 
        }

        let defaultNewActiveId: string | null = null

        // Find parent of the target and replace it with the sibling node
        const removeLeaf = (node: LayoutNode): LayoutNode | null => {
          if (node.type === 'leaf') {
            return node.id === targetId ? null : node
          }
          
          const child0 = removeLeaf(node.children[0])
          const child1 = removeLeaf(node.children[1])
          
          // Node handles a case where a child was deleted
          if (!child0 && !child1) return null
          if (!child0 && child1) {
            // Find a valid active ID fallback if we're deleting the active panel
            if (state.activePanelId === targetId) defaultNewActiveId = child1.type === 'leaf' ? child1.id : child1.children[0].id
            return child1 // Promote sibling
          }
          if (!child1 && child0) {
            if (state.activePanelId === targetId) defaultNewActiveId = child0.type === 'leaf' ? child0.id : child0.children[0].id
            return child0 // Promote sibling
          }
          
          if (child0 && child1) {
            return { ...node, children: [child0, child1] }
          }
          return null
        }
        
        const newTree = removeLeaf(state.tree)
        if (!newTree) return state

        return { 
          history: [...state.history.slice(-49), state.tree],
          canUndo: true,
          tree: newTree,
          activePanelId: state.activePanelId === targetId ? (defaultNewActiveId || newTree.id) : state.activePanelId
        }
      }),

      updateSplitRatio: (nodeId, newRatio) => set((state) => {
        return {
          tree: mapTree(state.tree, (node) => {
            if (node.type === 'split' && node.id === nodeId) {
              return { ...node, ratio: Number(newRatio.toFixed(4)) }
            }
            return node
          })
        }
      }),

      updatePanelState: (targetId, newState) => set((state) => ({
        history: [...state.history.slice(-49), state.tree],
        canUndo: true,
        tree: mapTree(state.tree, (node) => 
          node.type === 'leaf' && node.id === targetId 
            ? { ...node, panelState: { ...node.panelState, ...newState } } 
            : node
        )
      })),

      setActivePanel: (activePanelId) => set({ activePanelId }),
    }),
    { 
      name: 'chart-layout-storage',
      partialize: (state) => ({
        version: state.version,
        tree: state.tree,
        activePanelId: state.activePanelId,
      }),
      merge: (persistedState: any, currentState) => {
        // Validate persisted data to prevent crash loops
        if (
          persistedState && 
          typeof persistedState === 'object' && 
          persistedState.version === 1 && 
          isValidTree(persistedState.tree)
        ) {
          return { ...currentState, ...persistedState }
        }
        return currentState
      }
    }
  )
)
