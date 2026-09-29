import type { Building, CalendarEvent } from '../types'
import { msg } from '../lib/msg'
import { scopeBuildingToUsage, type UnitUsageFilter } from './unitUsage'

export const cardServiceLabel = (scope: UnitUsageFilter) => scope === '주택'
  ? msg('주택 봉사') : scope === '상가' ? msg('상가 봉사') : msg('주택·상가 전체')

export function assignedServiceScope(event: CalendarEvent | undefined, userName: string) {
  const assignment = event?.cardAssignments.find((a) => a.userName === userName)
  const ids = assignment?.assignedCardIds?.length ? assignment.assignedCardIds
    : assignment?.assignedCardId != null ? [assignment.assignedCardId] : []
  return { ids, scope: assignment?.cardScope ?? '전체' as UnitUsageFilter }
}

export function scopeServiceBuildings(buildings: Building[], ids: number[], scope: UnitUsageFilter) {
  return buildings.filter((b) => ids.includes(b.cardId))
    .map((b) => scopeBuildingToUsage(b, scope))
    .filter((b) => scope === '전체' || b.units.length > 0)
}
