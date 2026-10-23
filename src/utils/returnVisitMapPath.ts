import type { Building, ReturnVisit } from '../types'
import { findReturnVisitBuilding } from './returnVisits'
import { isValidMapCoordinate } from './mapUtils'

/** Detail and list maps must use the same personal return-visit scope. */
export function returnVisitMapPath(visit: ReturnVisit | undefined, buildings: Building[]) {
  const params = new URLSearchParams({ scope: 'regularVisits' })
  if (visit) {
    params.set('returnVisitId', String(visit.id))
    const building = findReturnVisitBuilding(visit, buildings)
    if (building && isValidMapCoordinate(Number(building.lat), Number(building.lng))) {
      params.set('buildingId', String(building.id))
    } else if (visit.address.trim()) {
      params.set('addr', visit.address.trim())
      params.set('pinLabel', visit.nickname || visit.displayName)
    }
  }
  return `/map?${params.toString()}`
}
