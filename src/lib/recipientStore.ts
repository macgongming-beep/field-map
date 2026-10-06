import { supabase } from './supabase'
import { getAuthToken } from './authToken'
import { createRecipientPreview } from './recipientPreview'
import { assignedServiceScope } from '../utils/cardServiceScope'
import type { CalendarEvent } from '../types'

/** Only the real recipient workflow opts in; unsupported views retain the full store. */
export function recipientStoreEnabled(role: string, pathname: string, search: string, demo: string | undefined, enabled?: string) {
  if ((enabled ?? demo) !== 'true' || role !== 'user') return false
  if (['/', '/home', '/territory', '/calendar'].includes(pathname)) return true
  return pathname === '/map' && new URLSearchParams(search).has('assignmentMap')
}

export function createRecipientStoreReader(userName: string) {
  const token = getAuthToken()
  let api = createRecipientPreview(userName, { includeHistories: false, includeSummaries: false })
  let active = true
  let pending: ReturnType<typeof load> | undefined
  let allowed: Set<number> | null = null
  let calendarSnapshot: CalendarEvent[] | undefined
  const check = () => { if (!active || !token || getAuthToken() !== token) throw new Error('Recipient store session changed') }
  async function pages<T>(query: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>) {
    const result: T[] = []
    for (let from = 0; ; from += 1000) {
      check()
      const response = await query(from, from + 999)
      check()
      if (response.error) throw response.error
      if (!Array.isArray(response.data)) throw new Error('Invalid recipient scope response')
      result.push(...response.data as T[])
      if (response.data.length < 1000) return result
    }
  }
  async function scopeIds(calendar?: CalendarEvent[]) {
    check()
    const [events, assigned, sessions, returnVisitScope, restaurantBuildings, restaurantUnits, restaurantAssignments] = await Promise.all([
      calendar ?? api.assignments(),
      pages<{ card_id: number }>((from, to) => supabase.from('card_assignments').select('card_id').eq('user_name', userName).order('card_id').range(from, to)),
      pages<{ primary_card_id: number | null }>((from, to) => supabase.from('service_sessions').select('primary_card_id').eq('user_name', userName).eq('status', 'active').is('ended_at', null).order('id').range(from, to)),
      supabase.rpc('get_recipient_return_visit_card_ids', { p_token: token }),
      pages<{ card_id: number }>((from, to) => supabase.from('buildings').select('id,card_id').eq('is_restaurant', true).order('id').range(from, to)),
      pages<{ building_id: number }>((from, to) => supabase.from('units').select('id,building_id').eq('is_restaurant', true).order('id').range(from, to)),
      pages<{ building_id: number }>((from, to) => supabase.from('event_restaurant_assignments').select('id,building_id').eq('user_name', userName).order('id').range(from, to)),
    ])
    check()
    if (returnVisitScope.error) throw returnVisitScope.error
    if (!Array.isArray(returnVisitScope.data) || returnVisitScope.data.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
      throw new Error('Invalid return-visit scope response')
    }
    const restaurantCardIds = restaurantBuildings.map((row) => row.card_id)
    const buildingIds = [...new Set([...restaurantUnits, ...restaurantAssignments].map((row) => row.building_id))]
    for (let from = 0; from < buildingIds.length; from += 100) {
      const rows = await pages<{ card_id: number }>((start, end) => supabase.from('buildings').select('id,card_id')
        .in('id', buildingIds.slice(from, from + 100)).order('id').range(start, end))
      restaurantCardIds.push(...rows.map((row) => row.card_id))
    }
    const ids = [...new Set([
      ...events.flatMap((event) => assignedServiceScope(event, userName).ids),
      ...assigned.map((row) => row.card_id), ...sessions.flatMap((row) => row.primary_card_id == null ? [] : [row.primary_card_id]),
      ...restaurantCardIds,
      ...returnVisitScope.data as number[],
    ])].sort((a, b) => a - b)
    return ids
  }
  async function load() {
    const ids = await scopeIds(calendarSnapshot)
    const details = await api.reader.prefetch(ids).details
    check()
    allowed = new Set(ids)
    return details
  }
  return {
    read() { return pending ??= load() },
    async unchangedScope(calendar?: CalendarEvent[]) {
      const ids = await scopeIds(calendar)
      check()
      return allowed != null && ids.length === allowed.size && ids.every((id) => allowed!.has(id)) ? ids : null
    },
    resume() {
      if (!active) { api = createRecipientPreview(userName, { includeHistories: false, includeSummaries: false }); pending = undefined; allowed = null; calendarSnapshot = undefined; active = true }
    },
    allowsCard(id: number) { return allowed == null || allowed.has(id) },
    validateCards(cardIds: number[]) {
      check()
      const available = new Set(cardIds)
      if (allowed && [...allowed].some((id) => !available.has(id))) throw new Error('A requested card is unavailable')
    },
    get scoped() { return allowed != null },
    refresh(calendar?: CalendarEvent[]) { check(); calendarSnapshot = calendar; pending = undefined; api.reader.invalidate() },
    dispose() { active = false; api.dispose() },
  }
}
