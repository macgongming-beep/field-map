export function serviceCalendarReadReuseEnabled() {
  return import.meta.env.VITE_SERVICE_CALENDAR_REUSE_ENABLED === 'true'
}

export function parseServiceCalendarScope(scope: string) {
  if (!scope.startsWith('service:')) return null
  try {
    const value: unknown = JSON.parse(scope.slice(8))
    if (!Array.isArray(value) || value.length !== 3) return null
    const [user, date, target] = value
    if (typeof user !== 'string' || !user || typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)
      || (target !== null && (!Number.isSafeInteger(target) || target <= 0))) return null
    return { user, date, target: target as number | null }
  } catch { return null }
}
