import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { webcrypto } from 'node:crypto'
import { createCardBoundaryReader } from './cardBoundaryRecovery'

const db = vi.hoisted(() => ({ rows: [] as Array<{ card_id: number; points: unknown[]; updated_at: string | null }>, reads: [] as Array<{ columns: string; ids?: number[] }>, fail: 0, pause: null as Promise<void> | null }))
vi.mock('../lib/supabase', () => ({ supabase: { from: () => ({
  select: (columns: string) => {
    let ids: number[] | undefined
    const query = {
      order: () => query,
      in: (_: string, values: number[]) => { ids = values; return query },
      range: async (from: number, to: number) => {
        db.reads.push({ columns, ids })
        if (db.fail > 0) { db.fail--; return { data: null, error: new Error('offline') } }
        const rows = db.rows.filter((r) => !ids || ids.includes(r.card_id)).slice(from, to + 1)
        const pause = db.pause
        db.pause = null
        if (pause) await pause
        return { data: rows.map((r) => columns.includes('points') ? { ...r } : { card_id: r.card_id, updated_at: r.updated_at }), error: null }
      },
    }
    return query
  },
}) } }))
const row = (id: number, version = 'v1') => ({ card_id: id, updated_at: version, points: [id, 2, 3] })
beforeEach(() => { db.rows = [row(1), row(2)]; db.reads = []; db.fail = 0; db.pause = null })
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); localStorage.clear() })

function enableDeviceCache() {
  vi.stubEnv('VITE_DEMO_MODE', 'true')
  vi.stubEnv('VITE_SUPABASE_URL', 'https://demo.example')
  vi.stubGlobal('indexedDB', new IDBFactory())
  vi.stubGlobal('crypto', webcrypto)
  localStorage.setItem('auth_token', 'demo-session')
  db.rows = db.rows.map((r) => ({ ...r, points: [{ lat: 37, lng: r.card_id }, { lat: 38, lng: r.card_id }, { lat: 39, lng: r.card_id }] }))
}

test('demo cold restart verifies manifest before reusing saved coordinates; manual refresh stays full', async () => {
  enableDeviceCache()
  await createCardBoundaryReader()(false, vi.fn())
  db.reads = []
  const restarted = createCardBoundaryReader()
  expect(await restarted(false, vi.fn())).toEqual(db.rows)
  expect(db.reads).toEqual([{ columns: 'card_id, updated_at', ids: undefined }])
  await restarted(false, vi.fn())
  expect(db.reads.at(-1)?.columns).toContain('points')
})

test('restart removes deleted coordinates and fetches changed coordinates; never displays cache offline', async () => {
  enableDeviceCache()
  await createCardBoundaryReader()(false, vi.fn())
  db.rows = [{ ...db.rows[0], updated_at: 'v2' }]
  db.reads = []
  expect(await createCardBoundaryReader()(false, vi.fn())).toEqual(db.rows)
  expect(db.reads).toEqual([{ columns: 'card_id, updated_at', ids: undefined }, { columns: 'card_id, points, updated_at', ids: [1] }])
  db.fail = 2
  await expect(createCardBoundaryReader()(false, vi.fn())).rejects.toThrow('offline')
})

test('production never restores device coordinates even when a cache exists', async () => {
  enableDeviceCache()
  await createCardBoundaryReader()(false, vi.fn())
  vi.stubEnv('VITE_DEMO_MODE', 'false')
  db.reads = []
  expect(await createCardBoundaryReader()(false, vi.fn())).toEqual(db.rows)
  expect(db.reads).toEqual([{ columns: 'card_id, points, updated_at', ids: undefined }])
})

test('production cache flag enables manifest reuse and explicit false disables demo caching', async () => {
  enableDeviceCache()
  vi.stubEnv('VITE_DEMO_MODE', 'false')
  vi.stubEnv('VITE_BOUNDARY_DEVICE_CACHE_ENABLED', 'true')
  await createCardBoundaryReader()(false, vi.fn())
  db.reads = []
  expect(await createCardBoundaryReader()(false, vi.fn())).toEqual(db.rows)
  expect(db.reads).toEqual([{ columns: 'card_id, updated_at', ids: undefined }])
  vi.stubEnv('VITE_DEMO_MODE', 'true')
  vi.stubEnv('VITE_BOUNDARY_DEVICE_CACHE_ENABLED', 'false')
  db.reads = []
  expect(await createCardBoundaryReader()(false, vi.fn())).toEqual(db.rows)
  expect(db.reads).toEqual([{ columns: 'card_id, points, updated_at', ids: undefined }])
})

test('late snapshot cannot overwrite a newer mutation refresh', async () => {
  const read = createCardBoundaryReader()
  let release!: () => void
  db.pause = new Promise<void>((resolve) => { release = resolve })
  const older = read(false, vi.fn())
  db.rows = [row(1, 'v2')]
  expect(await read(false, vi.fn())).toEqual(db.rows)
  release()
  expect(await older).toBeNull()
  db.reads = []
  expect(await read(true, vi.fn())).toEqual(db.rows)
  expect(db.reads).toEqual([{ columns: 'card_id, updated_at', ids: undefined }])
})

test('unchanged recovery reads versions only; explicit refresh reads coordinates', async () => {
  const read = createCardBoundaryReader()
  await read(false, vi.fn())
  db.reads = []
  expect(await read(true, vi.fn())).toEqual(db.rows)
  expect(db.reads).toEqual([{ columns: 'card_id, updated_at', ids: undefined }])
  await read(false, vi.fn())
  expect(db.reads.at(-1)?.columns).toContain('points')
})

test('updates, additions and deletions reconcile without downloading unchanged coordinates', async () => {
  const read = createCardBoundaryReader()
  await read(false, vi.fn())
  db.rows = [row(1), row(3)]
  db.reads = []
  expect(await read(true, vi.fn())).toEqual(db.rows)
  expect(db.reads[1].ids).toEqual([3])
  db.rows = [row(1, 'v2'), row(3)]
  db.reads = []
  expect(await read(true, vi.fn())).toEqual(db.rows)
  expect(db.reads[1].ids).toEqual([1])
})

test('failed index falls back to full; failed full preserves the cache for retry', async () => {
  const read = createCardBoundaryReader()
  await read(false, vi.fn())
  db.fail = 1
  expect(await read(true, vi.fn())).toEqual(db.rows)
  db.rows = [row(1, 'v2')]
  db.fail = 2
  await expect(read(true, vi.fn())).rejects.toThrow('offline')
  db.reads = []
  expect(await read(true, vi.fn())).toEqual(db.rows)
  expect(db.reads[1].ids).toEqual([1])
})

test('paginates the index and full snapshot beyond 1000 boundaries', async () => {
  db.rows = Array.from({ length: 1001 }, (_, i) => row(i + 1))
  const read = createCardBoundaryReader()
  expect(await read(false, vi.fn())).toHaveLength(1001)
  db.reads = []
  expect(await read(true, vi.fn())).toHaveLength(1001)
  expect(db.reads).toHaveLength(2)
  expect(db.reads.every((r) => !r.columns.includes('points'))).toBe(true)
})

test('large changed sets use a full snapshot and null versions never hide edits', async () => {
  const read = createCardBoundaryReader()
  await read(false, vi.fn())
  db.rows = Array.from({ length: 205 }, (_, i) => row(i + 1, 'v2'))
  db.reads = []
  expect(await read(true, vi.fn())).toHaveLength(205)
  expect(db.reads[1]).toEqual({ columns: 'card_id, points, updated_at', ids: undefined })
  db.rows = [{ ...row(1), updated_at: null }]
  await read(false, vi.fn())
  db.reads = []
  await read(true, vi.fn())
  expect(db.reads[1].ids).toEqual([1])
})
