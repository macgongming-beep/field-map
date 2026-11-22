import { supabase } from './supabase'
import { getAuthToken } from './authToken'
import { createRecipientCardPrefetch } from './recipientCardPrefetch'
import { mergeEventCardAssignments, toCalendarEvent, toEventCardAssignment } from '../hooks/storeTransforms'
import type { RawCalendarEvent, RawEventCardAssignment, RawEventCardAssignmentCard } from '../hooks/storeTransforms'
import { assignedServiceScope } from '../utils/cardServiceScope'

export function recipientPreviewEnabled(pathname: string, demoMode: string | undefined) {
  return demoMode === 'true' && pathname === '/recipient-preview'
}

export function createRecipientPreview(userName: string, options: { includeHistories?: boolean; includeSummaries?: boolean } = {}) {
  const token = getAuthToken()
  if (!token) throw new Error('로그인이 필요합니다.')
  let active = true
  const isCurrent = () => active && getAuthToken() === token
  const check = () => { if (!isCurrent()) throw new Error('Recipient preview session changed') }
  const reader = createRecipientCardPrefetch(supabase, { token, isCurrent }, options)

  async function pages<T>(query: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>) {
    const rows: T[] = []
    for (let from = 0; ; from += 1000) {
      check()
      const result = await query(from, from + 999)
      check()
      if (result.error) throw result.error
      if (!Array.isArray(result.data)) throw new Error('Invalid assignment response')
      rows.push(...result.data as T[])
      if (result.data.length < 1000) return rows
    }
  }

  async function readAssignments(knownEventIds?: readonly number[]) {
      const assignments = await pages<RawEventCardAssignment>((from, to) => supabase.from('event_card_assignments')
        .select('*').eq('user_name', userName).order('id').range(from, to))
      if (!assignments.length) return { merged: [], events: [] }
      const linkedCards: RawEventCardAssignmentCard[] = []
      const eventIds = [...new Set(assignments.map((row) => row.event_id))]
      const known = new Set(knownEventIds)
      const events: RawCalendarEvent[] = []
      const readLinks = (ids: number[]) => pages<RawEventCardAssignmentCard>((start, end) => supabase.from('event_card_assignment_cards')
        .select('*').eq('user_name', userName).in('event_id', ids).order('id').range(start, end))
      const readEvents = (ids: number[]) => pages<RawCalendarEvent>((start, end) => supabase.from('calendar_events')
        .select(knownEventIds === undefined ? '*, event_participants(*)' : 'id').in('id', ids).order('id').range(start, end))
      if (knownEventIds !== undefined || import.meta.env.VITE_RECIPIENT_DISCOVERY_REUSE_ENABLED === 'true') {
        for (let from = 0; from < eventIds.length; from += 100) {
          const ids = eventIds.slice(from, from + 100)
          // Both depend only on assignment IDs. Drain both before failure/retry.
          const missing = ids.filter(id => !known.has(id))
          const [links, calendar] = await Promise.allSettled([readLinks(ids), missing.length ? readEvents(missing) : Promise.resolve([])])
          check()
          if (links.status === 'rejected') throw links.reason
          if (calendar.status === 'rejected') throw calendar.reason
          linkedCards.push(...links.value)
          events.push(...calendar.value)
        }
      } else {
        for (let from = 0; from < eventIds.length; from += 100) {
          linkedCards.push(...await readLinks(eventIds.slice(from, from + 100)))
        }
        for (let from = 0; from < eventIds.length; from += 100) {
          events.push(...await readEvents(eventIds.slice(from, from + 100)))
        }
      }
      const merged = mergeEventCardAssignments(assignments.map(toEventCardAssignment), linkedCards)
      return { merged, events, knownIds: eventIds.filter(id => known.has(id)) }
  }

  return {
    reader,
    async assignments() {
      const { merged, events } = await readAssignments()
      return events.map((event) => toCalendarEvent(event, merged.filter((row) => row.eventId === event.id)))
        .filter((event) => assignedServiceScope(event, userName).ids.length > 0)
        .sort((a, b) => b.date.localeCompare(a.date) || b.time.localeCompare(a.time))
    },
    async assignmentCardIds(knownEventIds: readonly number[] = []) {
      // Known IDs belong only to this operation's fresh window, never a cached personal scope.
      const { merged, events, knownIds = [] } = await readAssignments(knownEventIds)
      return [...knownIds, ...events.map(event => event.id)].flatMap(id =>
        assignedServiceScope({ cardAssignments: merged.filter(row => row.eventId === id) }, userName).ids)
    },
    dispose() { active = false; reader.invalidate() },
  }
}
