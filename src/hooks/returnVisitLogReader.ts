import { supabase } from '../lib/supabase'
import { getAuthToken } from '../lib/authToken'
import type { ReturnVisitLog } from '../types'

export const lazyReturnVisitLogsEnabled = () =>
  (import.meta.env.VITE_LAZY_RETURN_VISIT_LOGS_ENABLED ?? import.meta.env.VITE_DEMO_MODE) === 'true'

export async function readReturnVisitLogs(returnVisitId: number): Promise<ReturnVisitLog[]> {
  const token = getAuthToken()
  if (!token || !Number.isSafeInteger(returnVisitId) || returnVisitId <= 0) throw new Error('Invalid return visit session or target')
  const check = () => { if (getAuthToken() !== token) throw new Error('Return visit session changed') }
  const rows: ReturnVisitLog[] = []
  for (let from = 0; ; from += 1000) {
    check()
    const { data, error } = await supabase.from('return_visit_logs')
      .select('id,return_visit_id,visited_at,result,memo,created_by')
      .eq('return_visit_id', returnVisitId).is('invalidated_at', null)
      .order('visited_at', { ascending: false }).order('id', { ascending: false })
      .range(from, from + 999)
    check()
    if (error) throw error
    for (const row of data ?? []) {
      if (row.return_visit_id !== returnVisitId) throw new Error('Unexpected return visit log target')
      rows.push({ id: row.id, returnVisitId: row.return_visit_id, visitedAt: row.visited_at,
        result: row.result, memo: row.memo ?? '', createdBy: row.created_by ?? '' })
    }
    if ((data?.length ?? 0) < 1000) return rows
  }
}
