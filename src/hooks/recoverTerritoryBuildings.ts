import { fetchBuildingRecoveryIndex, fetchTerritoryClock } from './territorySync'
import type { TerritoryRealtime } from './territoryRealtimeContext'

export async function recoverTerritoryBuildings(
  checkpoint: TerritoryRealtime['checkpoint'],
  currentIds: number[],
  sync: TerritoryRealtime['sync'],
): Promise<number> {
  const baseline = checkpoint.baseline
  if (!baseline) throw new Error('Territory snapshot has no server watermark')
  const through = await fetchTerritoryClock()
  const since = new Date(Math.max(Date.parse(baseline), Date.parse(checkpoint.buildingsThrough ?? baseline)) - 30_000).toISOString()
  const index = await fetchBuildingRecoveryIndex(since)
  const known = new Set(currentIds)
  const existing = new Set(index.ids)
  const changed = index.signals.filter((row) => checkpoint.applied.get(`${row.card_id}:${row.building_id}`) !== `${row.revision}:${row.changed_at}`)
  const ids = [...new Set([
    ...changed.map((row) => row.building_id),
    ...index.ids.filter((id) => !known.has(id)),
    ...currentIds.filter((id) => !existing.has(id)),
  ])]
  for (let offset = 0; offset < ids.length; offset += 20) {
    await sync(ids.slice(offset, offset + 20))
  }
  // Do not advance after a partial failure. Replaying successful batches is safe.
  changed.forEach((row) => checkpoint.applied.set(`${row.card_id}:${row.building_id}`, `${row.revision}:${row.changed_at}`))
  checkpoint.buildingsThrough = through
  return import.meta.env.DEV ? JSON.stringify(index).length : 0
}
