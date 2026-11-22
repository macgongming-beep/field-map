import { cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { useStore } from './useStore'

const HINT = 'fieldmap:buildingTotal'
const state = vi.hoisted(() => ({
  rows: [] as { id: number }[],
  reportTotal: true,
  calls: [] as { from: number; count: boolean }[],
  settled: [] as number[],
  startedBeforeFirstAnswered: [] as number[],
  settledAtStart: new Map<number, number[]>(),
  pageOverrides: new Map<number, { id: number }[]>(),
  inFlight: 0,
  maxInFlight: 0,
  failFrom: null as number | null,
}))

vi.mock('../lib/toast', () => ({ showToast: vi.fn() }))
vi.mock('../lib/supabase', () => ({ supabase: {
  rpc: () => Promise.resolve({ data: null, error: null }),
  from: (table: string) => {
    let range: [number, number] = [0, 999]
    let count = false
    const chain: Record<string, unknown> = {}
    for (const key of ['order', 'eq', 'limit', 'in', 'is', 'gte', 'lte', 'neq']) chain[key] = () => chain
    chain.select = (_columns: string, options?: { count?: string }) => { count = options?.count === 'exact'; return chain }
    chain.range = (from: number, to: number) => { range = [from, to]; return chain }
    chain.then = (resolve: (value: unknown) => void, reject: (error: Error) => void) => {
      if (table !== 'buildings') return Promise.resolve({ data: [], error: null }).then(resolve, reject)
      const [from, to] = range
      state.calls.push({ from, count })
      if (from > 0 && !state.settled.includes(0)) state.startedBeforeFirstAnswered.push(from)
      state.settledAtStart.set(from, [...state.settled])
      state.inFlight++; state.maxInFlight = Math.max(state.maxInFlight, state.inFlight)
      const respond = async () => {
        // The first page answers last, so only concurrent requests can start before it.
        await new Promise(r => setTimeout(r, from === state.failFrom ? 5 : state.failFrom !== null ? 200 : from === 0 ? 40 : 20))
        state.settled.push(from); state.inFlight--
        if (from === state.failFrom) return { data: null, error: { message: 'page failed' }, count: null }
        return { data: state.pageOverrides.get(from) ?? state.rows.slice(from, to + 1), error: null, count: count && state.reportTotal ? state.rows.length : null }
      }
      return respond().then(resolve, reject)
    }
    return chain
  },
} }))

const building = (id: number) => ({ id, card_id: 1, name: `B${id}`, address: '', type: '주택', lat: 37, lng: 127, warning: false,
  access_status: null, memo: null, is_restaurant: false, units_surveyed: false, building_access_events: [], units: [] })
const seed = (total: number) => { state.rows = Array.from({ length: total }, (_, i) => building(i + 1)) }

beforeEach(() => {
  state.calls = []; state.settled = []; state.pageOverrides.clear(); state.inFlight = 0; state.maxInFlight = 0; state.settledAtStart = new Map(); state.startedBeforeFirstAnswered = []; state.failFrom = null; state.reportTotal = true
  window.localStorage.clear()
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

async function load() {
  const view = renderHook(() => useStore(true))
  await waitFor(() => expect(view.result.current.loading).toBe(false))
  return view.result.current
}

test('without a hint the first page is read alone, then the counted rest together, and the total is remembered', async () => {
  seed(2350)
  const store = await load()
  expect(store.buildings).toHaveLength(2350)
  expect(state.calls).toEqual([{ from: 0, count: true }, { from: 1000, count: false }, { from: 2000, count: false }])
  expect(state.startedBeforeFirstAnswered).toEqual([])
  // Pages 1000 and 2000 were requested together after the counted first page.
  expect(state.settledAtStart.get(2000)).toEqual([0])
  expect(window.localStorage.getItem(HINT)).toBe('2350')
})

test('a multi-page hint starts every expected page with the first one, with no extra request', async () => {
  seed(1271)
  window.localStorage.setItem(HINT, '1271')
  const store = await load()
  expect(store.buildings).toHaveLength(1271)
  expect(state.calls.map(call => call.from)).toEqual([0, 1000])
  expect(state.startedBeforeFirstAnswered).toEqual([1000])
})

test('a hint at or below one page keeps the single serial read', async () => {
  seed(45)
  window.localStorage.setItem(HINT, '45')
  const store = await load()
  expect(store.buildings).toHaveLength(45)
  expect(state.calls.map(call => call.from)).toEqual([0])
})

test('a stale high hint costs one empty page once, then the hint shrinks', async () => {
  seed(900)
  window.localStorage.setItem(HINT, '2500')
  const store = await load()
  expect(store.buildings).toHaveLength(900)
  expect(state.calls.map(call => call.from)).toEqual([0, 1000, 2000])
  expect(window.localStorage.getItem(HINT)).toBe('900')
})

test('a stale low hint still reads every page the first page reports', async () => {
  seed(2500)
  window.localStorage.setItem(HINT, '1200')
  const store = await load()
  expect(store.buildings).toHaveLength(2500)
  expect(new Set(store.buildings.map(b => b.id)).size).toBe(2500)
  expect(state.calls.map(call => call.from)).toEqual([0, 1000, 2000])
})

test('without a reported total, full pages keep reading one after another', async () => {
  seed(2350)
  state.reportTotal = false
  const store = await load()
  expect(store.buildings).toHaveLength(2350)
  expect(state.calls.map(call => call.from)).toEqual([0, 1000, 2000])
})

test('a row repeated across offset pages is kept once', async () => {
  seed(1500)
  state.rows = [...state.rows.slice(0, 1000), state.rows[999], ...state.rows.slice(1000)]
  const store = await load()
  expect(store.buildings).toHaveLength(1500)
  expect(new Set(store.buildings.map(b => b.id)).size).toBe(1500)
})

test('a failed concurrent page fails the read only after every page settled', async () => {
  seed(2350)
  window.localStorage.setItem(HINT, '2350')
  state.failFrom = 1000
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const view = renderHook(() => useStore(true))
  let settledWhenFailed: number[] = []
  await waitFor(() => { expect(view.result.current.loading).toBe(false); settledWhenFailed = [...state.settled] })
  expect(view.result.current.error).toBeTruthy()
  expect(view.result.current.buildings).toHaveLength(0)
  expect(settledWhenFailed.sort((a, b) => a - b)).toEqual([0, 1000, 2000])
})

test('unavailable storage falls back to the serial read', async () => {
  seed(1271)
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
  const store = await load()
  expect(store.buildings).toHaveLength(1271)
  expect(state.calls.map(call => call.from)).toEqual([0, 1000])
  expect(state.startedBeforeFirstAnswered).toEqual([])
})

// Codex review: an unbounded stale hint started one request per remembered page.
test('a huge stale hint starts at most three pages, then follows the reported total', async () => {
  seed(45)
  window.localStorage.setItem(HINT, '10001')
  const store = await load()
  expect(store.buildings).toHaveLength(45)
  expect(state.calls.map(call => call.from)).toEqual([0, 1000, 2000])
  expect(window.localStorage.getItem(HINT)).toBe('45')
})

test('a large reported total is read in waves of at most four concurrent pages', async () => {
  seed(9500)
  const store = await load()
  expect(store.buildings).toHaveLength(9500)
  expect(state.calls.map(call => call.from)).toEqual([0, 1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000])
  expect(state.maxInFlight).toBeLessThanOrEqual(4)
  expect(state.settledAtStart.get(5000)).toEqual(expect.arrayContaining([1000, 2000, 3000, 4000]))
})

// Known limitation shared with the earlier serial read: offset pages are not a snapshot.
// Deleting a row between page reads shifts the next row past the page boundary unseen.
test('known limitation: a row deleted between page reads can hide another building', async () => {
  seed(1500)
  state.pageOverrides.set(1000, state.rows.filter(row => row.id !== 1).slice(1000, 2000))
  const store = await load()
  expect(store.error).toBeNull()
  expect(store.buildings.some(row => row.id === 1001)).toBe(false)
  expect(store.buildings.some(row => row.id === 1)).toBe(true)
})
