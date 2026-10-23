import { supabase } from '../lib/supabase'
import { homeEventDetailId } from '../lib/eventDetailNavigation'
import { CALENDAR_EVENT_COLUMNS } from './calendarEventRefresh'
import { toLocalDateString } from '../utils/dateUtils'
import type { Role } from '../types'
import { isReturnVisitDetailPath } from '../utils/returnVisitDetailPath'
import { mergeEventCardAssignments, toCalendarEvent, toEventCardAssignment, type RawCalendarEvent, type RawEventCardAssignment, type RawEventCardAssignmentCard } from './storeTransforms'

export function calendarReadScope(path: string, search: string, month: string, full: boolean, demo?: string, now = new Date(), role?: Role, userName?: string): string {
  const params = new URLSearchParams(search)
  const returnVisitDetail = role === 'user' && isReturnVisitDetailPath(path)
  // The leader zone reads cards/buildings, not calendar events. Share the service
  // snapshot with its map destination; all card/building stores remain complete.
  if (demo === 'true' && (role === 'user' || role === 'leader') && userName && !params.has('openChat') && !params.has('openEvent')
    && (path === '/territory' || path === '/map' || returnVisitDetail || (path === '/zone' && role === 'leader'))) {
    const target = path === '/zone' || returnVisitDetail ? null : params.get(path === '/map' ? 'assignmentMap' : 'assignmentEvent')
    if (target != null && (!/^\d+$/.test(target) || !Number.isSafeInteger(Number(target)) || Number(target) <= 0)) return 'full'
    return `service:${JSON.stringify([userName, toLocalDateString(now), target == null ? null : Number(target)])}`
  }
  // Admin card allocation does not consume historical events. Share the home
  // window so opening it does not promote a recent snapshot to all history.
  const adminAssignment = path === '/assignment' && (role === 'admin' || role === 'developer')
  const homeDetail = homeEventDetailId(path, search) !== null
  if (demo !== 'true' || ((path === '/calendar' || homeDetail) && full) || (!adminAssignment && !['/', '/home', '/calendar'].includes(path))) return 'full'
  if (params.has('openChat') || (params.has('openEvent') && !homeDetail)) return 'full'
  const recent = new Date(now)
  recent.setDate(recent.getDate() - 14)
  const start = toLocalDateString(recent)
  if (path === '/calendar' && /^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    const [year, selectedMonth] = month.split('-').map(Number)
    return `window:${month}-01:${toLocalDateString(new Date(year, selectedMonth, 0))}`
  }
  const end = toLocalDateString(new Date(now.getFullYear(), now.getMonth() + 2, 0))
  return `window:${start}:${end}`
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
  if (scope.startsWith('service:')) return readServiceCalendar(scope)
  const match = /^(?:since:(\d{4}-\d{2}-\d{2})|window:(\d{4}-\d{2}-\d{2}):(\d{4}-\d{2}-\d{2}))$/.exec(scope)
  if (!match) throw new Error('Invalid calendar scope')
  const since = match[1] ?? match[2]
  const until = match[3]
  if (until && until < since) throw new Error('Invalid calendar scope')
  const events = await pages<RawCalendarEvent>((from, to) => supabase.from('calendar_events')
    .select(CALENDAR_EVENT_COLUMNS).gte('event_date', since).lte('event_date', until ?? '9999-12-31').order('event_date').order('time').order('id').range(from, to))
  if (events.some(e => !Number.isSafeInteger(e.id) || e.event_date < since || (until && e.event_date > until))) throw new Error('Invalid scoped calendar event')
  return hydrateCalendarAssignments(events)
}

async function hydrateCalendarAssignments(events: RawCalendarEvent[]) {
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

async function readServiceCalendar(scope: string) {
  const parsed: unknown = JSON.parse(scope.slice('service:'.length))
  if (!Array.isArray(parsed) || parsed.length !== 3) throw new Error('Invalid service calendar scope')
  const [userName, today, target] = parsed as unknown[]
  if (typeof userName !== 'string' || !userName || typeof today !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(today)
    || (target !== null && (typeof target !== 'number' || !Number.isSafeInteger(target) || target <= 0))) throw new Error('Invalid service calendar scope')
  const [todayRows, mine, restaurants] = await Promise.all([
    pages<{ id: number; event_date: string }>((from, to) => supabase.from('calendar_events')
      .select('id,event_date').eq('event_date', today).order('id').range(from, to)),
    pages<{ event_id: number; user_name: string }>((from, to) => supabase.from('event_card_assignments')
      .select('event_id,user_name').eq('user_name', userName).order('id').range(from, to)),
    // Map unit details display other people's restaurant assignment dates too.
    // Keep this small index complete rather than silently hiding those dates.
    pages<{ event_id: number }>((from, to) => supabase.from('event_restaurant_assignments')
      .select('event_id').order('id').range(from, to)),
  ])
  if (todayRows.some(row => row.event_date !== today) || mine.some(row => row.user_name !== userName)) throw new Error('Invalid service calendar index')
  const ids = [...new Set([...todayRows.map(row => row.id), ...mine.map(row => row.event_id),
    ...restaurants.map(row => row.event_id), ...(target == null ? [] : [target])])]
  if (ids.some(id => !Number.isSafeInteger(id) || id <= 0)) throw new Error('Invalid service calendar event id')
  const events: RawCalendarEvent[] = []
  for (let start = 0; start < ids.length; start += 100) {
    const batch = ids.slice(start, start + 100)
    const rows = await pages<RawCalendarEvent>((from, to) => supabase.from('calendar_events')
      .select(CALENDAR_EVENT_COLUMNS).in('id', batch).order('id').range(from, to))
    if (rows.some(row => !batch.includes(row.id))) throw new Error('Invalid service calendar event')
    events.push(...rows)
  }
  // Never filter these rows by user: shared assignments need every team in the event.
  return (await hydrateCalendarAssignments(events)).sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time) || a.id - b.id)
}
