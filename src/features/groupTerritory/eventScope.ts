import type { CalendarEvent, TerritoryCard } from '../../types'
import type { ServiceGroup } from '../groupService/directory'

// The event, never the arranging leader's membership, determines the candidates.
export function eventTerritoryScope(event: CalendarEvent, cards: TerritoryCard[], groups: ServiceGroup[], enabled: boolean) {
  if (!enabled || (event.serviceKind !== 'group' && !event.groupServiceScope)) return null
  const codes = new Set(event.targetGroups ?? [])
  return {
    name: [...codes].map(code => groups.find(group => group.code === code)?.name ?? code).join(' · '),
    cards: cards.filter(card => card.assignedGroupCodes?.some(code => codes.has(code))),
  }
}
