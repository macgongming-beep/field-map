import { supabase } from '../lib/supabase'
import type { RawCardBoundary } from './storeTransforms'

type BoundaryRow = RawCardBoundary & { updated_at?: string | null }
type BoundaryVersion = Pick<BoundaryRow, 'card_id' | 'updated_at'>

async function readRows<T>(columns: string, ids?: number[]): Promise<T[]> {
  const rows: T[] = []
  for (let from = 0; ; from += 1000) {
    let query = supabase.from('card_boundaries').select(columns).order('card_id')
    if (ids) query = query.in('card_id', ids)
    const { data, error } = await query.range(from, from + 999)
    if (error) throw error
    const page = (data ?? []) as unknown as T[]
    rows.push(...page)
    if (page.length < 1000) return rows
  }
}

// Per-store cache: versions and coordinates always commit together, after all reads succeed.
export function createCardBoundaryReader() {
  let cached: BoundaryRow[] | null = null
  let generation = 0
  return async (recovery: boolean, measure: (data: unknown) => void): Promise<BoundaryRow[] | null> => {
    const request = ++generation
    const full = async () => {
      const rows = await readRows<BoundaryRow>('card_id, points, updated_at')
      measure(rows)
      return rows
    }
    let rows: BoundaryRow[]
    if (!recovery || !cached) rows = await full()
    else {
      try {
        const index = await readRows<BoundaryVersion>('card_id, updated_at')
        measure(index)
        const previous = new Map(cached.map((row) => [row.card_id, row]))
        const changed = index.filter((row) => !row.updated_at || previous.get(row.card_id)?.updated_at !== row.updated_at)
        if (changed.length > 200) rows = await full()
        else {
          const current = new Map(index.flatMap((row) => {
            const old = previous.get(row.card_id)
            return old ? [[row.card_id, old] as const] : []
          }))
          for (let i = 0; i < changed.length; i += 50) {
            const ids = changed.slice(i, i + 50).map((row) => row.card_id)
            const updates = await readRows<BoundaryRow>('card_id, points, updated_at', ids)
            measure(updates)
            // A row may be deleted between the index and coordinate queries.
            ids.forEach((id) => current.delete(id))
            updates.forEach((row) => current.set(row.card_id, row))
          }
          rows = [...current.values()].sort((a, b) => a.card_id - b.card_id)
        }
      } catch {
        rows = await full()
      }
    }
    if (request !== generation) return null
    cached = rows
    return rows
  }
}
