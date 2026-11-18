import type { CalendarEvent } from '../types'
import { parseServiceCalendarScope } from './serviceCalendarScope'

export type CalendarSnapshot = { events: CalendarEvent[]; at: number }

export function calendarNavigationReuseEnabled(flag = import.meta.env.VITE_CALENDAR_NAVIGATION_REUSE_ENABLED, demo = import.meta.env.VITE_DEMO_MODE) {
  return (flag ?? demo) === 'true'
}

export function calendarCachedScreenEnabled() {
  return calendarNavigationReuseEnabled()
    && (import.meta.env.VITE_CALENDAR_CACHED_SCREEN_ENABLED ?? import.meta.env.VITE_DEMO_MODE) === 'true'
}

function windowBounds(scope: string) {
  const match = /^window:(\d{4}-\d{2}-\d{2}):(\d{4}-\d{2}-\d{2})$/.exec(scope)
  return match && match[1] <= match[2] ? [match[1], match[2]] : null
}

/** Reuse only complete covering snapshots; never extend their original lifetime. */
export function readCalendarNavigationCache(cache: ReadonlyMap<string, CalendarSnapshot>, scope: string, now = Date.now()) {
  const fresh = (snapshot: CalendarSnapshot) => now >= snapshot.at && now - snapshot.at < 120_000
  const exact = cache.get(scope)
  if (exact && fresh(exact)) return exact.events
  if (!calendarNavigationReuseEnabled()) return undefined
  const requestedWindow = windowBounds(scope)
  const requestedService = parseServiceCalendarScope(scope)
  // Prefer the newest authoritative snapshot if multiple windows cover the request.
  for (const [key, snapshot] of [...cache].sort((a, b) => b[1].at - a[1].at)) {
    if (!fresh(snapshot)) continue
    const bounds = windowBounds(key)
    if (requestedWindow && bounds && bounds[0] <= requestedWindow[0] && bounds[1] >= requestedWindow[1]) {
      return snapshot.events.filter(event => event.date >= requestedWindow[0] && event.date <= requestedWindow[1])
    }
    const service = parseServiceCalendarScope(key)
    if (requestedService && requestedService.target !== null && service?.target === null
      && service.user === requestedService.user && service.date === requestedService.date
      && snapshot.events.some(event => event.id === requestedService.target)) {
      // A target is additive to the base service scope. It is already present,
      // so preserve every event and every team, including old/future assignments.
      return snapshot.events
    }
  }
  return undefined
}
