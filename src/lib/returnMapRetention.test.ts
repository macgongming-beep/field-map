import { afterEach, expect, test, vi } from 'vitest'
import { isFocusedReturnVisitMap, returnMapRetentionEnabled } from './returnMapRetention'
import { recipientStoreEnabled } from './recipientStore'

afterEach(() => vi.unstubAllEnvs())

test.each([
  ['true', undefined, true], ['false', undefined, false],
  [undefined, undefined, false], ['true', 'false', false], ['false', 'true', true],
])('return map gate demo=%s flag=%s', (demo, flag, enabled) => {
  vi.stubEnv('VITE_RETURN_MAP_RETENTION_ENABLED', flag)
  const search = '?scope=regularVisits&returnVisitId=7&buildingId=10'
  expect(returnMapRetentionEnabled(flag, demo)).toBe(enabled)
  expect(recipientStoreEnabled('user', '/map', search, demo, 'true')).toBe(enabled)
  expect(recipientStoreEnabled('user', '/map', search, demo, 'false')).toBe(false)
  for (const role of ['leader', 'admin', 'developer']) {
    expect(recipientStoreEnabled(role, '/map', search, demo, 'true')).toBe(false)
  }
})

test.each([
  '?scope=regularVisits&returnVisitId=7&buildingId=10',
])('valid focused return map %s', search => {
  expect(isFocusedReturnVisitMap('/map', search)).toBe(true)
  expect(isFocusedReturnVisitMap('/zone', search)).toBe(false)
})

test.each([
  '', '?scope=regularVisits', '?scope=mine&returnVisitId=7',
  '?scope=regularVisits&returnVisitId=7&addr=Test%20address&pinLabel=Test',
  '?scope=regularVisits&returnVisitId=7',
  '?scope=regularVisits&returnVisitId=0', '?scope=regularVisits&returnVisitId=-1',
  '?scope=regularVisits&returnVisitId=bad', '?scope=regularVisits&returnVisitId=9007199254740992',
  '?scope=regularVisits&returnVisitId=7&returnVisitId=8',
  '?scope=regularVisits&scope=mine&returnVisitId=7',
  '?scope=regularVisits&returnVisitId=7&buildingId=bad',
  '?scope=regularVisits&returnVisitId=7&buildingId=10&buildingId=11',
  ...['addr', 'assignmentMap', 'assignmentCard', 'cardId', 'cardIds', 'informalId', 'openEvent', 'openChat']
    .map(key => `?scope=regularVisits&returnVisitId=7&buildingId=10&${key}=10`),
])('unsupported map stays outside the new opt-in: %s', search => {
  expect(isFocusedReturnVisitMap('/map', search)).toBe(false)
})

test('address-only return maps keep the existing full store even with the opt-in', () => {
  vi.stubEnv('VITE_RETURN_MAP_RETENTION_ENABLED', 'true')
  expect(recipientStoreEnabled('user', '/map', '?scope=regularVisits&returnVisitId=7&addr=Test', 'true', 'true')).toBe(false)
})
