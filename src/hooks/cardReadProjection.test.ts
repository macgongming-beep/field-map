import { expect, test } from 'vitest'
import { cardReadProjection } from './cardReadProjection'
import { toCard, type RawCard } from './storeTransforms'

const full = '*, card_assignments(user_name), card_leader_assignments(user_name, created_at)'
const compact = 'id,name,area,region,type,status,leader_name, card_assignments(user_name), card_leader_assignments(user_name)'
test.each(['user', 'leader', 'admin', 'developer'] as const)('%s opt-in and explicit-off gates', role => {
  expect(cardReadProjection(role, true, 'false', undefined)).toBe(full)
  expect(cardReadProjection(role, true, 'true', 'false')).toBe(full)
  const expected = role === 'user' || role === 'leader' ? compact : full
  expect(cardReadProjection(role, true, 'false', 'true')).toBe(expected)
  expect(cardReadProjection(role, true, 'true', undefined)).toBe(expected)
  expect(cardReadProjection(role, false, 'false', 'true')).toBe(expected.split(', card_leader_assignments')[0])
})
test('compact rows preserve all card data except administrator assignment dates', () => {
  const raw: RawCard = { id: 1, name: 'Card', area: 'Area', region: 'Region', type: '전체', status: '진행중', leader_name: 'Legacy',
    card_assignments: [{ user_name: 'Recipient' }], card_leader_assignments: [{ user_name: 'Leader', created_at: '2026-10-23T00:00:00Z' }] }
  const full = toCard(raw, [])
  const compact = toCard({ ...raw, card_leader_assignments: [{ user_name: 'Leader' }] }, [])
  expect(compact).toEqual({ ...full, leaderAssignedAt: {} })
})
