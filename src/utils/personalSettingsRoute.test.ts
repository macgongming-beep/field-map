import { expect, test } from 'vitest'
import { isLightweightManagementRoute, isPersonalSettingsRoute } from './personalSettingsRoute'

test.each([
  '/users', '/settings/users', '/signup-requests', '/settings/signup-requests',
  '/settings/meeting-notes', '/special-periods', '/settings/special-periods',
  '/suggestions', '/settings/suggestions',
])('management allowlist accepts only the exact query-free route %s', path => {
  expect(isLightweightManagementRoute(path, '')).toBe(true)
  expect(isPersonalSettingsRoute(path, '')).toBe(false)
  for (const suffix of ['/', '/edit', '-archive']) {
    expect(isLightweightManagementRoute(path + suffix, '')).toBe(false)
  }
  for (const search of ['?openEvent=9', '?openChat=9', '?unknown=1', '?']) {
    expect(isLightweightManagementRoute(path, search)).toBe(false)
  }
})

test.each([
  '/settings', '/settings/unknown', '/settings/data-management', '/settings/territory-regions',
  '/regular-visits', '/settings/regular-visits', '/place-change-requests', '/settings/place-change-requests',
  '/service-logs', '/settings/service-logs', '/stats', '/calendar', '/map', '/zone', '/assignment',
])('management allowlist excludes unreviewed consumers %s', path => {
  expect(isLightweightManagementRoute(path, '')).toBe(false)
})
