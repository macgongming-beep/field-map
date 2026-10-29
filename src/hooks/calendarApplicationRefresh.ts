import { supabase } from '../lib/supabase'

// DELETE may have cleaned up a team assigned after the local snapshot was read.
// The cleanup trigger advances assignment_shared_at even when the last team leaves.
export async function assertUnassignedCalendarEvent(eventId: number) {
  const { data, error } = await supabase.from('calendar_events')
    .select('id,assignment_shared_at,assignment_team_informal,assignment_team_scopes')
    .eq('id', eventId).single()
  if (error) throw error
  if (!data || data.id !== eventId || data.assignment_shared_at !== null
    || data.assignment_team_informal !== null
    || !data.assignment_team_scopes || typeof data.assignment_team_scopes !== 'object'
    || Array.isArray(data.assignment_team_scopes) || Object.keys(data.assignment_team_scopes).length > 0) {
    throw new Error('Participant removal requires assignment recovery')
  }
}
