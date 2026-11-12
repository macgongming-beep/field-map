import { createContext, useContext } from 'react'
import type { Role, VisitHistory } from '../types'

export type PrivilegedHistoryScope = 'summary' | 'full'
export type VisitRecency = Pick<VisitHistory, 'id' | 'unitId' | 'visitedAt' | 'createdAt'>
export const VISIT_RECENCY_COLUMNS = 'id, unit_id, visited_at, created_at'

export function privilegedHistoryEnabled(role: Role) {
  return (role === 'admin' || role === 'leader')
    && (import.meta.env.VITE_PRIVILEGED_HISTORY_DEMAND_ENABLED ?? import.meta.env.VITE_DEMO_MODE) === 'true'
}

export function privilegedHistoryScope(role: Role, pathname: string, search: string, desktop: boolean): PrivilegedHistoryScope | undefined {
  if (!privilegedHistoryEnabled(role)) return undefined
  // Unknown consumers retain complete records. Desktop zone includes memo/detail tools.
  if (pathname === '/' || pathname === '/home' || pathname === '/calendar') return 'summary'
  if (!desktop && pathname === '/zone' && new URLSearchParams(search).get('view') !== 'map') return 'summary'
  return 'full'
}

export const VisitRecencyContext = createContext<VisitRecency[] | null>(null)
export function useVisitRecency(histories: VisitHistory[]): VisitRecency[] {
  return useContext(VisitRecencyContext) ?? histories
}
