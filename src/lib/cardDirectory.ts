import { supabase } from './supabase'
import { getAuthToken } from './authToken'

export type CardLabel = { id: number; name: string }
export type CardDirectoryEntry = CardLabel & { area: string; region: string }

export async function readCardDirectory(): Promise<CardDirectoryEntry[]>
export async function readCardDirectory(ids: number[]): Promise<CardLabel[]>
export async function readCardDirectory(ids?: number[]): Promise<CardLabel[]> {
  const token = getAuthToken()
  const check = () => { if (!token || getAuthToken() !== token) throw new Error('Card directory session changed') }
  check()
  const unique = ids == null ? null : [...new Set(ids)]
  if (unique?.some(id => !Number.isSafeInteger(id) || id <= 0)) throw new Error('Invalid card ids')
  const rows: CardLabel[] = []
  const batches = unique == null ? [null] : Array.from({ length: Math.ceil(unique.length / 100) }, (_, i) => unique.slice(i * 100, (i + 1) * 100))
  for (const batch of batches) {
    for (let from = 0; ; from += 1000) {
      check()
      let query = supabase.from('cards').select(batch == null ? 'id,name,area,region' : 'id,name').order('id')
      if (batch != null) query = query.in('id', batch)
      const result = await query.range(from, from + 999)
      check()
      if (result.error) throw result.error
      if (!Array.isArray(result.data)) throw new Error('Invalid card directory')
      for (const value of result.data as unknown as Record<string, unknown>[]) {
        if (!Number.isSafeInteger(value.id) || (value.id as number) <= 0 || typeof value.name !== 'string'
          || (batch != null && !batch.includes(value.id as number))) throw new Error('Invalid card directory row')
        rows.push(batch == null
          ? { id: value.id as number, name: value.name, area: typeof value.area === 'string' ? value.area : '', region: typeof value.region === 'string' ? value.region : '' } as CardDirectoryEntry
          : { id: value.id as number, name: value.name })
      }
      if (result.data.length < 1000) break
    }
  }
  if (new Set(rows.map(row => row.id)).size !== rows.length) throw new Error('Duplicate card directory row')
  // Missing/deleted cards remain visibly unresolved; never invent a zero-progress card.
  return rows
}
