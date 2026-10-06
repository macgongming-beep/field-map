import { webcrypto } from 'node:crypto'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { createBoundaryDeviceCache } from './boundaryDeviceCache'
import { clearAuthStorage } from './authToken'

const rows = [{ card_id: 1, updated_at: 'v1', points: [{ lat: 37, lng: 127 }, { lat: 38, lng: 127 }, { lat: 37, lng: 128 }] }]
beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('indexedDB', new IDBFactory())
  vi.stubGlobal('crypto', webcrypto)
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); localStorage.clear() })

test('persists across readers but isolates project and login session without storing the token', async () => {
  const cache = await createBoundaryDeviceCache('demo', 'secret-session', () => true)
  await cache!.write(rows)
  expect(await (await createBoundaryDeviceCache('demo', 'secret-session', () => true))!.read()).toEqual(rows)
  expect(await (await createBoundaryDeviceCache('production', 'secret-session', () => true))!.read()).toBeNull()
  expect(await (await createBoundaryDeviceCache('demo', 'other-session', () => true))!.read()).toBeNull()
  expect(JSON.stringify(localStorage)).not.toContain('secret-session')
})

test('logout clears stored coordinates and invalidates an old pending writer', async () => {
  const cache = await createBoundaryDeviceCache('demo', 'session', () => true)
  await cache!.write(rows)
  clearAuthStorage()
  await cache!.write(rows)
  expect(await cache!.read()).toBeNull()
  expect(await (await createBoundaryDeviceCache('demo', 'session', () => true))!.read()).toBeNull()
})

test('expired, invalid and unavailable storage all become cache misses', async () => {
  const cache = await createBoundaryDeviceCache('demo', 'session', () => true)
  await cache!.write([{ ...rows[0], points: [{ lat: 999, lng: 1 }] }])
  expect(await cache!.read()).toBeNull()
  await cache!.write(rows)
  vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 8 * 86400000)
  expect(await cache!.read()).toBeNull()
  vi.stubGlobal('indexedDB', undefined)
  expect(await cache!.read()).toBeNull()
  await expect(cache!.write(rows)).resolves.toBeUndefined()
})

test('account changes during asynchronous work cannot read or populate cache', async () => {
  let current = true
  const cache = await createBoundaryDeviceCache('demo', 'session', () => current)
  await cache!.write(rows)
  current = false
  expect(await cache!.read()).toBeNull()
  await cache!.write([{ ...rows[0], updated_at: 'v2' }])
  current = true
  expect(await cache!.read()).toEqual(rows)
})
