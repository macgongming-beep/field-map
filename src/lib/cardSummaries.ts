import { supabase } from './supabase'
import { getAuthToken } from './authToken'
import type { TerritoryCard } from '../types'

// A summary is not a fully loaded TerritoryCard: regularVisitPoints are deliberately absent.
export type CardSummary = Pick<TerritoryCard,
  'id' | 'name' | 'area' | 'region' | 'status' | 'buildings' | 'units' | 'completed' | 'progress' | 'regularVisits'
> & {
  houseUnits: number
  shopUnits: number
  houseCompleted: number
  shopCompleted: number
  houseBuildings: number
  shopBuildings: number
}

export async function fetchCardSummaries(cardIds: number[]): Promise<CardSummary[]> {
  if (cardIds.some((id) => !Number.isSafeInteger(id) || id <= 0 || id > 2147483647)) {
    throw new Error('Invalid card ID')
  }
  const ids = [...new Set(cardIds)].sort((a, b) => a - b)
  if (!ids.length) return []
  const token = getAuthToken()
  if (!token) throw new Error('로그인이 필요합니다.')
  const result: CardSummary[] = []
  for (let offset = 0; offset < ids.length; offset += 200) {
    const batch = ids.slice(offset, offset + 200)
    const { data, error } = await supabase.rpc('get_card_summaries', { p_token: token, p_card_ids: batch })
    if (error) throw error
    if (!Array.isArray(data) || data.some((row) => !row || !batch.includes(row.id))) {
      throw new Error('Invalid card summary response')
    }
    result.push(...data as CardSummary[])
  }
  return result
}
