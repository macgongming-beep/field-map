import { afterEach, expect, test, vi } from 'vitest'
import { defaultAttendancePreferences, readAttendancePreferences, saveAttendancePreferences } from './attendancePreferences'
afterEach(() => { localStorage.clear(); vi.restoreAllMocks() })
test('rejects invalid dates and preserves last valid preference', () => {
  saveAttendancePreferences(1, { enabled: false, start: '2026-09-29', end: '2026-10-06' })
  saveAttendancePreferences(1, { enabled: true, start: '2026-09-31', end: '2026-10-07' })
  saveAttendancePreferences(1, { enabled: true, start: '2026-10-08', end: '2026-10-07' })
  expect(readAttendancePreferences(1).end).toBe('2026-10-06')
  expect(readAttendancePreferences(2)).toEqual(defaultAttendancePreferences)
})
test('storage failure and corrupt data fall back without blocking report', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockReturnValue('{broken')
  expect(readAttendancePreferences(1)).toEqual(defaultAttendancePreferences)
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
  expect(() => saveAttendancePreferences(1, defaultAttendancePreferences)).not.toThrow()
})
