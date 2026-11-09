import { supabase } from '../lib/supabase'
import type { CalendarEvent } from '../types'
import type { ParticipantRow } from './participantSignalReceipts'

type Participants = Pick<CalendarEvent, 'applicants' | 'assigned' | 'guests'>

/** Read membership only. Assignment changes have their own recovery signals. */
export async function readCalendarParticipants(eventIds: number[], onRows?: (rows: Map<number, ParticipantRow[]>) => void) {
  const result = new Map<number, Participants>()
  const snapshots = new Map<number, ParticipantRow[]>()
  if (eventIds.some(id => !Number.isSafeInteger(id) || id <= 0)) throw new Error('Invalid participant event id')
  const ids = [...new Set(eventIds)]
  for (let start = 0; start < ids.length; start += 100) {
    const batch = ids.slice(start, start + 100)
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase.from('calendar_events')
        .select(onRows ? 'id,event_participants(id,user_name,role)' : 'id,event_participants(user_name,role)').in('id', batch).order('id').range(from, from + 999)
      if (error) throw error
      if (!Array.isArray(data) || data.some(row => !batch.includes(row.id) || !Array.isArray(row.event_participants)
        || row.event_participants.some((p: { user_name?: unknown; role?: unknown }) => typeof p.user_name !== 'string' || typeof p.role !== 'string'))) {
        throw new Error('Invalid calendar participants response')
      }
      for (const row of data) result.set(row.id, {
        applicants: row.event_participants.map(p => p.user_name),
        assigned: row.event_participants.filter(p => p.role === '입명').map(p => p.user_name),
        guests: row.event_participants.filter(p => p.role === '게스트').map(p => p.user_name),
      })
      if (onRows) for (const row of data) {
        const members = row.event_participants as ParticipantRow[]
        if (members.some(p => !Number.isSafeInteger(p.id) || p.id <= 0)
          || new Set(members.map(p => p.id)).size !== members.length || snapshots.has(row.id)) {
          throw new Error('Invalid participant proof rows')
        }
        snapshots.set(row.id, members)
      }
      if (data.length < 1000) break
    }
  }
  onRows?.(snapshots)
  return result
}
