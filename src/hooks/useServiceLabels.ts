import { useEffect, useState } from 'react'
import type { CardLabel } from '../lib/cardDirectory'
import { readPlaceLabels, type PlaceLabel } from '../lib/placeLabels'
import { useCardDirectoryRead } from './useCardDirectory'
import type { Building } from '../types'

const uniqueSorted = (ids: number[]) => [...new Set(ids)].sort((a, b) => a - b)

/**
 * Card names for 나의 봉사 rows. Cards already in the store win; only when one is missing
 * are all the requested names read (id,name), so a store that fills in meanwhile never
 * restarts the read. A requested card is `pending` until its name is known, so the row is
 * never dropped or counted as "no assigned card" while loading.
 */
export function useAssignmentCardLabels(ids: number[], cards: CardLabel[]) {
  const needed = uniqueSorted(ids)
  const known = new Map(cards.map(card => [card.id, card]))
  const anyMissing = needed.some(id => !known.has(id))
  const read = useCardDirectoryRead(needed, anyMissing)
  const fetched = new Map(read.rows.map(row => [row.id, row]))
  const label = (id: number): CardLabel | undefined => known.get(id) ?? fetched.get(id)
  return {
    label,
    pending: (id: number) => !label(id) && anyMissing && read.loading,
    error: anyMissing && read.error && needed.some(id => !label(id)),
    retry: read.retry,
  }
}

type PlaceRequest = { buildingId: number; unitId: number | null }
type PlaceState = { key: string; attempt: number; rows: PlaceLabel[]; error: boolean }

/** Assigned restaurant names: store buildings first, otherwise a display-only label read. */
export function usePlaceLabels(requests: PlaceRequest[], buildings: Building[]) {
  const buildingIds = uniqueSorted(requests.map(request => request.buildingId))
  const unitIds = uniqueSorted(requests.flatMap(request => request.unitId == null ? [] : [request.unitId]))
  // As before: a known building is enough; a unit missing from it just shows the building.
  const fromStore = (request: PlaceRequest) => buildings.find(item => item.id === request.buildingId)
  const anyMissing = requests.some(request => !fromStore(request))
  const key = `${buildingIds.join(',')}|${unitIds.join(',')}`
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<PlaceState | null>(null)
  useEffect(() => {
    if (!anyMissing || !buildingIds.length) return
    let active = true
    // A late response for an earlier request (or an earlier session) is ignored.
    void readPlaceLabels(buildingIds, unitIds).then(
      rows => { if (active) setState({ key, attempt, rows, error: false }) },
      () => { if (active) setState({ key, attempt, rows: [], error: true }) })
    return () => { active = false }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- key covers both id lists
  }, [key, anyMissing, attempt])
  const current = anyMissing && state?.key === key && state.attempt === attempt ? state : null
  const loading = anyMissing && buildingIds.length > 0 && current == null
  const place = (request: PlaceRequest) => {
    const building = fromStore(request)
    if (building) {
      const unit = request.unitId != null ? building.units.find(item => item.id === request.unitId) : null
      return { name: building.name, address: building.address, lat: building.lat, lng: building.lng, cardId: building.cardId, unitNumber: unit?.number ?? null }
    }
    const label = current?.rows.find(row => row.id === request.buildingId)
    if (!label) return undefined
    const unit = request.unitId != null ? label.units.find(item => item.id === request.unitId) : null
    return { name: label.name, address: label.address, lat: label.lat, lng: label.lng, cardId: label.cardId, unitNumber: unit?.number ?? null }
  }
  return {
    place,
    pending: (request: PlaceRequest) => !place(request) && loading,
    error: anyMissing && (current?.error ?? false) && requests.some(request => !place(request)),
    retry: () => setAttempt(value => value + 1),
  }
}
