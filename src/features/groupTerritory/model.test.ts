import { afterEach, expect, test, vi } from 'vitest'
import { groupOwnsCard, groupTerritoryEnabled, ownTerritoryGroup, territoryGroupNames } from './model'
import { cardReadProjection } from '../../hooks/cardReadProjection'
import { toCard } from '../../hooks/storeTransforms'
import type { TerritoryCard } from '../../types'
afterEach(() => vi.unstubAllEnvs())
const card = { id: 1, assignedGroupCodes: ['a', 'b'], assignedLeader: 'Old leader' } as TerritoryCard
const groups = [{ code: 'a', name: '第一组', active: true }, { code: 'b', name: '第二组', active: true }]
test('codes, not translated group labels or legacy names, determine shared ownership', () => {
  expect(groupOwnsCard(card, 'a')).toBe(true); expect(groupOwnsCard(card, 'b')).toBe(true)
  expect(groupOwnsCard(card, '第一组')).toBe(false); expect(groupOwnsCard(card, null)).toBe(false)
  expect(ownTerritoryGroup(groups, '第二组')).toBe('b')
  expect(ownTerritoryGroup(groups, null)).toBeNull()
  expect(territoryGroupNames(card, [{ ...groups[0], name: '改名' }, groups[1]])).toEqual(['改名', '第二组'])
})
test('projection is opt-in and ordinary recipient reads never acquire group assignments', () => {
  vi.stubEnv('VITE_GROUP_TERRITORY_ENABLED', 'false')
  expect(cardReadProjection('leader')).not.toContain('card_group_assignments')
  expect(groupTerritoryEnabled(undefined)).toBe(false)
  vi.stubEnv('VITE_GROUP_TERRITORY_ENABLED', 'true')
  for (const role of ['admin', 'developer', 'leader'] as const) expect(cardReadProjection(role)).toContain('card_group_assignments(group_code)')
  expect(cardReadProjection('user')).not.toContain('card_group_assignments')
  const result = toCard({ id: 1, name: 'A', area: 'A', region: 'A', type: '전체', status: '완료', leader_name: 'Original', group_assignment_revision: 3, card_group_assignments: [{ group_code: 'a' }, { group_code: 'b' }] }, [])
  expect(result).toMatchObject({ assignedLeader: 'Original', assignedGroupCodes: ['a', 'b'], groupAssignmentRevision: '3', status: '완료' })
})
