import { expect, test } from 'vitest'
import type { CalendarEvent } from '../../types'
import { testCard } from '../../test/territoryFixture'
import { eventTerritoryScope } from './eventScope'

const cards = [testCard(1, 'A', { assignedGroupCodes: ['a'] }), testCard(2, 'B', { assignedGroupCodes: ['b'] }),
  testCard(3, 'Shared', { assignedGroupCodes: ['a', 'b'] }), testCard(4, 'Unassigned')]
const groups = [{ code: 'a', name: '东滩', active: true }, { code: 'b', name: '新葛', active: true }]
const event = { serviceKind: 'group', groupServiceScope: true, targetGroups: ['a'] } as CalendarEvent

test('event group includes shared territories, not unassigned or other groups', () => {
  expect(eventTerritoryScope(event, cards, groups, true)).toEqual({ name: '东滩', cards: [cards[0], cards[2]] })
  expect(eventTerritoryScope({ ...event, targetGroups: ['b'] }, cards, groups, true)?.cards).toEqual([cards[1], cards[2]])
})
test.each([{ codes: [] }, { codes: ['missing'] }])('unknown or empty event groups never widen to the congregation: %j', ({ codes }) => {
  expect(eventTerritoryScope({ ...event, targetGroups: codes }, cards, groups, true)?.cards).toEqual([])
})
test('legacy combined group service uses union without duplicate cards', () => {
  expect(eventTerritoryScope({ ...event, groupServiceScope: false, targetGroups: ['a', 'b'] }, cards, groups, true)?.cards).toEqual(cards.slice(0, 3))
})
test('congregation and feature off preserve caller behavior; labels use current directory', () => {
  expect(eventTerritoryScope({ ...event, serviceKind: 'congregation', groupServiceScope: false }, cards, groups, true)).toBeNull()
  expect(eventTerritoryScope(event, cards, groups, false)).toBeNull()
  expect(eventTerritoryScope(event, cards, [{ ...groups[0], name: 'Changed' }], true)?.name).toBe('Changed')
})
