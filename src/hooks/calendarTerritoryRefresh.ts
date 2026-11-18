import type { CalendarEvent } from '../types'

export function calendarTerritoryRefreshEnabled() {
  return import.meta.env.VITE_CALENDAR_METADATA_REFRESH_ENABLED === 'true'
}

// Keep unknown/new fields significant. Only presentation fields and the edit
// version may differ; participant, permission and assignment changes fall back.
const presentationFields = new Set(['title', 'time', 'endTime', 'place', 'mapLink', 'memo', 'editVersion'])
function signature(event: CalendarEvent, allowPresentation: boolean) {
  return JSON.stringify(Object.fromEntries(Object.entries(event)
    .filter(([key]) => !allowPresentation || !presentationFields.has(key))
    .sort(([a], [b]) => a.localeCompare(b))))
}

export function onlyCalendarPresentationChanged(before: CalendarEvent[], after: CalendarEvent[], updatedIds: number[] | undefined) {
  if (!updatedIds?.length || updatedIds.some(id => !Number.isSafeInteger(id) || id <= 0)) return false
  const previous = new Map(before.map(event => [event.id, event]))
  const next = new Map(after.map(event => [event.id, event]))
  if (previous.size !== before.length || next.size !== after.length || previous.size !== next.size
    || updatedIds.some(id => !previous.has(id) || !next.has(id))) return false
  const updates = new Set(updatedIds)
  return [...previous].every(([id, event]) => {
    const fresh = next.get(id)
    return fresh != null && signature(event, updates.has(id)) === signature(fresh, updates.has(id))
  })
}
