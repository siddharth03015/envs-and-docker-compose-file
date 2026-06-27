import { api } from './api'
import type { Note } from '@/types'

export const fetchNotes = async (from?: number, to?: number): Promise<Note[]> => {
  const params: Record<string, number> = {}
  if (from != null) params.from = from
  if (to   != null) params.to   = to
  const { data } = await api.get<{ notes: Note[] }>('/api/notes', { params })
  return data.notes ?? []
}

export const createNote = async (content: string): Promise<Note> => {
  const { data } = await api.post<Note>('/api/notes', { content })
  return data
}

export const updateNote = async (id: string, content: string): Promise<Note> => {
  const { data } = await api.put<Note>(`/api/notes/${id}`, { content })
  return data
}

export const deleteNote = async (id: string): Promise<void> => {
  await api.delete(`/api/notes/${id}`)
}
