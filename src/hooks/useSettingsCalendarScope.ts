import { useState } from 'react'

const PERSONAL_SETTINGS = new Set([
  '/settings', '/profile', '/privacy', '/notification-settings', '/location-permission-settings',
  '/settings/profile', '/settings/notification', '/settings/location-permission',
])

export function useSettingsCalendarScope(requested: string, path: string, search: string, home: string, windowed: boolean) {
  const params = new URLSearchParams(search)
  const retain = windowed
    && (import.meta.env.VITE_SETTINGS_CALENDAR_RETENTION_ENABLED ?? import.meta.env.VITE_DEMO_MODE) === 'true'
    && PERSONAL_SETTINGS.has(path) && !params.has('openEvent') && !params.has('openChat')
  // AppSession is keyed by authenticated identity. Direct settings entry uses
  // the bounded home window; navigation retains the previous calendar scope.
  const [previous, setPrevious] = useState(retain ? home : requested)
  const scope = retain ? previous : requested
  if (previous !== scope) setPrevious(scope)
  return scope
}
