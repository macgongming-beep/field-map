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

  return {
    reader,
    async assignments() {
      const assignments = await pages<RawEventCardAssignment>((from, to) => supabase.from('event_card_assignments')
        .select('*').eq('user_name', userName).order('id').range(from, to))
      if (!assignments.length) return []
      const linkedCards: RawEventCardAssignmentCard[] = []
      const eventIds = [...new Set(assignments.map((row) => row.event_id))]
      const events: RawCalendarEvent[] = []
      for (let from = 0; from < eventIds.length; from += 100) {
        linkedCards.push(...await pages<RawEventCardAssignmentCard>((start, end) => supabase.from('event_card_assignment_cards')
          .select('*').eq('user_name', userName).in('event_id', eventIds.slice(from, from + 100)).order('id').range(start, end)))
      }
      for (let from = 0; from < eventIds.length; from += 100) {
        events.push(...await pages<RawCalendarEvent>((start, end) => supabase.from('calendar_events')
          .select('*, event_participants(*)').in('id', eventIds.slice(from, from + 100)).order('id').range(start, end)))
      }
      const merged = mergeEventCardAssignments(assignments.map(toEventCardAssignment), linkedCards)
      return events.map((event) => toCalendarEvent(event, merged.filter((row) => row.eventId === event.id)))
        .filter((event) => assignedServiceScope(event, userName).ids.length > 0)
        .sort((a, b) => b.date.localeCompare(a.date) || b.time.localeCompare(a.time))
    },
    dispose() { active = false; reader.invalidate() },
  }
}
