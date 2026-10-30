// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const calls = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }))
vi.mock('../../lib/supabase', () => ({ supabase: calls }))
import { fetchMeetingCollections, fetchMeetingNoteMetas, invalidateHomeMeetingMetas, MeetingConflict, NOTE_META_COLUMNS, saveMeetingNote } from './api'
beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); invalidateHomeMeetingMetas() })
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks() })
function queries() {
  const results: { data: Record<string, unknown>[]; error: Error | null }[] = []
  const selects: string[] = []
  calls.from.mockImplementation(() => {
    const q: Record<string, unknown> = {}
    for (const key of ['in', 'is', 'order']) q[key] = () => q
    q.select = (columns: string) => { selects.push(columns); return q }
    q.then = (resolve: (value: unknown) => void) => Promise.resolve(results.shift()).then(resolve)
    return q
  })
  return { results, selects }
}
const note = { id: 5, collection_id: 1, updated_at: 'v1', title_ko: 'original' }
async function primeHome() {
  vi.stubEnv('VITE_DEMO_MODE', 'true'); localStorage.setItem('auth_token', 'one')
  const q = queries(); q.results.push({ data: [note], error: null })
  const rows = await fetchMeetingNoteMetas([1], true)
  q.selects.length = 0
  return { ...q, rows }
}
it('revalidates meeting IDs and versions before reusing metadata; TTL is not extended', async () => {
  const clock = vi.spyOn(Date, 'now').mockReturnValue(1000)
  const q = await primeHome()
  clock.mockReturnValue(120000)
  q.results.push({ data: [note], error: null })
  expect(await fetchMeetingNoteMetas([1], true)).toEqual(q.rows)
  expect(q.selects).toEqual(['id,collection_id,updated_at'])
  q.selects.length = 0; clock.mockReturnValue(121000)
  q.results.push({ data: [note], error: null })
  await fetchMeetingNoteMetas([1], true)
  expect(q.selects).toEqual([NOTE_META_COLUMNS])
})
it.each(['edited', 'archived', 'added', 'moved'])('refreshes meeting metadata when the index is %s', async reason => {
  const q = await primeHome()
  const rows = reason === 'archived' ? [] : reason === 'added' ? [note, { ...note, id: 6 }]
    : [{ ...note, updated_at: reason === 'edited' ? 'v2' : 'v1', collection_id: reason === 'moved' ? 2 : 1, title_ko: 'changed' }]
  q.results.push({ data: rows, error: null }, { data: rows, error: null })
  const actual = await fetchMeetingNoteMetas([1], true)
  expect(q.selects).toEqual(['id,collection_id,updated_at', NOTE_META_COLUMNS])
  expect(actual.map(n => n.id)).toEqual(rows.map(n => n.id))
  if (reason === 'edited') expect(actual[0].titleKo).toBe('changed')
})
it.each(['account', 'scope', 'invalidate', 'admin', 'production'])('does not reuse meeting text across %s', async reason => {
  const q = await primeHome()
  if (reason === 'account') localStorage.setItem('auth_token', 'two')
  if (reason === 'invalidate') invalidateHomeMeetingMetas()
  if (reason === 'production') vi.stubEnv('VITE_DEMO_MODE', 'false')
  q.results.push({ data: [note], error: null })
  await fetchMeetingNoteMetas(reason === 'scope' ? [2] : [1], reason !== 'admin')
  expect(q.selects).toEqual([NOTE_META_COLUMNS])
})
it('does not silently display cached notes if visibility/version validation fails', async () => {
  const q = await primeHome()
  q.results.push({ data: [], error: new Error('offline') })
  await expect(fetchMeetingNoteMetas([1], true)).rejects.toThrow('offline')
  expect(q.selects).toEqual(['id,collection_id,updated_at'])
})
it.each(['account', 'edit'])('rejects late meeting metadata after %s without poisoning the next cache', async reason => {
  vi.stubEnv('VITE_DEMO_MODE', 'true'); localStorage.setItem('auth_token', 'one')
  let release!: (value: unknown) => void
  const pending = new Promise(done => { release = done })
  const q: Record<string, unknown> = {}
  for (const method of ['select', 'in', 'is', 'order']) q[method] = () => q
  q.then = (resolve: (value: unknown) => void) => pending.then(resolve)
  calls.from.mockReturnValue(q)
  const old = fetchMeetingNoteMetas([1], true)
  if (reason === 'account') localStorage.setItem('auth_token', 'two')
  else {
    calls.rpc.mockResolvedValue({ data: { ok: true, id: 5 }, error: null })
    await saveMeetingNote(null, 1, { titleKo: 'new', titleZh: '', bodyKo: 'new', bodyZh: '' })
  }
  release({ data: [note], error: null })
  await expect(old).rejects.toThrow('superseded')
  const next = queries(); next.results.push({ data: [{ ...note, updated_at: 'v2' }], error: null })
  expect((await fetchMeetingNoteMetas([1], true))[0].updatedAt).toBe('v2')
  expect(next.selects).toEqual([NOTE_META_COLUMNS])
})
describe('meeting requests', () => {
  it('home filters only the switch while trash uses archived state', async () => {
    const query = { select: vi.fn(), is: vi.fn(), not: vi.fn(), eq: vi.fn(), order: vi.fn(), then: (resolve: (value: unknown) => void) => resolve({ data: [], error: null }) }
    for (const fn of [query.select, query.is, query.not, query.eq, query.order]) fn.mockReturnValue(query)
    calls.from.mockReturnValue(query)
    await fetchMeetingCollections('home')
    expect(query.eq).toHaveBeenCalledWith('home_enabled', true)
    expect(query.is).toHaveBeenCalledWith('archived_at', null)
    await fetchMeetingCollections('trash')
    expect(query.not).toHaveBeenCalledWith('archived_at', 'is', null)
  })
  it('does not load notes when no active collections exist', async () => {
    expect(await fetchMeetingNoteMetas([])).toEqual([])
    expect(calls.from).not.toHaveBeenCalled()
  })
  it('excludes bodies from the actual metadata query', async () => {
    const query = { select: vi.fn(), in: vi.fn(), is: vi.fn(), order: vi.fn(), then: (resolve: (value: unknown) => void) => resolve({ data: [], error: null }) }
    for (const fn of [query.select, query.in, query.is, query.order]) fn.mockReturnValue(query)
    calls.from.mockReturnValue(query)
    await fetchMeetingNoteMetas([1])
    expect(query.select).toHaveBeenCalledWith(NOTE_META_COLUMNS)
    expect(query.select.mock.calls[0][0]).not.toMatch(/body|\*/)
    expect(query.in).toHaveBeenCalledWith('collection_id', [1])
  })
  it('rejects conflict without reporting a successful save and sends the expected version', async () => {
    localStorage.setItem('auth_token', 'test-token')
    calls.rpc.mockResolvedValue({ data: { ok: false, conflict: true }, error: null })
    await expect(saveMeetingNote(2, 3, { titleKo: '제목', titleZh: '', bodyKo: '본문', bodyZh: '' })).rejects.toBeInstanceOf(MeetingConflict)
    expect(calls.rpc).toHaveBeenCalledWith('save_service_meeting_note', expect.objectContaining({ p_token: 'test-token', p_event_id: 2, p_collection_id: 3, p_expected_updated_at: null }))
  })
})
