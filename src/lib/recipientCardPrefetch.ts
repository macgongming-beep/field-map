import type { SupabaseClient } from '@supabase/supabase-js'
import type { CardSummary } from './cardSummaries'
import type { RawBuilding, RawUnit, RawVisitHistory } from '../hooks/storeTransforms'

export const RECIPIENT_BUILDING_COLUMNS = 'id, card_id, name, address, type, lat, lng, warning, access_status, memo, is_restaurant, units_surveyed, building_access_events(id, action, visitor_name, visited_at, time_slot, memo, created_at)'
export const RECIPIENT_UNIT_COLUMNS = 'id, building_id, number, status, is_chinese, is_restaurant, usage_type, memo, regular_visits(visitor_name, registered_at)'
export const RECIPIENT_HISTORY_COLUMNS = 'id, unit_id, visitor_name, result, time_slot, memo, visited_at, service_session_id, special_period_id, invitation_left, created_at, created_by_user_id'

type BoundaryRow = { card_id: number; points: unknown; updated_at: string | null }
export type RecipientCardDetails = {
  buildings: RawBuilding[]
  histories: RawVisitHistory[]
  boundaries: BoundaryRow[]
  baseline: string | null
}
export type RecipientCardLoad = {
  summaries: Promise<CardSummary[]>
  details: Promise<RecipientCardDetails>
}

function normalizeIds(ids: number[]) {
  if (ids.some((id) => !Number.isSafeInteger(id) || id <= 0 || id > 2147483647)) {
    throw new Error('Invalid card ID')
  }
  return [...new Set(ids)].sort((a, b) => a - b)
}

/** One in-memory prefetcher per authenticated session. No persistent coordinates. */
export function createRecipientCardPrefetch(
  client: Pick<SupabaseClient, 'from' | 'rpc'>,
  session: { token: string; isCurrent: () => boolean },
  options: { includeHistories?: boolean; includeSummaries?: boolean } = {},
) {
  let generation = 0
  const entries = new Map<string, { ids: number[]; load: RecipientCardLoad }>()

  const check = (requestGeneration: number) => {
    if (!session.token || !session.isCurrent() || requestGeneration !== generation) {
      throw new Error('Recipient prefetch session or scope changed')
    }
  }

  async function pages<T>(requestGeneration: number, query: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>) {
    const rows: T[] = []
    for (let from = 0; ; from += 1000) {
      check(requestGeneration)
      const result = await query(from, from + 999)
      check(requestGeneration)
      if (result.error) throw result.error
      if (!Array.isArray(result.data)) throw new Error('Invalid recipient detail response')
      rows.push(...result.data as T[])
      if (result.data.length < 1000) return rows
    }
  }

  async function readSummaries(ids: number[], requestGeneration: number) {
    const rows: CardSummary[] = []
    for (let from = 0; from < ids.length; from += 200) {
      check(requestGeneration)
      const batch = ids.slice(from, from + 200)
      const { data, error } = await client.rpc('get_card_summaries', { p_token: session.token, p_card_ids: batch })
      check(requestGeneration)
      if (error) throw error
      if (!Array.isArray(data) || data.some((row) => !row || !batch.includes(row.id))
        || new Set(data.map((row) => row.id)).size !== batch.length) {
        throw new Error('A requested card is unavailable')
      }
      rows.push(...data as CardSummary[])
    }
    return rows
  }

  async function readDetails(ids: number[], requestGeneration: number): Promise<RecipientCardDetails> {
    if (!ids.length) return { buildings: [], histories: [], boundaries: [], baseline: null }
    check(requestGeneration)
    // Capture before any detail reads; failed clocks must not prevent initial loading.
    let baseline: string | null = null
    try {
      const clock = await client.rpc('territory_sync_clock')
      if (!clock.error && typeof clock.data === 'string' && Number.isFinite(Date.parse(clock.data))) baseline = clock.data
    } catch { /* Recovery will need a fresh scoped read until a clock is available. */ }
    check(requestGeneration)
    const buildings: RawBuilding[] = []
    const boundaries: BoundaryRow[] = []
    const units: RawUnit[] = []
    const histories: RawVisitHistory[] = []
    for (let from = 0; from < ids.length; from += 100) {
      const batch = ids.slice(from, from + 100)
      const [buildingRows, boundaryRows, unitRows] = await Promise.all([
        pages<RawBuilding>(requestGeneration, (start, end) => client.from('buildings')
          .select(RECIPIENT_BUILDING_COLUMNS).in('card_id', batch).order('id').range(start, end)),
        pages<BoundaryRow>(requestGeneration, (start, end) => client.from('card_boundaries')
          .select('card_id,points,updated_at').in('card_id', batch).order('card_id').range(start, end)),
        // The real store already owns global histories. Read units by card in parallel,
        // but keep top-level pagination so large buildings cannot truncate their units.
        options.includeHistories === false ? pages<RawUnit & { buildings: { card_id: number } }>(requestGeneration, (start, end) => client.from('units')
          .select(`${RECIPIENT_UNIT_COLUMNS}, buildings!inner(card_id)`)
          .in('buildings.card_id', batch).order('id').range(start, end)) : Promise.resolve([]),
      ])
      if (buildingRows.some((row) => !batch.includes(row.card_id)) || boundaryRows.some((row) => !batch.includes(row.card_id))) {
        throw new Error('Out-of-scope recipient detail response')
      }
      buildings.push(...buildingRows)
      boundaries.push(...boundaryRows)
      if (unitRows.some((row) => !batch.includes(row.buildings?.card_id))) throw new Error('Out-of-scope recipient child response')
      units.push(...unitRows.map((row) => {
        const { buildings: parent, ...unit } = row
        void parent
        return unit as RawUnit
      }))
    }
    const cutoff = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString()
    for (let from = 0; options.includeHistories !== false && from < buildings.length; from += 100) {
      const batch = buildings.slice(from, from + 100).map((building) => building.id)
      const [unitRows, historyRows] = await Promise.all([
        pages<RawUnit>(requestGeneration, (start, end) => client.from('units')
          .select(RECIPIENT_UNIT_COLUMNS).in('building_id', batch).order('id').range(start, end)),
        pages<RawVisitHistory & { units: { building_id: number } }>(requestGeneration, (start, end) => client.from('visit_histories')
          .select(`${RECIPIENT_HISTORY_COLUMNS}, units!inner(building_id)`)
          .in('units.building_id', batch).is('invalidated_at', null).gte('created_at', cutoff).order('id').range(start, end)),
      ])
      if (unitRows.some((row) => !batch.includes(row.building_id))
        || historyRows.some((row) => !batch.includes(row.units?.building_id))) {
        throw new Error('Out-of-scope recipient child response')
      }
      units.push(...unitRows)
      histories.push(...historyRows)
    }
    check(requestGeneration)
    const byBuilding = new Map<number, RawUnit[]>()
    for (const unit of units) {
      const group = byBuilding.get(unit.building_id) ?? []
      group.push(unit)
      byBuilding.set(unit.building_id, group)
    }
    return {
      buildings: buildings.map((building) => ({ ...building, units: byBuilding.get(building.id) ?? [] })),
      histories,
      boundaries,
      baseline,
    }
  }

  function prefetch(cardIds: number[]): RecipientCardLoad {
    const ids = normalizeIds(cardIds)
    const requestGeneration = generation
    check(requestGeneration)
    if (!ids.length) return { summaries: Promise.resolve([]), details: Promise.resolve({ buildings: [], histories: [], boundaries: [], baseline: null }) }
    // A single-card map reuses its team's in-flight prefetch instead of downloading it again.
    const covering = [...entries.values()].find((entry) => ids.every((id) => entry.ids.includes(id)))
    if (covering) {
      const load = {
        summaries: covering.load.summaries.then((rows) => { check(requestGeneration); return rows.filter((row) => ids.includes(row.id)) }),
        details: covering.load.details.then((data) => {
          check(requestGeneration)
          const buildings = data.buildings.filter((building) => ids.includes(building.card_id))
          const unitIds = new Set(buildings.flatMap((building) => (building.units ?? []).map((unit) => unit.id)))
          return { ...data, buildings, boundaries: data.boundaries.filter((row) => ids.includes(row.card_id)), histories: data.histories.filter((row) => unitIds.has(row.unit_id)) }
        }),
      }
      void load.summaries.catch(() => {})
      void load.details.catch(() => {})
      return load
    }
    const key = ids.join(',')
    // useStore validates the full card summary set itself; do not fetch a subset twice.
    const summaries = options.includeSummaries === false ? Promise.resolve([]) : readSummaries(ids, requestGeneration)
    const details = summaries.then(() => readDetails(ids, requestGeneration))
    const load = { summaries, details }
    entries.set(key, { ids, load })
    // Handle background failures even when the user never opens the map. Awaiting details still rejects.
    void details.catch(() => { if (entries.get(key)?.load === load) entries.delete(key) })
    return load
  }

  return {
    prefetch,
    // Call on logout, assignment changes, and mutations before starting fresh scoped reads.
    invalidate() { generation += 1; entries.clear() },
  }
}
