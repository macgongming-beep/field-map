import { supabase } from '../lib/supabase'

type SuggestionIndex = { id: number; last_used_at: string | null; created_at: string | null }

export function selectHomeSuggestion(rows: SuggestionIndex[]): number | undefined {
  return [...rows].sort((a, b) => {
    const time = (row: SuggestionIndex) => Date.parse(row.last_used_at || row.created_at || '') || 0
    return time(b) - time(a)
  })[0]?.id
}

export async function readHomeServiceSuggestion() {
  const rows: SuggestionIndex[] = []
  // Preserve the existing effective-date selection without downloading every body.
  for (let from = 0; ; from += 1000) {
    const result = await supabase.from('service_suggestions')
      .select('id,last_used_at,created_at').eq('is_visible', true)
      .order('created_at', { ascending: false }).order('id').range(from, from + 999)
    if (result.error) throw result.error
    rows.push(...result.data as SuggestionIndex[])
    if (result.data.length < 1000) break
  }
  const id = selectHomeSuggestion(rows)
  if (id === undefined) return []
  // Recheck visibility: a hidden/deleted suggestion must not appear after the index read.
  const result = await supabase.from('service_suggestions').select('*')
    .eq('id', id).eq('is_visible', true).limit(1)
  if (result.error) throw result.error
  return result.data
}
