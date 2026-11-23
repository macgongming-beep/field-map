import { createContext, useContext, useEffect, useState } from 'react'
import { readCardDirectory, type CardDirectoryEntry, type CardLabel } from '../lib/cardDirectory'
import type { CalendarEvent } from '../types'

export const ScopedCardContext = createContext(false)

export function useCardDirectoryRead(ids: number[] | null, enabled: boolean, revision = 0) {
  const key = ids == null ? 'all' : [...new Set(ids)].sort((a, b) => a - b).join(',')
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<{ key: string; attempt: number; revision: number; rows: CardLabel[]; error: boolean } | null>(null)
  useEffect(() => {
    if (!enabled || key === '') return
    let active = true
    const promise = key === 'all' ? readCardDirectory() : readCardDirectory(key.split(',').map(Number))
    void promise.then(rows => { if (active) setState({ key, attempt, revision, rows, error: false }) },
      // A failed refresh keeps the names this key already had; only a first failure is empty.
      () => { if (active) setState(previous => ({ key, attempt, revision, rows: previous?.key === key ? previous.rows : [], error: true })) })
    return () => { active = false }
  }, [key, enabled, attempt, revision])
  const current = enabled && state?.key === key && state.attempt === attempt && state.revision === revision ? state : null
  // A later refresh keeps the names it already has until the newer read answers.
  const kept = enabled && current == null && state?.key === key && state.rows.length ? state.rows : null
  return { rows: current?.rows ?? kept ?? [], loading: enabled && key !== '' && current == null,
    error: current?.error ?? false, retry: () => setAttempt(value => value + 1) }
}

export function useSharedCardNames(event: CalendarEvent, cards: CardLabel[]) {
  const scoped = useContext(ScopedCardContext)
  const ids = event.assignmentStatus === 'shared' ? event.cardAssignments.flatMap(a =>
    a.assignedCardIds?.length ? a.assignedCardIds : a.assignedCardId == null ? [] : [a.assignedCardId]) : []
  const missing = [...new Set(ids)].filter(id => !cards.some(card => card.id === id))
  const read = useCardDirectoryRead(missing, scoped)
  const byId = new Map([...read.rows, ...cards].map(card => [card.id, card]))
  if (scoped) for (const id of missing) if (!byId.has(id)) byId.set(id, { id, name: `#${id}` })
  return { ...read, cards: [...byId.values()] }
}

export function useRestaurantCardDirectory(cards: CardDirectoryEntry[]) {
  const scoped = useContext(ScopedCardContext)
  const read = useCardDirectoryRead(null, scoped)
  return { ...read, cards: scoped ? read.rows as CardDirectoryEntry[] : cards }
}
