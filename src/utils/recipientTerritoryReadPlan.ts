import type { CalendarEvent, EventRestaurantAssignment, ReturnVisit, ServiceSession, TerritoryCard } from '../types'
import { assignedServiceScope } from './cardServiceScope'
import { getUserReturnVisits } from './returnVisits'

type Request =
  | { kind: 'event'; event: CalendarEvent; cardId?: number }
  | { kind: 'my-cards'; cards: Pick<TerritoryCard, 'id' | 'assignedUsers'>[]; sessions: ServiceSession[]; today: string }
  | { kind: 'return-visits'; visits: ReturnVisit[] }
  | { kind: 'restaurant-event'; eventId: number; assignments: EventRestaurantAssignment[] }
  | { kind: 'informal' }

export type RecipientTerritoryReadPlan = {
  cardIds: number[]
  buildingIds: number[]
  unitIds: number[]
  returnVisitIds: number[]
}

const uniqueIds = (ids: number[]) => [...new Set(ids.filter((id) => Number.isSafeInteger(id) && id > 0))].sort((a, b) => a - b)

/**
 * Proposed recipient detail-read contract; not wired to useStore yet.
 * Metadata must be loaded first. This is a fetch plan, never an authorization check.
 * Empty IDs mean no request, not an unfiltered query.
 */
export function planRecipientTerritoryRead(userName: string, request: Request): RecipientTerritoryReadPlan {
  const plan: RecipientTerritoryReadPlan = { cardIds: [], buildingIds: [], unitIds: [], returnVisitIds: [] }
  if (!userName.trim()) return plan

  switch (request.kind) {
    case 'event':
      // Usage filtering belongs to the view: mixed buildings need all units for stats.
      plan.cardIds = assignedServiceScope(request.event, userName, request.cardId).ids
      break
    case 'my-cards':
      plan.cardIds = [
        ...request.cards.filter((card) => card.assignedUsers.includes(userName)).map((card) => card.id),
        ...request.sessions.filter((session) => session.userName === userName
          && session.serviceDate === request.today && session.status === 'active' && !session.endedAt)
          .flatMap((session) => session.primaryCardId == null ? [] : [session.primaryCardId]),
      ]
      break
    case 'return-visits': {
      const visits = getUserReturnVisits(request.visits, userName)
      // Keep every visit ID, including stale/unlinked records, for targeted server resolution.
      plan.returnVisitIds = visits.map((visit) => visit.id)
      plan.buildingIds = visits.flatMap((visit) => visit.buildingId == null ? [] : [visit.buildingId])
      plan.unitIds = visits.flatMap((visit) => visit.unitId == null ? [] : [visit.unitId])
      break
    }
    case 'restaurant-event': {
      const assignments = request.assignments.filter((assignment) => assignment.eventId === request.eventId
        && assignment.userName === userName)
      plan.buildingIds = assignments.map((assignment) => assignment.buildingId)
      plan.unitIds = assignments.flatMap((assignment) => assignment.unitId == null ? [] : [assignment.unitId])
      break
    }
    case 'informal':
      break
  }
  return {
    cardIds: uniqueIds(plan.cardIds), buildingIds: uniqueIds(plan.buildingIds),
    unitIds: uniqueIds(plan.unitIds), returnVisitIds: uniqueIds(plan.returnVisitIds),
  }
}
