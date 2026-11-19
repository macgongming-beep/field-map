const PERSONAL_SETTINGS = new Set([
  '/settings', '/profile', '/privacy', '/notification-settings', '/location-permission-settings',
  '/settings/profile', '/settings/notification', '/settings/location-permission',
])

// These screens own their management data and consume no territory or event history.
// Keep editors, service logs and unknown settings paths out of this exact allowlist.
const LIGHTWEIGHT_MANAGEMENT = new Set([
  '/users', '/settings/users', '/signup-requests', '/settings/signup-requests',
  '/settings/meeting-notes', '/special-periods', '/settings/special-periods',
  '/suggestions', '/settings/suggestions',
])

export function isLightweightManagementRoute(path: string, search: string) {
  return !search && LIGHTWEIGHT_MANAGEMENT.has(path)
}

export function isPersonalSettingsRoute(path: string, search: string) {
  const params = new URLSearchParams(search)
  return PERSONAL_SETTINGS.has(path) && !params.has('openEvent') && !params.has('openChat')
}
