import { supabase } from '../lib/supabase'
import { homeEventDetailId } from '../lib/eventDetailNavigation'
import { CALENDAR_EVENT_COLUMNS } from './calendarEventRefresh'
import { toLocalDateString } from '../utils/dateUtils'
import type { Role } from '../types'
import { isReturnVisitDetailPath } from '../utils/returnVisitDetailPath'
import { returnDetailRetentionEnabled } from '../lib/returnDetailRetention'
import { parseServiceCalendarScope } from './serviceCalendarScope'
import { isLightweightManagementRoute } from '../utils/personalSettingsRoute'
import { mergeEventCardAssignments, toCalendarEvent, toEventCardAssignment, type RawCalendarEvent, type RawEventCardAssignment, type RawEventCardAssignmentCard } from './storeTransforms'

export function calendarWindowEnabled(flag = import.meta.env.VITE_CALENDAR_WINDOW_ENABLED, demo = import.meta.env.VITE_DEMO_MODE): boolean {
  return (flag ?? demo) === 'true'
}

export function calendarReadScope(path: string, search: string, month: string, full: boolean, featureFlag?: string, now = new Date(), role?: Role, userName?: string): string {
  const params = new URLSearchParams(search)
  const returnVisitDetail = returnDetailRetentionEnabled() && role === 'user' && isReturnVisitDetailPath(path)
  // The leader zone reads cards/buildings, not calendar events. Share the service
  // snapshot with its map destination; all card/building stores remain complete.
  if (featureFlag === 'true' && (role === 'user' || role === 'leader') && userName && !params.has('openChat') && !params.has('openEvent')
    && (path === '/territory' || path === '/map' || returnVisitDetail || (path === '/zone' && role === 'leader'))) {
    const target = path === '/zone' || returnVisitDetail ? null : params.get(path === '/map' ? 'assignmentMap' : 'assignmentEvent')
    if (target != null && (!/^\d+$/.test(target) || !Number.isSafeInteger(Number(target)) || Number(target) <= 0)) return 'full'
    return `service:${JSON.stringify([userName, toLocalDateString(now), target == null ? null : Number(target)])}`
  }
  // Admin card allocation does not consume historical events. Share the home
  // window so opening it does not promote a recent snapshot to all history.
  const adminAssignment = path === '/assignment' && (role === 'admin' || role === 'developer')
  // Opted-in management and zone lists consume no calendar history. Unknown query
  // modes (including ambiguous duplicate keys) remain full consumers.
  const adminNonCalendar = import.meta.env.VITE_ROUTE_LIGHTWEIGHT_ENABLED === 'true'
    && (role === 'admin' || role === 'developer')
    && (isLightweightManagementRoute(path, search) || (path === '/zone'
      && [...params.keys()].every(key => ['level', 'region', 'dong', 'scope', 'tab', 'groupCode'].includes(key) && params.getAll(key).length === 1)
      && [null, 'territory', 'informal', 'restaurant'].includes(params.get('tab'))))
  const homeDetail = homeEventDetailId(path, search) !== null
  if (featureFlag !== 'true' || ((path === '/calendar' || homeDetail) && full) || (!adminAssignment && !adminNonCalendar && !['/', '/home', '/calendar'].includes(path))) return 'full'
  if (params.has('openChat') || (params.has('openEvent') && !homeDetail)) return 'full'
  const recent = new Date(now)
  recent.setDate(recent.getDate() - 14)
  const start = toLocalDateString(recent)
  // The calendar opens at this month. Start its read before the building gate
  // allows the calendar component to mount and publish its month selection.
  const calendarMonth = month || toLocalDateString(now).slice(0, 7)
  if (path === '/calendar' && /^\d{4}-(0[1-9]|1[0-2])$/.test(calendarMonth)) {
    const [year, selectedMonth] = calendarMonth.split('-').map(Number)
    return `window:${calendarMonth}-01:${toLocalDateString(new Date(year, selectedMonth, 0))}`
  }
  const end = toLocalDateString(new Date(now.getFullYear(), now.getMonth() + 2, 0))
  return `window:${start}:${end}`
}

// Like Promise.all, but never rejects while a sibling read is still running.
// Callers may retry on failure; a retry must not overlap requests still in flight.
async function settleAll<T extends readonly unknown[]>(reads: { [K in keyof T]: Promise<T[K]> }): Promise<T> {
  const results = await Promise.allSettled(reads)
  for (const result of results) if (result.status === 'rejected') throw result.reason
  return results.map(result => (result as PromiseFulfilledResult<unknown>).value) as unknown as T
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
  // 0167: every team arrives with its event in one round trip instead of two.
  const events = await pages<EmbeddedCalendarEvent>((from, to) => supabase.from('calendar_events')
    .select(`${CALENDAR_EVENT_COLUMNS},${EMBEDDED_ASSIGNMENTS}`).gte('event_date', since).lte('event_date', until ?? '9999-12-31').order('event_date').order('time').order('id').range(from, to))
  if (events.some(e => !Number.isSafeInteger(e.id) || e.event_date < since || (until && e.event_date > until))) throw new Error('Invalid scoped calendar event')
  return withEmbeddedAssignments(events)
}

// Children of each event, embedded by their event_id foreign keys. Never filtered by user.
const EMBEDDED_ASSIGNMENTS = 'event_card_assignments(*),event_card_assignment_cards(*)'
const EMBED_LIMIT = 1000
type EmbeddedCalendarEvent = RawCalendarEvent & {
  event_card_assignments?: RawEventCardAssignment[]
  event_card_assignment_cards?: RawEventCardAssignmentCard[]
}

async function withEmbeddedAssignments(rows: EmbeddedCalendarEvent[]) {
  const events: RawCalendarEvent[] = []
  const assignments: RawEventCardAssignment[] = []
  const linked: RawEventCardAssignmentCard[] = []
  let truncated = false
  for (const row of rows) {
    const { event_card_assignments: base, event_card_assignment_cards: cards, ...event } = row
    if (!Array.isArray(base) || !Array.isArray(cards)) throw new Error('Invalid embedded calendar assignment')
    if ([...base, ...cards].some(child => child.event_id !== row.id)) throw new Error('Invalid embedded calendar assignment')
    // An embedded list as long as a response page may have been cut short by the server.
    // Never treat it as complete: read those teams the paged way.
    if (base.length >= EMBED_LIMIT || cards.length >= EMBED_LIMIT) truncated = true
    events.push(event as RawCalendarEvent)
    assignments.push(...base)
    linked.push(...cards)
  }
  if (truncated) return hydrateCalendarAssignments(events)
  const merged = mergeEventCardAssignments(assignments.map(toEventCardAssignment), linked)
  return events.map(event => toCalendarEvent(event, merged.filter(a => a.eventId === event.id)))
}

async function hydrateCalendarAssignments(events: RawCalendarEvent[]) {
  const merged = await readCalendarAssignments(events.map(e => e.id))
  return events.map(event => toCalendarEvent(event, merged.filter(a => a.eventId === event.id)))
}

// Every team of each requested event, never filtered by user.
async function readCalendarAssignments(eventIds: number[]) {
  const assignments: RawEventCardAssignment[] = []
  const linked: RawEventCardAssignmentCard[] = []
  const ids = [...new Set(eventIds)]
  for (let start = 0; start < ids.length; start += 100) {
    const batch = ids.slice(start, start + 100)
    const [base, cards] = await settleAll<[RawEventCardAssignment[], RawEventCardAssignmentCard[]]>([
      pages<RawEventCardAssignment>((from, to) => supabase.from('event_card_assignments').select('*').in('event_id', batch).order('id').range(from, to)),
      pages<RawEventCardAssignmentCard>((from, to) => supabase.from('event_card_assignment_cards').select('*').in('event_id', batch).order('id').range(from, to)),
    ])
    if ([...base, ...cards].some(row => !batch.includes(row.event_id))) throw new Error('Invalid scoped calendar assignment')
    assignments.push(...base)
    linked.push(...cards)
  }
  return mergeEventCardAssignments(assignments.map(toEventCardAssignment), linked)
}

async function readServiceCalendar(scope: string) {
  const parsed = parseServiceCalendarScope(scope)
  if (!parsed) throw new Error('Invalid service calendar scope')
  const { user: userName, date: today, target } = parsed
  // 0167: each index is an event query that also carries the event body and every team,
  // so the screen needs one round trip instead of index -> bodies.
  //   today:      all of today's events
  //   mine:       events with one of my card assignments (alias inner join; teams stay complete)
  //   restaurant: restaurant events from today on (0164). Unit details show everyone's, but
  //               only for today or later; past ones I am card-assigned to come from `mine`.
  //   target:     the explicit route event
  // Never filter the embedded teams by user: shared assignments need every team in the event.
  const columns = `${CALENDAR_EVENT_COLUMNS},${EMBEDDED_ASSIGNMENTS}`
  type MineRow = EmbeddedCalendarEvent & { mine?: { user_name: string }[] }
  type RestaurantRow = EmbeddedCalendarEvent & { restaurant?: { event_id: number }[] }
  const [todayRows, mineRows, restaurantRows, targetRows] = await settleAll<[EmbeddedCalendarEvent[], MineRow[], RestaurantRow[], EmbeddedCalendarEvent[]]>([
    pages<EmbeddedCalendarEvent>((from, to) => supabase.from('calendar_events')
      .select(columns).eq('event_date', today).order('id').range(from, to)),
    pages<MineRow>((from, to) => supabase.from('calendar_events')
      .select(`${columns},mine:event_card_assignments!inner(user_name)`).eq('mine.user_name', userName).order('id').range(from, to)),
    pages<RestaurantRow>((from, to) => supabase.from('calendar_events')
      .select(`${columns},restaurant:event_restaurant_assignments!inner(event_id)`).gte('event_date', today).order('id').range(from, to)),
    target == null ? Promise.resolve([]) : pages<EmbeddedCalendarEvent>((from, to) => supabase.from('calendar_events')
      .select(columns).eq('id', target).order('id').range(from, to)),
  ])
  // The server must honour every filter; anything else is not trusted as a complete snapshot.
  if (todayRows.some(row => row.event_date !== today)
    || mineRows.some(row => !Array.isArray(row.mine) || row.mine.length === 0 || row.mine.some(link => link.user_name !== userName))
    || restaurantRows.some(row => typeof row.event_date !== 'string' || row.event_date < today
      || !Array.isArray(row.restaurant) || row.restaurant.length === 0 || row.restaurant.some(link => link.event_id !== row.id))) {
    throw new Error('Invalid service calendar index')
  }
  if (targetRows.some(row => row.id !== target)) throw new Error('Invalid service calendar event')
  const unique = new Map<number, EmbeddedCalendarEvent>()
  for (const row of [...todayRows, ...mineRows, ...restaurantRows, ...targetRows]) {
    if (!Number.isSafeInteger(row.id) || row.id <= 0) throw new Error('Invalid service calendar event id')
    if (unique.has(row.id)) continue
    const { mine: _mine, restaurant: _restaurant, ...event } = row as MineRow & RestaurantRow
    unique.set(row.id, event)
  }
  const events = await withEmbeddedAssignments([...unique.values()])
  return events.sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time) || a.id - b.id)
}
