import { createContext, useContext, useEffect, useState } from 'react'
import { readCardDirectory, type CardDirectoryEntry, type CardLabel } from '../lib/cardDirectory'
import type { CalendarEvent } from '../types'

export const ScopedCardContext = createContext(false)

export function useCardDirectoryRead(ids: number[] | null, enabled: boolean) {
  const key = ids == null ? 'all' : [...new Set(ids)].sort((a, b) => a - b).join(',')
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<{ key: string; attempt: number; rows: CardLabel[]; error: boolean } | null>(null)
  useEffect(() => {
    if (!enabled || key === '') return
    let active = true
    const promise = key === 'all' ? readCardDirectory() : readCardDirectory(key.split(',').map(Number))
    void promise.then(rows => { if (active) setState({ key, attempt, rows, error: false }) },
      () => { if (active) setState({ key, attempt, rows: [], error: true }) })
    return () => { active = false }
  }, [key, enabled, attempt])
  const current = enabled && state?.key === key && state.attempt === attempt ? state : null
  return { rows: current?.rows ?? [], loading: enabled && key !== '' && current == null,
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
