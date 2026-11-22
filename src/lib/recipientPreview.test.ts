import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ from: vi.fn(), token: vi.fn(() => 'demo-session') }))
vi.mock('./supabase', () => ({ supabase: { from: mocks.from } }))
vi.mock('./authToken', () => ({ getAuthToken: mocks.token }))
import { createRecipientPreview, recipientPreviewEnabled } from './recipientPreview'

beforeEach(() => {
  vi.clearAllMocks(); mocks.token.mockReturnValue('demo-session')
  vi.stubEnv('VITE_DEMO_MODE', 'false')
  vi.stubEnv('VITE_RECIPIENT_DISCOVERY_REUSE_ENABLED', 'true')
})
afterEach(() => vi.unstubAllEnvs())

type Row = Record<string, unknown>
type Response = { data: unknown; error: unknown }
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function discoveryFixture() {
  const rows: Record<string, Row[]> = {
    event_card_assignments: [{ id: 1, event_id: 10, user_name: 'Volunteer', assigned_card_id: 1 }],
    event_card_assignment_cards: [{ id: 1, event_id: 10, user_name: 'Volunteer', card_id: 2 }],
    calendar_events: [{ id: 10, event_date: '2020-01-01', time: '10:00' }],
  }
  const calls: { table: string; columns: string; filters: [string, unknown][]; order: string; from: number; to: number }[] = []
  const response = vi.fn(async (_table: string, data: Row[]): Promise<Response> => ({ data, error: null }))
  mocks.from.mockImplementation((table: string) => {
    let selected = rows[table]
    let columns = ''
    let order = ''
    const filters: [string, unknown][] = []
    const query = {
      select: (value: string) => { columns = value; return query },
      order: (value: string) => { order = value; return query },
      eq: (key: string, value: unknown) => { filters.push([key, value]); selected = selected.filter(row => row[key] === value); return query },
      in: (key: string, values: number[]) => { filters.push([key, values]); selected = selected.filter(row => values.includes(Number(row[key]))); return query },
      range: (from: number, to: number) => {
        calls.push({ table, columns, filters, order, from, to })
        return response(table, selected.slice(from, to + 1))
      },
    }
    return query
  })
  return { rows, calls, response }
}

describe('recipient preview isolation', () => {
  it('scope-only discovery retains all dates and fresh links, reuses only known event existence', async () => {
    const f = discoveryFixture()
    f.rows.event_card_assignments.push(
      { id: 2, event_id: 20, user_name: 'Volunteer', assigned_card_id: 3 },
      { id: 3, event_id: 30, user_name: 'Volunteer', assigned_card_id: 4 },
      { id: 4, event_id: 10, user_name: 'Other', assigned_card_id: 99 },
    )
    f.rows.calendar_events.push({ id: 20, event_date: '2030-01-01', time: '10:00' })
    const api = createRecipientPreview('Volunteer')
    expect(await api.assignmentCardIds([10, 999])).toEqual([2, 3])
    expect(f.calls.find(call => call.table === 'calendar_events')).toMatchObject({ columns: 'id', filters: [['id', [20, 30]]] })
    // A previous known event must not become a persistent authorization cache.
    f.calls.length = 0
    f.rows.calendar_events = []
    expect(await api.assignmentCardIds()).toEqual([])
    expect(f.calls.find(call => call.table === 'calendar_events')?.filters).toEqual([['id', [10, 20, 30]]])
    f.rows.event_card_assignments = []
    expect(await api.assignmentCardIds([10, 20])).toEqual([])
  })

  it('fully covered events omit the redundant event request, but not fresh personal assignments and links', async () => {
    const f = discoveryFixture()
    const api = createRecipientPreview('Volunteer')
    expect(await api.assignmentCardIds([10])).toEqual([2])
    expect(f.calls.map(call => call.table)).toEqual(['event_card_assignments', 'event_card_assignment_cards'])
    f.rows.event_card_assignment_cards[0].card_id = 8
    expect(await api.assignmentCardIds([10])).toEqual([8])
    f.rows.event_card_assignments = []
    expect(await api.assignmentCardIds([10])).toEqual([])
  })

  it('scope-only and full discovery produce the same IDs with no known calendar', async () => {
    const f = discoveryFixture()
    f.rows.event_card_assignments.push({ id: 2, event_id: 20, user_name: 'Volunteer', assigned_card_id: 3 })
    f.rows.calendar_events.push({ id: 20, event_date: '2030-01-01', time: '10:00' })
    const api = createRecipientPreview('Volunteer')
    const full = await api.assignments()
    const ids = await api.assignmentCardIds()
    expect(ids.sort()).toEqual(full.flatMap(event => event.cardAssignments.flatMap(row => row.assignedCardIds ?? [])).sort())
  })

  it('scope-only discovery preserves pagination, missing events, and multi-card assignment limits', async () => {
    const f = discoveryFixture()
    f.rows.event_card_assignments = Array.from({ length: 1001 }, (_, i) => ({ id: i + 1, event_id: i % 101 + 1, user_name: 'Volunteer', assigned_card_id: i + 1 }))
    f.rows.event_card_assignment_cards = Array.from({ length: 1001 }, (_, i) => ({ id: i + 1, event_id: 1, user_name: 'Volunteer', card_id: i + 2001 }))
    f.rows.calendar_events = Array.from({ length: 100 }, (_, i) => ({ id: i + 1, event_date: '2020-01-01', time: '10:00' }))
    const api = createRecipientPreview('Volunteer')
    const full = await api.assignments()
    f.calls.length = 0
    const ids = await api.assignmentCardIds([1])
    const expected = full.flatMap(event => {
      const row = event.cardAssignments.find(a => a.userName === 'Volunteer')
      return row?.assignedCardIds?.length ? row.assignedCardIds : row?.assignedCardId == null ? [] : [row.assignedCardId]
    })
    expect(ids.sort((a,b)=>a-b)).toEqual(expected.sort((a,b)=>a-b))
    expect(ids).not.toContain(101)
    expect(f.calls.filter(call => call.table === 'event_card_assignments')).toHaveLength(2)
    expect(f.calls.filter(call => call.table === 'event_card_assignment_cards')).toHaveLength(3)
    expect(f.calls.filter(call => call.table === 'calendar_events').every(call => call.columns === 'id')).toBe(true)
  })

  it('scope-only discovery rejects missing-event read errors and changed sessions', async () => {
    const f = discoveryFixture()
    f.response.mockImplementation(async (table, data) => table === 'calendar_events' ? { data: null, error: new Error('scope unavailable') } : { data, error: null })
    const api = createRecipientPreview('Volunteer')
    await expect(api.assignmentCardIds()).rejects.toThrow('scope unavailable')
    f.response.mockImplementation(async (_table, data) => ({ data, error: null }))
    expect(await api.assignmentCardIds()).toEqual([2])
    mocks.token.mockReturnValue('another-account')
    await expect(api.assignmentCardIds([10])).rejects.toThrow('session changed')
  })

  it.each(['event_card_assignment_cards', 'calendar_events'])('overlaps the same scoped reads while %s is pending', async (slowTable) => {
    const f = discoveryFixture()
    const gate = deferred<Response>()
    f.response.mockImplementation(async (table, data) => table === slowTable ? gate.promise : { data, error: null })
    const api = createRecipientPreview('Volunteer')
    const pending = api.assignments()
    let settled = false
    void pending.then(() => { settled = true })
    await vi.waitFor(() => expect(f.calls).toHaveLength(3))
    expect(settled).toBe(false)
    gate.resolve({ data: f.rows[slowTable], error: null })
    expect((await pending)[0].cardAssignments[0].assignedCardIds).toEqual([2])
    expect(f.calls.map(call => call.table)).toEqual(['event_card_assignments', 'event_card_assignment_cards', 'calendar_events'])
  })

  it.each(['false', undefined])('keeps discovery serial without explicit opt-in (%s), even in demo mode', async (flag) => {
    vi.stubEnv('VITE_DEMO_MODE', 'true')
    vi.stubEnv('VITE_RECIPIENT_DISCOVERY_REUSE_ENABLED', flag)
    const f = discoveryFixture()
    const gate = deferred<Response>()
    f.response.mockImplementation(async (table, data) => table === 'event_card_assignment_cards' ? gate.promise : { data, error: null })
    const pending = createRecipientPreview('Volunteer').assignments()
    await vi.waitFor(() => expect(f.calls).toHaveLength(2))
    expect(f.calls.some(call => call.table === 'calendar_events')).toBe(false)
    gate.resolve({ data: f.rows.event_card_assignment_cards, error: null })
    await pending
    expect(f.calls).toHaveLength(3)
  })

  it('preserves exact requests, response payloads and all-date personal scope across batches/pages', async () => {
    const f = discoveryFixture()
    f.rows.event_card_assignments = Array.from({ length: 1001 }, (_, i) => ({ id: i + 1, event_id: i % 101 + 1, user_name: 'Volunteer', assigned_card_id: i % 101 + 1 }))
    f.rows.event_card_assignment_cards = Array.from({ length: 1001 }, (_, i) => ({ id: i + 1, event_id: 1, user_name: 'Volunteer', card_id: i + 1001 }))
    f.rows.event_card_assignment_cards.push({ id: 2001, event_id: 1, user_name: 'Other', card_id: 9999 }, { id: 2002, event_id: 999, user_name: 'Volunteer', card_id: 9998 })
    f.rows.calendar_events = Array.from({ length: 101 }, (_, i) => ({ id: i + 1, event_date: i === 0 ? '2020-01-01' : '2030-01-01', time: '10:00' }))
    const demoResult = await createRecipientPreview('Volunteer').assignments()
    expect(f.calls.filter(call => call.table === 'event_card_assignments')).toEqual([0, 1000].map(from => ({
      table: 'event_card_assignments', columns: '*', filters: [['user_name', 'Volunteer']], order: 'id', from, to: from + 999,
    })))
    for (const call of f.calls.filter(call => call.table === 'event_card_assignment_cards')) {
      expect(call.columns).toBe('*')
      expect(call.filters).toEqual([['user_name', 'Volunteer'], ['event_id', call.filters[1][1]]])
    }
    for (const call of f.calls.filter(call => call.table === 'calendar_events')) {
      expect(call.columns).toBe('*, event_participants(*)')
      expect(call.filters).toEqual([['id', call.filters[0][1]]])
    }
    const demoCalls = f.calls.map(call => JSON.stringify(call)).sort()
    const demoPayloads = f.response.mock.calls.map(([table, rows]) => JSON.stringify({ table, rows })).sort()
    f.calls.length = 0
    f.response.mockClear()
    vi.stubEnv('VITE_RECIPIENT_DISCOVERY_REUSE_ENABLED', 'false')
    const serialResult = await createRecipientPreview('Volunteer').assignments()
    expect(demoResult).toEqual(serialResult)
    expect(demoResult).toHaveLength(101)
    expect(demoResult.at(-1)?.date).toBe('2020-01-01')
    expect(demoResult[0].date).toBe('2030-01-01')
    expect(demoResult.flatMap(event => event.cardAssignments.flatMap(row => row.assignedCardIds))).not.toContain(9999)
    expect(demoResult.flatMap(event => event.cardAssignments.flatMap(row => row.assignedCardIds))).not.toContain(9998)
    expect(demoCalls).toEqual(f.calls.map(call => JSON.stringify(call)).sort())
    expect(demoPayloads).toEqual(f.response.mock.calls.map(([table, rows]) => JSON.stringify({ table, rows })).sort())
    expect(f.calls).toHaveLength(7)
  })

  it.each([
    ['event_card_assignment_cards', 'error'], ['calendar_events', 'error'],
    ['event_card_assignment_cards', 'reject'], ['calendar_events', 'reject'],
    ['event_card_assignment_cards', 'invalid'], ['calendar_events', 'invalid'],
  ])('drains the sibling after %s %s, rejects and permits a clean retry', async (failedTable, mode) => {
    const f = discoveryFixture()
    const sibling = failedTable === 'calendar_events' ? 'event_card_assignment_cards' : 'calendar_events'
    const gate = deferred<Response>()
    const failure = new Error('Discovery failed')
    f.response.mockImplementation(async (table, data) => {
      if (table === sibling) return gate.promise
      if (table === failedTable) {
        if (mode === 'reject') throw failure
        return mode === 'invalid' ? { data: null, error: null } : { data: null, error: failure }
      }
      return { data, error: null }
    })
    const api = createRecipientPreview('Volunteer')
    const pending = api.assignments()
    const outcome = pending.then(() => 'success', error => error.message)
    let settled = false
    void outcome.then(() => { settled = true })
    await vi.waitFor(() => expect(f.calls).toHaveLength(3))
    expect(settled).toBe(false)
    gate.resolve({ data: f.rows[sibling], error: null })
    expect(await outcome).toBe(mode === 'invalid' ? 'Invalid assignment response' : 'Discovery failed')
    f.response.mockImplementation(async (_table, data) => ({ data, error: null }))
    expect(await api.assignments()).toHaveLength(1)
    expect(f.calls).toHaveLength(6)
  })

  it.each(['event_card_assignments', 'event_card_assignment_cards', 'calendar_events'])('rejects a changed identity while %s is pending without further pages', async (slowTable) => {
    const f = discoveryFixture()
    const gate = deferred<Response>()
    let delayed = false
    f.response.mockImplementation(async (table, data) => {
      if (table === slowTable && !delayed) { delayed = true; return gate.promise }
      return { data, error: null }
    })
    const pending = createRecipientPreview('Volunteer').assignments()
    const rejection = expect(pending).rejects.toThrow('session changed')
    await vi.waitFor(() => expect(f.calls.some(call => call.table === slowTable)).toBe(true))
    const count = f.calls.length
    mocks.token.mockReturnValue('another-session')
    gate.resolve({ data: Array.from({ length: 1000 }, () => f.rows[slowTable][0]), error: null })
    await rejection
    expect(f.calls).toHaveLength(count)
  })

  it('requires both the explicit demo flag and the separate preview route', () => {
    expect(recipientPreviewEnabled('/recipient-preview', 'true')).toBe(true)
    expect(recipientPreviewEnabled('/territory', 'true')).toBe(false)
    expect(recipientPreviewEnabled('/recipient-preview', 'false')).toBe(false)
    expect(recipientPreviewEnabled('/recipient-preview', undefined)).toBe(false)
  })

  it('reads multi-card links by event and recipient, not a nonexistent assignment_id', async () => {
    const rows: Record<string, Record<string, unknown>[]> = {
      event_card_assignments: [
        { id: 5, event_id: 10, user_name: 'Volunteer', assigned_card_id: 1, team_key: 'team-1' },
        { id: 6, event_id: 20, user_name: 'Someone else', assigned_card_id: 99 },
      ],
      event_card_assignment_cards: [
        { id: 1, event_id: 10, user_name: 'Volunteer', card_id: 1 },
        { id: 2, event_id: 10, user_name: 'Volunteer', card_id: 2 },
        { id: 3, event_id: 10, user_name: 'Someone else', card_id: 99 },
        { id: 4, event_id: 20, user_name: 'Volunteer', card_id: 98 },
      ],
      calendar_events: [{ id: 10, event_date: '2026-10-05', time: '10:00', assignment_team_scopes: { 'team-1': '상가' } }],
    }
    const filters: string[] = []
    mocks.from.mockImplementation((table: string) => {
      let selected = rows[table]
      const query = {
        select: () => query,
        order: () => query,
        eq: (key: string, value: unknown) => { filters.push(`${table}.${key}`); selected = selected.filter((row) => row[key] === value); return query },
        in: (key: string, values: number[]) => { filters.push(`${table}.${key}`); selected = selected.filter((row) => values.includes(Number(row[key]))); return query },
        range: async (from: number, to: number) => ({ data: selected.slice(from, to + 1), error: null }),
      }
      return query
    })
    const api = createRecipientPreview('Volunteer')
    const result = await api.assignments()
    expect(result).toHaveLength(1)
    expect(result[0].cardAssignments[0].assignedCardIds).toEqual([1, 2])
    expect(result[0].cardAssignments[0].cardScope).toBe('상가')
    expect(filters).toContain('event_card_assignment_cards.event_id')
    expect(filters).toContain('event_card_assignment_cards.user_name')
    api.dispose()
    await expect(api.assignments()).rejects.toThrow('session changed')
  })

  it('never expands no assignment or a read failure into a global query', async () => {
    const range = vi.fn().mockResolvedValue({ data: [], error: null })
    const query = { select: () => query, eq: () => query, order: () => query, range }
    mocks.from.mockReturnValue(query)
    const api = createRecipientPreview('Volunteer')
    expect(await api.assignments()).toEqual([])
    expect(mocks.from).toHaveBeenCalledTimes(1)
    range.mockResolvedValueOnce({ data: null, error: new Error('Network unavailable') })
    await expect(api.assignments()).rejects.toThrow('Network unavailable')
    expect(mocks.from).toHaveBeenCalledTimes(2)
  })

  it('does not reuse another account session', () => {
    mocks.token.mockReturnValueOnce('')
    expect(() => createRecipientPreview('Volunteer')).toThrow('로그인이 필요합니다.')
  })
})
