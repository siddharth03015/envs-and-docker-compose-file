'use client'
import { useState } from 'react'
import { createNote, updateNote, deleteNote } from '@/lib/notes'
import { fmtPrice } from '@/lib/formatters'
import type { Note, MyTrade } from '@/types'

interface Props {
  notes:          Note[]
  trades:         MyTrade[]
  onNotesChange:  (notes: Note[]) => void
}

const EditIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
  </svg>
)

const TrashIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <polyline points="3 6 5 6 21 6"/>
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
  </svg>
)

function fmtNoteTime(ms: number) {
  return new Date(ms).toLocaleString('en-US', {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true,
  })
}

export default function DashNotesPanel({ notes, trades, onNotesChange }: Props) {
  const [tab, setTab]               = useState<'notes' | 'trades'>('notes')
  const [newNote, setNewNote]       = useState('')
  const [editId, setEditId]         = useState<string | null>(null)
  const [editContent, setEditContent] = useState('')
  const [busy, setBusy]             = useState(false)

  const handleAdd = async () => {
    if (!newNote.trim() || busy) return
    setBusy(true)
    try {
      const note = await createNote(newNote.trim())
      onNotesChange([note, ...notes])
      setNewNote('')
    } catch { /* ignore */ } finally { setBusy(false) }
  }

  const handleSaveEdit = async (id: string) => {
    if (!editContent.trim()) return
    try {
      await updateNote(id, editContent.trim())
      onNotesChange(notes.map(n => n.id === id ? { ...n, content: editContent.trim() } : n))
      setEditId(null)
    } catch { /* ignore */ }
  }

  const handleDelete = async (id: string) => {
    try {
      await deleteNote(id)
      onNotesChange(notes.filter(n => n.id !== id))
    } catch { /* ignore */ }
  }

  return (
    <div style={{
      background: 'var(--bg-surface)', border: '1px solid var(--border-dim)',
      borderRadius: 8, display: 'flex', flexDirection: 'column', minHeight: 420,
    }}>
      {/* Tab bar */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border-dim)', flexShrink: 0 }}>
        {(['trades', 'notes'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            flex: 1, padding: '11px 0', background: 'transparent', border: 'none',
            borderBottom: tab === t ? '2px solid var(--buy)' : '2px solid transparent',
            marginBottom: -1,
            color: tab === t ? 'var(--text-main)' : 'var(--text-muted)',
            fontSize: 13, fontWeight: 600, cursor: 'pointer', transition: 'color 0.15s',
            textTransform: 'capitalize',
          }}>
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {/* List */}
      <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
        {tab === 'notes' ? (
          notes.length === 0 ? (
            <div style={{ padding: '40px 20px', textAlign: 'center' }}>
              <div style={{ fontSize: 28, marginBottom: 10 }}>📝</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6 }}>
                Jot down important trading insights below
              </div>
            </div>
          ) : (
            notes.map(note => (
              <div key={note.id} style={{
                padding: '10px 14px', borderBottom: '1px solid var(--border-dim)',
                display: 'flex', gap: 10, alignItems: 'flex-start',
                transition: 'background 0.1s',
              }}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.02)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <div style={{
                  width: 6, height: 6, borderRadius: '50%',
                  background: 'var(--buy)', marginTop: 7, flexShrink: 0,
                  boxShadow: '0 0 6px var(--buy)',
                }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginBottom: 3 }}>
                    {fmtNoteTime(note.created_at)}
                  </div>
                  {editId === note.id ? (
                    <div>
                      <textarea value={editContent} onChange={e => setEditContent(e.target.value)}
                        style={{
                          width: '100%', background: 'var(--bg-surface-elevated)',
                          border: '1px solid var(--border-dim)', color: 'var(--text-main)',
                          padding: '6px 8px', borderRadius: 4, fontSize: 12,
                          resize: 'vertical', minHeight: 56, outline: 'none',
                          fontFamily: 'var(--font-sans)', lineHeight: 1.5,
                        }}
                      />
                      <div style={{ display: 'flex', gap: 6, marginTop: 5 }}>
                        <button onClick={() => handleSaveEdit(note.id)} style={{
                          fontSize: 11, padding: '3px 10px',
                          background: 'var(--buy)', color: '#000',
                          border: 'none', borderRadius: 3, cursor: 'pointer', fontWeight: 600,
                        }}>Save</button>
                        <button onClick={() => setEditId(null)} style={{
                          fontSize: 11, padding: '3px 10px',
                          background: 'transparent', color: 'var(--text-muted)',
                          border: '1px solid var(--border-dim)', borderRadius: 3, cursor: 'pointer',
                        }}>Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <div style={{ fontSize: 12, color: 'var(--text-main)', lineHeight: 1.55 }}>{note.content}</div>
                  )}
                </div>
                {editId !== note.id && (
                  <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
                    <button onClick={() => { setEditId(note.id); setEditContent(note.content) }}
                      style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 5, borderRadius: 3, transition: 'color 0.15s' }}
                      onMouseEnter={e => (e.currentTarget.style.color = 'var(--text-main)')}
                      onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-muted)')}>
                      <EditIcon />
                    </button>
                    <button onClick={() => handleDelete(note.id)}
                      style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 5, borderRadius: 3, transition: 'color 0.15s' }}
                      onMouseEnter={e => (e.currentTarget.style.color = 'var(--sell)')}
                      onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-muted)')}>
                      <TrashIcon />
                    </button>
                  </div>
                )}
              </div>
            ))
          )
        ) : (
          trades.length === 0 ? (
            <div style={{ padding: '40px 20px', textAlign: 'center', fontSize: 12, color: 'var(--text-muted)' }}>
              No trades yet
            </div>
          ) : (
            trades.map(t => (
              <div key={t.id} style={{
                padding: '9px 14px', borderBottom: '1px solid var(--border-dim)',
                display: 'flex', gap: 10, alignItems: 'center',
                transition: 'background 0.1s',
              }}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.02)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <div style={{
                  width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
                  background: t.side === 'BUY' ? 'var(--buy)' : 'var(--sell)',
                }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginBottom: 2 }}>
                    {fmtNoteTime(t.timestamp)}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-main)' }}>
                    <span style={{ color: t.side === 'BUY' ? 'var(--buy)' : 'var(--sell)', fontWeight: 600, marginRight: 4 }}>
                      {t.side === 'BUY' ? 'Bought' : 'Sold'}
                    </span>
                    {t.quantity.toFixed(4)} {t.symbol.split('-')[0]} @ ${fmtPrice(t.price, 2)}
                  </div>
                </div>
              </div>
            ))
          )
        )}
      </div>

      {/* Add note footer */}
      <div style={{ borderTop: '1px solid var(--border-dim)', padding: '10px 14px', flexShrink: 0, display: 'flex', gap: 8 }}>
        <input
          value={newNote}
          onChange={e => setNewNote(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAdd() } }}
          placeholder="Jot down important trading insights…"
          style={{
            flex: 1, background: 'var(--bg-surface-elevated)',
            border: '1px solid var(--border-dim)', color: 'var(--text-main)',
            padding: '7px 11px', borderRadius: 5, fontSize: 12,
            outline: 'none', fontFamily: 'var(--font-sans)',
            transition: 'border-color 0.2s',
          }}
          onFocus={e => (e.target.style.borderColor = 'rgba(52,211,153,0.4)')}
          onBlur={e => (e.target.style.borderColor = 'var(--border-dim)')}
        />
        <button onClick={handleAdd} disabled={!newNote.trim() || busy} style={{
          padding: '7px 14px', background: 'var(--buy)', color: '#000',
          border: 'none', borderRadius: 5, fontSize: 12, fontWeight: 700,
          cursor: 'pointer', opacity: (!newNote.trim() || busy) ? 0.45 : 1,
          transition: 'opacity 0.2s', whiteSpace: 'nowrap',
        }}>
          + Add
        </button>
      </div>
    </div>
  )
}
