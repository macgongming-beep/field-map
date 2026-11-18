import { useState } from 'react'
import { isPersonalSettingsRoute } from '../utils/personalSettingsRoute'

export function useSettingsCalendarScope(requested: string, path: string, search: string, home: string, windowed: boolean) {
  const retain = windowed
    && (import.meta.env.VITE_SETTINGS_CALENDAR_RETENTION_ENABLED ?? import.meta.env.VITE_DEMO_MODE) === 'true'
    && isPersonalSettingsRoute(path, search)
  // AppSession is keyed by authenticated identity. Direct settings entry uses
  // the bounded home window; navigation retains the previous calendar scope.
  const [previous, setPrevious] = useState(retain ? home : requested)
  const scope = retain ? previous : requested
  if (previous !== scope) setPrevious(scope)
  return scope
}
