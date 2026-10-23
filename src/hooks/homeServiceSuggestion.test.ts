import { beforeEach, expect, it, vi } from 'vitest'
const mock = vi.hoisted(() => ({ results: [] as Array<{ data: unknown[]; error: unknown }>, calls: [] as unknown[][] }))
vi.mock('../lib/supabase', () => ({ supabase: { from: (table: string) => {
  const query: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'order', 'range', 'limit']) query[method] = (...args: unknown[]) => {
    mock.calls.push([table, method, ...args])
    return query
  }
  query.then = (resolve: (value: unknown) => void) => Promise.resolve(mock.results.shift()).then(resolve)
  return query
} } }))
import { readHomeServiceSuggestion, selectHomeSuggestion } from './homeServiceSuggestion'
beforeEach(() => { mock.calls = []; mock.results = [] })
it('preserves effective last-used date with created-date fallback', () => {
  expect(selectHomeSuggestion([
    { id: 1, created_at: '2026-10-20', last_used_at: '2026-10-01' },
    { id: 2, created_at: '2026-10-19', last_used_at: null },
    { id: 3, created_at: '2026-09-01', last_used_at: '2026-10-18' },
  ])).toBe(2)
})
it('keeps input order for equal effective dates', () => {
  expect(selectHomeSuggestion([
    { id: 2, created_at: '2026-10-19', last_used_at: null },
    { id: 3, created_at: '2026-09-01', last_used_at: '2026-10-19' },
  ])).toBe(2)
})
it('reads lightweight visible index then only the selected visible body', async () => {
  mock.results = [{ data: [{ id: 7, created_at: '2026-10-20', last_used_at: null }], error: null }, { data: [{ id: 7, content: ['body'] }], error: null }]
  expect(await readHomeServiceSuggestion()).toEqual([{ id: 7, content: ['body'] }])
  expect(mock.calls.filter(c => c[1] === 'select')).toEqual([
    ['service_suggestions', 'select', 'id,last_used_at,created_at'], ['service_suggestions', 'select', '*'],
  ])
  expect(mock.calls).toContainEqual(['service_suggestions', 'eq', 'id', 7])
  expect(mock.calls.filter(c => c[1] === 'eq' && c[2] === 'is_visible')).toHaveLength(2)
  expect(mock.calls).toContainEqual(['service_suggestions', 'limit', 1])
})
it('requests newest-created first so equal last-used dates retain the newer creation', async () => {
  mock.results = [{ data: [
    { id: 8, created_at: '2026-10-20', last_used_at: '2026-10-21' },
    { id: 7, created_at: '2026-10-10', last_used_at: '2026-10-21' },
  ], error: null }, { data: [{ id: 8 }], error: null }]
  expect(await readHomeServiceSuggestion()).toEqual([{ id: 8 }])
  expect(mock.calls.filter(c => c[1] === 'order')).toEqual([
    ['service_suggestions', 'order', 'created_at', { ascending: false }],
    ['service_suggestions', 'order', 'id'],
  ])
  expect(mock.calls).toContainEqual(['service_suggestions', 'eq', 'id', 8])
})
it('does not request a body for an empty index', async () => {
  mock.results = [{ data: [], error: null }]
  expect(await readHomeServiceSuggestion()).toEqual([])
  expect(mock.calls.filter(c => c[1] === 'select')).toHaveLength(1)
})
it('does not display a suggestion hidden between reads', async () => {
  mock.results = [{ data: [{ id: 7, created_at: null, last_used_at: null }], error: null }, { data: [], error: null }]
  expect(await readHomeServiceSuggestion()).toEqual([])
})
it('surfaces index failure without downloading all bodies', async () => {
  mock.results = [{ data: [], error: new Error('offline') }]
  await expect(readHomeServiceSuggestion()).rejects.toThrow('offline')
  expect(mock.calls.filter(c => c[1] === 'select')).toHaveLength(1)
})
