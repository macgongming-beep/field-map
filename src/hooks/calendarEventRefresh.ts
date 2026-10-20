import { supabase } from '../lib/supabase'
import { CART_APPLICATIONS_ENABLED } from '../config/features'
import {
  mergeEventCardAssignments, toCalendarEvent, toEventCardAssignment,
  type RawCalendarEvent, type RawEventCardAssignment, type RawEventCardAssignmentCard,
} from './storeTransforms'

export const CALENDAR_EVENT_COLUMNS = CART_APPLICATIONS_ENABLED
  ? '*, event_participants(*), event_cart_applications(user_id,is_team_lead,created_at,user:app_users!event_cart_applications_user_id_fkey(name))'
  : '*, event_participants(*)'

async function readAssignments<T extends { event_id: number }>(
  table: 'event_card_assignments' | 'event_card_assignment_cards',
  eventId: number,
): Promise<T[]> {
  const rows: T[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from(table).select('*')
      .eq('event_id', eventId).order('id').range(from, from + 999)
    if (error) throw error
    if (!Array.isArray(data) || data.some((row) => row.event_id !== eventId)) {
      throw new Error('Unexpected calendar assignment target')
    }
    rows.push(...data as T[])
    if (data.length < 1000) return rows
  }
}

export async function fetchUpdatedCalendarEvent(eventId: number) {
  if (!Number.isSafeInteger(eventId) || eventId <= 0) throw new Error('Invalid calendar event target')
  const [event, assignments, assignmentCards] = await Promise.all([
    supabase.from('calendar_events').select(CALENDAR_EVENT_COLUMNS).eq('id', eventId).single(),
    readAssignments<RawEventCardAssignment>('event_card_assignments', eventId),
    readAssignments<RawEventCardAssignmentCard>('event_card_assignment_cards', eventId),
  ])
  if (event.error) throw event.error
  const raw = event.data as unknown as RawCalendarEvent | null
  if (!raw || raw.id !== eventId) throw new Error('Unexpected calendar event target')
  const merged = mergeEventCardAssignments(assignments.map(toEventCardAssignment), assignmentCards)
  return toCalendarEvent(raw, merged)
}
