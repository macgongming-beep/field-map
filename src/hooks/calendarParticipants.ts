import { supabase } from '../lib/supabase'
import type { CalendarEvent } from '../types'
import { assignmentRevisionEnabled } from '../config/assignmentRevision'

type Participants = Pick<CalendarEvent, 'applicants' | 'assigned' | 'guests' | 'returnVisitApplicants' | 'assignmentRevision'>

/** Read membership only. Assignment changes have their own recovery signals. */
export async function readCalendarParticipants(eventIds: number[]) {
  const result = new Map<number, Participants>()
  const activity = assignmentRevisionEnabled()
  const versioned = assignmentRevisionEnabled()
  const columns = `id${versioned?',assignment_revision':''},event_participants(user_name,role${activity ? ',service_activity' : ''})`
  if (eventIds.some(id => !Number.isSafeInteger(id) || id <= 0)) throw new Error('Invalid participant event id')
  const ids = [...new Set(eventIds)]
  for (let start = 0; start < ids.length; start += 100) {
    const batch = ids.slice(start, start + 100)
    for (let from = 0; ; from += 1000) {
      const { data: raw, error } = await supabase.from('calendar_events')
        .select(columns).in('id', batch).order('id').range(from, from + 999)
      if (error) throw error
      const data = raw as unknown as Array<{id:number;assignment_revision?:number|string;event_participants:Array<{id?:number;user_name:string;role:string;service_activity?:string}>}>
      if (!Array.isArray(data) || data.some(row => !batch.includes(row.id) || !Array.isArray(row.event_participants)
        || row.event_participants.some(p => typeof p.user_name !== 'string' || typeof p.role !== 'string'
          || (activity && !['service','return_visit'].includes(p.service_activity ?? ''))))) {
        throw new Error('Invalid calendar participants response')
      }
      for (const row of data) result.set(row.id, {
        ...(versioned&&row.assignment_revision!=null?{assignmentRevision:String(row.assignment_revision)}:{}),
        applicants: row.event_participants.map(p => p.user_name),
        assigned: row.event_participants.filter(p => p.role === '입명').map(p => p.user_name),
        guests: row.event_participants.filter(p => p.role === '게스트').map(p => p.user_name),
        ...(activity ? { returnVisitApplicants: row.event_participants.filter(p => p.service_activity === 'return_visit').map(p => p.user_name) } : {}),
      })
      if (data.length < 1000) break
    }
  }
  return result
}
