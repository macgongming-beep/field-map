const PERSONAL_SETTINGS = new Set([
  '/settings', '/profile', '/privacy', '/notification-settings', '/location-permission-settings',
  '/settings/profile', '/settings/notification', '/settings/location-permission',
])

export function isPersonalSettingsRoute(path: string, search: string) {
  const params = new URLSearchParams(search)
  return PERSONAL_SETTINGS.has(path) && !params.has('openEvent') && !params.has('openChat')
}
