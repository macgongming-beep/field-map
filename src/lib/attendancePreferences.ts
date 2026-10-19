export type AttendancePreferences = { enabled: boolean; start: string; end: string }
export const defaultAttendancePreferences: AttendancePreferences = { enabled: true, start: '2026-09-29', end: '2026-10-04' }
function key(userId: number) { return `attendance-exclusion:v1:${import.meta.env.VITE_SUPABASE_URL ?? 'local'}:${userId}` }
function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T12:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}
function valid(value: AttendancePreferences): boolean {
  return typeof value?.enabled === 'boolean' && validDate(value.start) && validDate(value.end) && value.start <= value.end
}
export function readAttendancePreferences(userId?: number): AttendancePreferences {
  try {
    if (userId != null) {
      const value = JSON.parse(localStorage.getItem(key(userId)) ?? 'null')
      if (valid(value)) return value
    }
  } catch { /* Storage restrictions or malformed preferences must not block statistics. */ }
  return { ...defaultAttendancePreferences }
}
export function saveAttendancePreferences(userId: number | undefined, value: AttendancePreferences): void {
  if (userId == null || !valid(value)) return
  try { localStorage.setItem(key(userId), JSON.stringify(value)) } catch { /* Keep in-memory controls usable. */ }
}
