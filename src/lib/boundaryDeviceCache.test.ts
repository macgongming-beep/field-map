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

async function storedSnapshots() {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('field-map-boundary-cache-v1', 1)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  try {
    return await new Promise<unknown[]>((resolve, reject) => {
      const request = db.transaction('snapshots').objectStore('snapshots').getAll()
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  } finally { db.close() }
}

test('reading a new session physically prunes expired old keys but keeps fresh project and session keys', async () => {
  const start = Date.now()
  const clock = vi.spyOn(Date, 'now').mockReturnValue(start)
  await (await createBoundaryDeviceCache('demo', 'old-session', () => true))!.write(rows)
  clock.mockReturnValue(start + 8 * 86400000)
  const cache = await createBoundaryDeviceCache('demo', 'new-session', () => true)
  const other = await createBoundaryDeviceCache('other-project', 'session', () => true)
  await cache!.write(rows)
  await other!.write(rows)
  expect(await storedSnapshots()).toHaveLength(3)
  expect(await cache!.read()).toEqual(rows)
  expect(await storedSnapshots()).toHaveLength(2)
  expect(await other!.read()).toEqual(rows)
  expect(await (await createBoundaryDeviceCache('demo', 'old-session', () => true))!.read()).toBeNull()
})

test('prunes invalid and future timestamps, including when the requested key is absent', async () => {
  const start = Date.now()
  const clock = vi.spyOn(Date, 'now').mockReturnValue(NaN)
  await (await createBoundaryDeviceCache('demo', 'invalid', () => true))!.write(rows)
  clock.mockReturnValue(start + 10000)
  await (await createBoundaryDeviceCache('demo', 'future', () => true))!.write(rows)
  clock.mockReturnValue(start)
  expect(await storedSnapshots()).toHaveLength(2)
  expect(await (await createBoundaryDeviceCache('demo', 'missing', () => true))!.read()).toBeNull()
  expect(await storedSnapshots()).toHaveLength(0)
})

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
