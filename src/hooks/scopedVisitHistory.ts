import { supabase } from '../lib/supabase'
import type { RawVisitHistory } from './storeTransforms'

export const VISIT_HISTORY_COLUMNS = 'id, unit_id, visitor_name, result, time_slot, memo, visited_at, service_session_id, special_period_id, invitation_left, created_at, created_by_user_id, visit_type'

export function scopedVisitHistoryEnabled(role: string, recipient: boolean) {
  return (import.meta.env.VITE_SCOPED_VISIT_HISTORY_ENABLED ?? import.meta.env.VITE_DEMO_MODE) === 'true'
    && role === 'user' && recipient
}

/** All visitors and all pages for the loaded units, with the same annual window as statistics. */
export async function readScopedVisitHistories(unitIds: number[], since: string): Promise<RawVisitHistory[]> {
  const ids = [...new Set(unitIds)]
  if (ids.some(id => !Number.isSafeInteger(id) || id <= 0) || !Number.isFinite(Date.parse(since))) {
    throw new Error('Invalid visit history scope')
  }
  const rows: RawVisitHistory[] = []
  const seen = new Set<number>()
  for (let start = 0; start < ids.length; start += 100) {
    const batch = ids.slice(start, start + 100)
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase.from('visit_histories').select(VISIT_HISTORY_COLUMNS)
        .in('unit_id', batch).is('invalidated_at', null).gte('created_at', since)
        .order('created_at', { ascending: false }).order('id', { ascending: false }).range(from, from + 999)
      if (error) throw error
      if (!Array.isArray(data) || data.some(row => !batch.includes(row.unit_id)
        || !Number.isSafeInteger(row.id) || seen.has(row.id))) throw new Error('Invalid scoped visit history response')
      for (const row of data) {
        if (seen.has(row.id)) throw new Error('Duplicate visit history')
        seen.add(row.id)
        rows.push(row as RawVisitHistory)
      }
      if (data.length < 1000) break
    }
  }
  return rows.sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? '') || b.id - a.id)
}
