import { supabase } from '../lib/supabase'
import { CALENDAR_EVENT_COLUMNS } from './calendarEventRefresh'
import { toLocalDateString } from '../utils/dateUtils'
import type { Role } from '../types'
import { mergeEventCardAssignments, toCalendarEvent, toEventCardAssignment, type RawCalendarEvent, type RawEventCardAssignment, type RawEventCardAssignmentCard } from './storeTransforms'

export function calendarReadScope(path: string, search: string, month: string, full: boolean, demo?: string, now = new Date(), role?: Role): string {
  // Admin card allocation does not consume historical events. Share the home
  // window so opening it does not promote a recent snapshot to all history.
  const adminAssignment = path === '/assignment' && (role === 'admin' || role === 'developer')
  if (demo !== 'true' || (path === '/calendar' && full) || (!adminAssignment && !['/', '/home', '/calendar'].includes(path))) return 'full'
  const params = new URLSearchParams(search)
  if (params.has('openChat') || params.has('openEvent')) return 'full'
  const recent = new Date(now)
  recent.setDate(recent.getDate() - 14)
  const start = toLocalDateString(recent)
  const selected = /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? `${month}-01` : start
  return `since:${path === '/calendar' && selected < start ? selected : start}`
}

async function pages<T>(query: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>): Promise<T[]> {
  const rows: T[] = []
  for (let from = 0; ; from += 1000) {
    const result = await query(from, from + 999)
    if (result.error) throw result.error
    if (!Array.isArray(result.data)) throw new Error('Invalid calendar response')
    rows.push(...result.data as T[])
    if (result.data.length < 1000) return rows
  }
}

/** Complete participants and assignments for every returned event, including old months. */
export async function readScopedCalendar(scope: string) {
  if (!/^since:\d{4}-\d{2}-\d{2}$/.test(scope)) throw new Error('Invalid calendar scope')
  const since = scope.slice(6)
  const events = await pages<RawCalendarEvent>((from, to) => supabase.from('calendar_events')
    .select(CALENDAR_EVENT_COLUMNS).gte('event_date', since).order('event_date').order('time').order('id').range(from, to))
  if (events.some(e => !Number.isSafeInteger(e.id) || e.event_date < since)) throw new Error('Invalid scoped calendar event')
  const assignments: RawEventCardAssignment[] = []
  const linked: RawEventCardAssignmentCard[] = []
  const ids = [...new Set(events.map(e => e.id))]
  for (let start = 0; start < ids.length; start += 100) {
    const batch = ids.slice(start, start + 100)
    const [base, cards] = await Promise.all([
      pages<RawEventCardAssignment>((from, to) => supabase.from('event_card_assignments').select('*').in('event_id', batch).order('id').range(from, to)),
      pages<RawEventCardAssignmentCard>((from, to) => supabase.from('event_card_assignment_cards').select('*').in('event_id', batch).order('id').range(from, to)),
    ])
    if ([...base, ...cards].some(row => !batch.includes(row.event_id))) throw new Error('Invalid scoped calendar assignment')
    assignments.push(...base)
    linked.push(...cards)
  }
  const merged = mergeEventCardAssignments(assignments.map(toEventCardAssignment), linked)
  return events.map(event => toCalendarEvent(event, merged.filter(a => a.eventId === event.id)))
}
