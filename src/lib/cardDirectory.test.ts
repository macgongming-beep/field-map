import { afterEach, expect, test, vi } from 'vitest'
import { readCardDirectory } from './cardDirectory'

const state = vi.hoisted(() => ({ token: 'session', calls: [] as unknown[], rows: [{ id: 2, name: 'Other team', area: 'Dong', region: 'Gu' }], error: false }))
vi.mock('./authToken', () => ({ getAuthToken: () => state.token }))
vi.mock('./supabase', () => ({ supabase: { from: (table: string) => {
  let columns = ''; let ids: number[] | undefined
  const q = { select: (value: string) => { columns = value; return q }, order: () => q,
    in: (_: string, value: number[]) => { ids = value; return q },
    range: async () => { state.calls.push({ table, columns, ids }); return { data: state.rows, error: state.error ? new Error('offline') : null } } }
  return q
} } }))
afterEach(() => { state.calls = []; state.error = false; state.token = 'session' })
test('shared event names request only ids and names for the requested cards', async () => {
  expect(await readCardDirectory([2, 2])).toEqual([{ id: 2, name: 'Other team' }])
  expect(state.calls).toEqual([{ table: 'cards', columns: 'id,name', ids: [2] }])
})
test('no assignment makes no request; foreign rows fail closed', async () => {
  expect(await readCardDirectory([])).toEqual([])
  expect(state.calls).toEqual([])
  await expect(readCardDirectory([3])).rejects.toThrow('Invalid card directory row')
})
test('restaurant/address directory has area and region but no assignments or counts', async () => {
  expect(await readCardDirectory()).toEqual(state.rows)
  expect(state.calls).toEqual([{ table: 'cards', columns: 'id,name,area,region', ids: undefined }])
})
test('errors do not become an empty successful directory', async () => {
  state.error = true
  await expect(readCardDirectory([2])).rejects.toThrow('offline')
  state.token = ''
  await expect(readCardDirectory()).rejects.toThrow('session')
})
