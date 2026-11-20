import type { TerritoryCard } from '../../types'
import type { ServiceGroup } from '../groupService/directory'

// Explicit opt-in: an old database must never receive the new relation projection.
export function groupTerritoryEnabled(value = import.meta.env.VITE_GROUP_TERRITORY_ENABLED) {
  return value === 'true'
}
export function ownTerritoryGroup(groups: ServiceGroup[], groupName?: string | null) {
  return groups.find(group => group.active && group.name === groupName)?.code ?? null
}
export function groupOwnsCard(card: TerritoryCard, code: string | null) {
  return code !== null && (card.assignedGroupCodes ?? []).includes(code)
}
export function territoryGroupNames(card: TerritoryCard, groups: ServiceGroup[]) {
  return (card.assignedGroupCodes ?? []).map(code => groups.find(group => group.code === code)?.name ?? code)
}
