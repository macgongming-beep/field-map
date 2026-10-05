import { supabase } from './supabase'
import { getAuthToken } from './authToken'
import { createRecipientPreview } from './recipientPreview'
import { assignedServiceScope } from '../utils/cardServiceScope'
import { normalizeVisitorName } from '../utils/returnVisits'

/** Only the real recipient workflow opts in; unsupported views retain the full store. */
export function recipientStoreEnabled(role: string, pathname: string, search: string, demo: string | undefined) {
  if (demo !== 'true' || role !== 'user') return false
  if (['/', '/home', '/territory', '/calendar'].includes(pathname)) return true
  return pathname === '/map' && new URLSearchParams(search).has('assignmentMap')
}

export function createRecipientStoreReader(userName: string) {
  const token = getAuthToken()
  let api = createRecipientPreview(userName, { includeHistories: false })
  let active = true
  let pending: ReturnType<typeof load> | undefined
  let allowed: Set<number> | null = null
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
  async function load() {
    check()
    const [events, assigned, sessions, regular, visits, restaurantBuildings, restaurantUnits, restaurantAssignments] = await Promise.all([
      api.assignments(),
      pages<{ card_id: number }>((from, to) => supabase.from('card_assignments').select('card_id').eq('user_name', userName).order('card_id').range(from, to)),
      pages<{ primary_card_id: number | null }>((from, to) => supabase.from('service_sessions').select('primary_card_id').eq('user_name', userName).eq('status', 'active').is('ended_at', null).order('id').range(from, to)),
      pages<{ visitor_name: string }>((from, to) => supabase.from('regular_visits').select('id,visitor_name').order('id').range(from, to)),
      pages<{ assigned_user_name: string; created_by: string }>((from, to) => supabase.from('return_visits').select('id,assigned_user_name,created_by').is('ended_at', null).order('id').range(from, to)),
      pages<{ card_id: number }>((from, to) => supabase.from('buildings').select('id,card_id').eq('is_restaurant', true).order('id').range(from, to)),
      pages<{ building_id: number }>((from, to) => supabase.from('units').select('id,building_id').eq('is_restaurant', true).order('id').range(from, to)),
      pages<{ building_id: number }>((from, to) => supabase.from('event_restaurant_assignments').select('id,building_id').eq('user_name', userName).order('id').range(from, to)),
    ])
    const me = normalizeVisitorName(userName)
    // The current inline return-visit editor resolves stale links by address against all buildings.
    // Preserve that contract until its own targeted resolver has been implemented and tested.
    if (regular.some((row) => normalizeVisitorName(row.visitor_name) === me)
      || visits.some((row) => (normalizeVisitorName(row.assigned_user_name) || normalizeVisitorName(row.created_by)) === me)) {
      allowed = null
      return null
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
    ])].sort((a, b) => a - b)
    const details = await api.reader.prefetch(ids).details
    check()
    allowed = new Set(ids)
    return details
  }
  return {
    read() { return pending ??= load() },
    resume() {
      if (!active) { api = createRecipientPreview(userName, { includeHistories: false }); pending = undefined; allowed = null; active = true }
    },
    allowsCard(id: number) { return allowed == null || allowed.has(id) },
    get scoped() { return allowed != null },
    refresh() { check(); pending = undefined; api.reader.invalidate() },
    dispose() { active = false; api.dispose() },
  }
}
