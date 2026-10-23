import { expect, test } from 'vitest'
import { cardReadProjection } from './cardReadProjection'
import { toCard, type RawCard } from './storeTransforms'

test.each(['user', 'leader', 'admin', 'developer'] as const)('production %s preserves full projection', role => {
  expect(cardReadProjection(role, true, true, 'false')).toBe('*, card_assignments(user_name), card_leader_assignments(user_name, created_at)')
})
test.each(['leader', 'admin', 'developer'] as const)('demo %s retains assignment timestamps', role => {
  expect(cardReadProjection(role, true, true, 'true')).toContain('created_at')
})
test('only a demo recipient omits unused timestamps, never assignment names', () => {
  expect(cardReadProjection('user', true, true, 'true')).toBe('id,name,area,region,type,status,leader_name, card_assignments(user_name), card_leader_assignments(user_name)')
  expect(cardReadProjection('user', false, true, 'true')).toContain('created_at')
  expect(cardReadProjection('user', true, false, 'true')).toBe('id,name,area,region,type,status,leader_name, card_assignments(user_name)')
})
test('compact rows preserve all card data except administrator assignment dates', () => {
  const raw: RawCard = { id: 1, name: 'Card', area: 'Area', region: 'Region', type: '전체', status: '진행중', leader_name: 'Legacy',
    card_assignments: [{ user_name: 'Recipient' }], card_leader_assignments: [{ user_name: 'Leader', created_at: '2026-10-23T00:00:00Z' }] }
  const full = toCard(raw, [])
  const compact = toCard({ ...raw, card_leader_assignments: [{ user_name: 'Leader' }] }, [])
  expect(compact).toEqual({ ...full, leaderAssignedAt: {} })
})
