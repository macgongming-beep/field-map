import { createBuildingRefreshQueue } from './buildingRefreshQueue'
import { SupersededReadError } from './supersededRead'
import type { TerritorySignal } from './territorySync'

export const visitSignalDedupEnabled = (queued: boolean, flag = import.meta.env.VITE_VISIT_SIGNAL_DEDUP_ENABLED) => queued && flag === 'true'

const key = (row: TerritorySignal) => `${row.card_id}:${row.building_id}`
const version = (row: TerritorySignal) => `${row.revision}:${row.changed_at}`

/** A receipt covers only committed signals read BEFORE an applied data snapshot. */
export function createVisitSignalQueue(
  readData: (ids: number[], canApply: () => boolean) => Promise<boolean>,
  readProof?: (ids: number[]) => Promise<TerritorySignal[]>,
) {
  const receipts = new Map<string, string>()
  const pending = new Set<{ ids: number[]; promise: Promise<void>; signals?: TerritorySignal[] }>()
  let generation = 0
  const queue = createBuildingRefreshQueue(async (ids, canApply) => {
    const requests = [...pending].filter(request => request.ids.some(id => ids.includes(id)))
    // Signal-only reads already have committed evidence before the data read.
    // Only post-write callers need an extra server proof, not every observer.
    const signals = readProof && requests.some(request => !request.signals)
      ? await readProof(ids)
      : requests.flatMap(request => request.signals ?? []).filter(row => ids.includes(row.building_id))
    const applied = await readData(ids, canApply)
    if (applied && canApply()) signals.forEach(row => receipts.set(key(row), version(row)))
    return applied
  })
  const read = (ids: number[], signals?: TerritorySignal[]) => {
    const promise = queue.read(ids)
    const request = { ids: [...ids], promise, signals }
    pending.add(request)
    void promise.then(() => pending.delete(request), () => pending.delete(request))
    return promise
  }
  return {
    read: (ids: number[]) => read(ids),
    async signals(rows: TerritorySignal[]) {
      const epoch = generation
      const ids = new Set(rows.map(row => row.building_id))
      // This does not join a pre-write read for a mutation: only signal callers
      // wait here. Forced post-write callers always enter queue.read themselves.
      while (true) {
        const overlaps = [...pending].filter(request => request.ids.some(id => ids.has(id)))
        if (!overlaps.length) break
        await Promise.allSettled(overlaps.map(request => request.promise))
        if (epoch !== generation) throw new SupersededReadError('Signal queue reset')
      }
      if (epoch !== generation) throw new SupersededReadError('Signal queue reset')
      const missing = rows.filter(row => receipts.get(key(row)) !== version(row))
      if (missing.length) await read([...new Set(missing.map(row => row.building_id))], missing)
    },
    reset() {
      ++generation
      receipts.clear()
      queue.reset()
    },
  }
}
