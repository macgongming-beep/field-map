import type { Building, VisitHistory } from '../types'

export type RecipientSnapshot = { buildings: Building[]; histories: VisitHistory[] }

export function mergeRecipientSnapshot(current: RecipientSnapshot, changed: RecipientSnapshot, ids: number[], cardIds: number[]): RecipientSnapshot {
  const affected = new Set(ids)
  const incoming = changed.buildings.filter((b) => affected.has(b.id) && cardIds.includes(b.cardId))
  const incomingUnits = new Set(incoming.flatMap((b) => b.units.map((u) => u.id)))
  const retained = current.buildings.filter((b) => !affected.has(b.id))
  // A moved unit may arrive at its destination before its old building is refreshed.
  const retainedUnits = new Set(retained.flatMap((b) => b.units.map((u) => u.id)))
  const removedUnits = new Set(current.buildings.filter((b) => affected.has(b.id)).flatMap((b) => b.units.map((u) => u.id)))
  return {
    buildings: [...retained, ...incoming],
    histories: [
      ...current.histories.filter((h) => !incomingUnits.has(h.unitId) && (!removedUnits.has(h.unitId) || retainedUnits.has(h.unitId))),
      ...changed.histories.filter((h) => incomingUnits.has(h.unitId)),
    ],
  }
}
