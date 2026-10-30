import { supabase } from '../lib/supabase'
import { getAuthToken } from '../lib/authToken'

type SuggestionIndex = { id: number; last_used_at: string | null; created_at: string | null }

let cached: { token: string; key: string; at: number; rows: Record<string, unknown>[] } | null = null
let generation = 0
export function invalidateHomeSuggestion() { cached = null; ++generation }

export function selectHomeSuggestion(rows: SuggestionIndex[]): number | undefined {
  return [...rows].sort((a, b) => {
    const time = (row: SuggestionIndex) => Date.parse(row.last_used_at || row.created_at || '') || 0
    return time(b) - time(a)
  })[0]?.id
}

export async function readHomeServiceSuggestion() {
  const reuse = import.meta.env.VITE_DEMO_MODE === 'true'
  const token = getAuthToken()
  const version = ++generation
  const started = Date.now()
  if (cached?.token !== token) cached = null
  const check = () => {
    if (reuse && (getAuthToken() !== token || version !== generation)) throw new Error('Home suggestion superseded')
  }
  const rows: SuggestionIndex[] = []
  // Preserve the existing effective-date selection without downloading every body.
  for (let from = 0; ; from += 1000) {
    const result = await supabase.from('service_suggestions')
      .select('id,last_used_at,created_at').eq('is_visible', true)
      .order('created_at', { ascending: false }).order('id').range(from, from + 999)
    if (result.error) throw result.error
    check()
    rows.push(...result.data as SuggestionIndex[])
    if (result.data.length < 1000) break
  }
  const id = selectHomeSuggestion(rows)
  if (id === undefined) { if (reuse) cached = null; return [] }
  const selected = rows.find(row => row.id === id)!
  const key = JSON.stringify(selected)
  // App writes to a visible suggestion always advance last_used_at. Recheck the
  // visible index on every entry; TTL also bounds edits outside the app contract.
  const age = cached ? Date.now() - cached.at : -1
  if (reuse && token && selected.last_used_at && cached?.key === key && age >= 0 && age < 120_000) return cached.rows
  // Recheck visibility: a hidden/deleted suggestion must not appear after the index read.
  const result = await supabase.from('service_suggestions').select('*')
    .eq('id', id).eq('is_visible', true).limit(1)
  if (result.error) throw result.error
  check()
  if (reuse && token && result.data.length === 1
    && result.data[0].id === id && result.data[0].last_used_at === selected.last_used_at
    && result.data[0].created_at === selected.created_at) {
    cached = { token, key, at: started, rows: result.data }
  } else if (reuse) cached = null
  return result.data
}
