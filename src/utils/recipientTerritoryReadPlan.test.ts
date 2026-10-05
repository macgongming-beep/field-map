import { expect, test } from 'vitest'
import type { CalendarEvent, EventRestaurantAssignment, ReturnVisit, ServiceSession } from '../types'
import { planRecipientTerritoryRead } from './recipientTerritoryReadPlan'

const empty = { cardIds: [], buildingIds: [], unitIds: [], returnVisitIds: [] }
const event = (patch: Partial<CalendarEvent> = {}) => ({
  id: 1, date: '2026-10-05', cardAssignments: [
    { userName: 'A', assignedCardId: 2, assignedCardIds: [2, 3], cardScope: '상가' },
    { userName: 'B', assignedCardId: 99 },
  ], ...patch,
}) as CalendarEvent

test('one assigned card does not require the complete territory dataset', () => {
  expect(planRecipientTerritoryRead('A', { kind: 'event', event: event(), cardId: 2 }))
    .toEqual({ ...empty, cardIds: [2] })
})

test('assigned overview includes every assigned card but not another recipient', () => {
  expect(planRecipientTerritoryRead('A', { kind: 'event', event: event() }).cardIds).toEqual([2, 3])
  expect(planRecipientTerritoryRead('A', { kind: 'event', event: event(), cardId: 99 })).toEqual(empty)
  expect(planRecipientTerritoryRead('C', { kind: 'event', event: event() })).toEqual(empty)
})

test('opening a past assignment retains its own scope without preloading other events', () => {
  expect(planRecipientTerritoryRead('A', { kind: 'event', event: event({ date: '2025-01-01' }) }).cardIds).toEqual([2, 3])
})

test('legacy single-card assignment and informal-only null assignment remain distinct', () => {
  expect(planRecipientTerritoryRead('B', { kind: 'event', event: event() }).cardIds).toEqual([99])
  const informalOnly = event({ cardAssignments: [{ userName: 'A', assignedCardId: null } as CalendarEvent['cardAssignments'][number]] })
  expect(planRecipientTerritoryRead('A', { kind: 'event', event: informalOnly })).toEqual(empty)
  expect(planRecipientTerritoryRead('A', { kind: 'informal' })).toEqual(empty)
})

test('assignment removal or replacement cannot retain the previous scope', () => {
  expect(planRecipientTerritoryRead('A', { kind: 'event', event: event() }).cardIds).toEqual([2, 3])
  expect(planRecipientTerritoryRead('A', { kind: 'event', event: event({ cardAssignments: [] }) })).toEqual(empty)
  expect(planRecipientTerritoryRead('B', { kind: 'event', event: event() }).cardIds).toEqual([99])
})

test('my cards include only personal assignments and active sessions today', () => {
  const session = (primaryCardId: number, patch: Partial<ServiceSession> = {}) => ({
    primaryCardId, userName: 'A', serviceDate: '2026-10-05', status: 'active', endedAt: null, ...patch,
  }) as ServiceSession
  expect(planRecipientTerritoryRead('A', {
    kind: 'my-cards', today: '2026-10-05',
    cards: [{ id: 1, assignedUsers: ['A'] }, { id: 99, assignedUsers: ['B'] }],
    sessions: [session(1), session(2), session(3, { endedAt: '2026-10-05T01:00:00Z' }),
      session(4, { serviceDate: '2026-10-04' }), session(5, { status: 'expired' }), session(6, { userName: 'B' })],
  })).toEqual({ ...empty, cardIds: [1, 2] })
})

test('return visits retain stale and unlinked records without pulling every building', () => {
  const visit = (id: number, patch: Partial<ReturnVisit> = {}) => ({
    id, assignedUserName: 'A', createdBy: 'B', buildingId: null, unitId: null, ...patch,
  }) as ReturnVisit
  expect(planRecipientTerritoryRead('A', { kind: 'return-visits', visits: [
    visit(1, { buildingId: 10, unitId: 100 }), visit(2, { unitId: 200 }), visit(3),
    visit(4, { assignedUserName: '', createdBy: ' A ' }),
    visit(5, { assignedUserName: 'B', createdBy: 'A', buildingId: 99 }),
    visit(6, { endedAt: '2026-10-01T00:00:00Z' }),
  ] })).toEqual({ ...empty, buildingIds: [10], unitIds: [100, 200], returnVisitIds: [1, 2, 3, 4, 6] })
})

test('restaurant assignments are scoped by recipient and event, including legacy building-only rows', () => {
  const assignment = (buildingId: number, patch: Partial<EventRestaurantAssignment> = {}) => ({
    buildingId, unitId: null, eventId: 1, userName: 'A', ...patch,
  }) as EventRestaurantAssignment
  expect(planRecipientTerritoryRead('A', { kind: 'restaurant-event', eventId: 1, assignments: [
    assignment(10, { unitId: 100 }), assignment(11), assignment(12, { eventId: 2 }),
    assignment(13, { userName: 'B' }),
  ] })).toEqual({ ...empty, buildingIds: [10, 11], unitIds: [100] })
})

test('empty identity, duplicate and malformed IDs never broaden the request', () => {
  expect(planRecipientTerritoryRead(' ', { kind: 'event', event: event() })).toEqual(empty)
  const malformed = event({ cardAssignments: [{ userName: 'A', assignedCardIds: [3, 3, 2, -1, NaN, 1.5, 0, Infinity] } as CalendarEvent['cardAssignments'][number]] })
  expect(planRecipientTerritoryRead('A', { kind: 'event', event: malformed }).cardIds).toEqual([2, 3])
  expect(planRecipientTerritoryRead('A', { kind: 'event', event: malformed, cardId: NaN })).toEqual(empty)
})
