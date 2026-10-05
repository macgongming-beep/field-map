import { beforeEach, expect, test, vi } from 'vitest'
const state = vi.hoisted(() => ({ token: 'session', rows: {} as Record<string, Record<string, unknown>[]>, prefetch: vi.fn(), assignments: vi.fn(), invalidate: vi.fn(), rpc: vi.fn() }))
vi.mock('./authToken', () => ({ getAuthToken: () => state.token }))
vi.mock('./recipientPreview', () => ({ createRecipientPreview: () => ({
  assignments: state.assignments, reader: { prefetch: state.prefetch, invalidate: state.invalidate }, dispose: vi.fn(),
}) }))
vi.mock('./supabase', () => ({ supabase: { rpc: state.rpc, from: (table: string) => {
  let rows = state.rows[table] ?? []
  const q = {
    select: () => q, order: () => q,
    eq: (key: string, value: unknown) => { rows = rows.filter((row) => row[key] === value); return q },
    is: (key: string, value: unknown) => { rows = rows.filter((row) => (row[key] ?? null) === value); return q },
    in: (key: string, values: unknown[]) => { rows = rows.filter((row) => values.includes(row[key])); return q },
    range: async (from: number, to: number) => ({ data: rows.slice(from, to + 1), error: null }),
  }
  return q
} } }))
import { createRecipientStoreReader, recipientStoreEnabled } from './recipientStore'

beforeEach(() => {
  vi.clearAllMocks(); state.token = 'session'; state.rows = {}
  state.assignments.mockResolvedValue([])
  state.rpc.mockResolvedValue({ data: [], error: null })
  state.prefetch.mockImplementation((ids: number[]) => ({ details: Promise.resolve({ buildings: ids.map((card_id) => ({ card_id })), boundaries: [], histories: [], baseline: null }) }))
})

test('only the real demo volunteer workflow opts in; general maps and administrators stay full', () => {
  expect(recipientStoreEnabled('user', '/territory', '', 'true')).toBe(true)
  expect(recipientStoreEnabled('user', '/map', '?assignmentMap=51', 'true')).toBe(true)
  expect(recipientStoreEnabled('user', '/map', '?scope=regularVisits', 'true')).toBe(false)
  expect(recipientStoreEnabled('admin', '/territory', '', 'true')).toBe(false)
  expect(recipientStoreEnabled('user', '/territory', '', 'false')).toBe(false)
})

test('includes multi-card assignments, active sessions and restaurant links without loading unrelated cards', async () => {
  state.assignments.mockResolvedValue([{ cardAssignments: [{ userName: 'me', assignedCardIds: [1, 2] }] }])
  state.rows = {
    card_assignments: [{ card_id: 3, user_name: 'me' }, { card_id: 99, user_name: 'other' }],
    service_sessions: [{ primary_card_id: 4, user_name: 'me', status: 'active' }],
    buildings: [{ id: 50, card_id: 5, is_restaurant: true }, { id: 60, card_id: 6 }, { id: 70, card_id: 7 }],
    units: [{ building_id: 60, is_restaurant: true }],
    event_restaurant_assignments: [{ building_id: 70, user_name: 'me' }],
  }
  const reader = createRecipientStoreReader('me')
  await reader.read()
  expect(state.prefetch).toHaveBeenCalledExactlyOnceWith([1, 2, 3, 4, 5, 6, 7])
  expect(reader.allowsCard(99)).toBe(false)
  await reader.read()
  expect(state.prefetch).toHaveBeenCalledTimes(1)
})

test('unassignment refresh removes old scope, including the last card', async () => {
  state.rows.card_assignments = [{ card_id: 1, user_name: 'me' }]
  const reader = createRecipientStoreReader('me')
  await reader.read()
  state.rows.card_assignments = []
  reader.refresh()
  expect((await reader.read())?.buildings).toEqual([])
  expect(reader.allowsCard(1)).toBe(false)
  expect(reader.scoped).toBe(true)
})

test('return-visit cards join the scoped read without forcing a full store', async () => {
  state.rpc.mockResolvedValue({ data: [3, 4], error: null })
  const reader = createRecipientStoreReader('me')
  await reader.read()
  expect(state.rpc).toHaveBeenCalledWith('get_recipient_return_visit_card_ids', { p_token: 'session' })
  expect(state.prefetch).toHaveBeenCalledWith([3, 4])
  expect(reader.scoped).toBe(true)
  expect(reader.allowsCard(99)).toBe(false)
})

test.each([{ data: null, error: new Error('RPC unavailable') }, { data: [0], error: null }])('a failed resolver never silently excludes return visits or expands to all buildings', async (response) => {
  state.rpc.mockResolvedValue(response)
  const reader = createRecipientStoreReader('me')
  await expect(reader.read()).rejects.toThrow()
  expect(state.prefetch).not.toHaveBeenCalled()
})

test('session changes reject reads and StrictMode can resume the same account', async () => {
  const reader = createRecipientStoreReader('me')
  reader.dispose()
  await expect(reader.read()).rejects.toThrow('session changed')
  reader.resume()
  await reader.read()
  state.token = 'another-account'
  expect(() => reader.refresh()).toThrow('session changed')
})
