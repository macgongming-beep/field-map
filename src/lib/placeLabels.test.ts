import { afterEach, expect, test, vi } from 'vitest'
import { readPlaceLabels } from './placeLabels'

type Call = { table: string; columns: string; ids?: number[]; from: number }
const state = vi.hoisted(() => ({ token: 'session', calls: [] as Call[], rows: {} as Record<string, Record<string, unknown>[]>, fail: '' , hold: null as Promise<void> | null, holdTable: '', ignoreFilter: false }))
vi.mock('./authToken', () => ({ getAuthToken: () => state.token }))
vi.mock('./supabase', () => ({ supabase: { from: (table: string) => {
  let columns = ''; let ids: number[] | undefined
  const q = { select: (value: string) => { columns = value; return q }, order: () => q,
    in: (_: string, value: number[]) => { ids = value; return q },
    range: async (from: number, to: number) => {
      state.calls.push({ table, columns, ids, from })
      if (state.hold && table === state.holdTable) await state.hold
      if (table === state.fail) return { data: null, error: new Error('offline') }
      const rows = (state.rows[table] ?? []).filter(row => state.ignoreFilter || ids?.includes(row.id as number))
      return { data: rows.slice(from, to + 1), error: null }
    } }
  return q
} } }))
afterEach(() => { state.calls = []; state.rows = {}; state.fail = ''; state.token = 'session'; state.hold = null; state.holdTable = ''; state.ignoreFilter = false })

const place = { id: 7, card_id: 3, name: 'Noodle', address: 'Road 1', lat: 37.2, lng: 127.1 }
test('reads only display and navigation columns for the requested places and units', async () => {
  state.rows = { buildings: [place], units: [{ id: 70, building_id: 7, number: '101' }] }
  expect(await readPlaceLabels([7, 7], [70])).toEqual([{ id: 7, cardId: 3, name: 'Noodle', address: 'Road 1', lat: 37.2, lng: 127.1, units: [{ id: 70, buildingId: 7, number: '101' }] }])
  expect(state.calls).toEqual([
    { table: 'buildings', columns: 'id,card_id,name,address,lat,lng', ids: [7], from: 0 },
    { table: 'units', columns: 'id,building_id,number', ids: [70], from: 0 },
  ])
  expect(state.calls.every(call => !/memo|access|regular/.test(call.columns))).toBe(true)
})
test('no place makes no request; no unit skips the unit read', async () => {
  expect(await readPlaceLabels([], [])).toEqual([])
  expect(state.calls).toEqual([])
  state.rows = { buildings: [place] }
  await readPlaceLabels([7], [])
  expect(state.calls.map(call => call.table)).toEqual(['buildings'])
})
test('a deleted place stays missing instead of becoming an empty building', async () => {
  state.rows = { buildings: [] }
  expect(await readPlaceLabels([7], [])).toEqual([])
})
test.each([
  ['a foreign building', { buildings: [{ ...place, id: 8 }] }],
  ['a unit of another building', { buildings: [place], units: [{ id: 70, building_id: 9, number: '1' }] }],
  ['a building without its card', { buildings: [{ ...place, card_id: null }] }],
  ['a duplicate building', { buildings: [place, place] }],
])('rejects %s from a server that ignores the filter', async (_label, rows) => {
  state.rows = rows as Record<string, Record<string, unknown>[]>
  state.ignoreFilter = true
  await expect(readPlaceLabels([7], [70])).rejects.toThrow(/Invalid place label row|Duplicate place label row/)
})
test('a failed read waits for its sibling and never returns a partial result', async () => {
  state.rows = { buildings: [place], units: [{ id: 70, building_id: 7, number: '101' }] }
  let release!: () => void
  state.hold = new Promise(resolve => { release = resolve }); state.holdTable = 'units'
  state.fail = 'buildings'
  let settled = false
  const read = readPlaceLabels([7], [70]).finally(() => { settled = true })
  await new Promise(resolve => setTimeout(resolve, 20))
  expect(settled).toBe(false)
  release()
  await expect(read).rejects.toThrow('offline')
})
test('batches of 100 IDs and pages of 1000 rows; a changed session is rejected', async () => {
  const ids = Array.from({ length: 150 }, (_, i) => i + 1)
  state.rows = { buildings: ids.map(id => ({ ...place, id })) }
  expect(await readPlaceLabels(ids, [])).toHaveLength(150)
  expect(state.calls.map(call => call.ids?.length)).toEqual([100, 50])
  state.token = ''
  await expect(readPlaceLabels([7], [])).rejects.toThrow('session')
})
