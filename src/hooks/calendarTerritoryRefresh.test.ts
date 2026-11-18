import { expect, test } from 'vitest'
import { onlyCalendarPresentationChanged } from './calendarTerritoryRefresh'
import { toCalendarEvent, type RawCalendarEvent } from './storeTransforms'

const event = toCalendarEvent({ id: 7, event_date: '2026-11-18', time: '14:30', title: 'Service',
  assignment_revision: 1, event_participants: [] } as unknown as RawCalendarEvent)

test('only known presentation changes can retain territory, including reordered time slots', () => {
  const other = { ...event, id: 8 }
  expect(onlyCalendarPresentationChanged([event, other], [other, { ...event, title: 'Changed', time: '17:00', editVersion: '2' }], [7])).toBe(true)
  expect(onlyCalendarPresentationChanged([event], [{ ...event, memo: 'Changed' }], [7])).toBe(true)
})

test.each([
  { date: '2026-11-19' }, { leaders: ['New leader'] }, { targetGroups: ['dongtan'] },
  { serviceKind: 'group' }, { groupServiceScope: true }, { assignmentRevision: '2' },
  { assignmentStatus: 'shared' }, { applicants: ['New'] }, { returnVisitApplicants: ['New'] },
  { cardAssignments: [{ userName: 'Other', assignedCardId: 99 }] },
  { futurePermissionField: 'unknown' },
])('permission/assignment/unknown fields retain conservative refresh: %j', change => {
  expect(onlyCalendarPresentationChanged([event], [{ ...event, ...change } as typeof event], [7])).toBe(false)
})

test('missing, inserted, deleted, unannounced and invalid events cannot retain territory', () => {
  for (const ids of [undefined, [], [8], [NaN], [0], [-1]]) {
    expect(onlyCalendarPresentationChanged([event], [event], ids)).toBe(false)
  }
  expect(onlyCalendarPresentationChanged([event], [], [7])).toBe(false)
  expect(onlyCalendarPresentationChanged([event], [event, { ...event, id: 8 }], [7])).toBe(false)
  expect(onlyCalendarPresentationChanged([event, { ...event, id: 8 }], [event, { ...event, id: 8, assignmentRevision: '2' }], [7])).toBe(false)
})

test('grants, revocations, linked cards and team scope stay significant even without a revision change', () => {
  const assigned = { ...event, cardAssignments: [{ id: 1, eventId: 7, userName: 'Volunteer',
    assignedCardId: 10, assignedCardIds: [10, 20], cardScope: '전체' as const,
    assignedBy: 'Leader', assignedAt: '2026-11-18', memo: '' }] }
  for (const cardAssignments of [[], [{ ...assigned.cardAssignments[0], assignedCardIds: [10] }],
    [{ ...assigned.cardAssignments[0], assignedCardIds: [10, 20, 30] }],
    [{ ...assigned.cardAssignments[0], cardScope: '주택' as const }]]) {
    expect(onlyCalendarPresentationChanged([assigned], [{ ...assigned, cardAssignments }], [7])).toBe(false)
  }
})
