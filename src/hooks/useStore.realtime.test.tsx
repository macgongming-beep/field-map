import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, expect, test, vi } from 'vitest'
import { useStore } from './useStore'
import { testBuilding } from '../test/territoryFixture'

const state = vi.hoisted(() => ({ rpc: vi.fn(), changed: vi.fn(), clock: vi.fn(), index: vi.fn(), reads: [] as string[], boundaryColumns: [] as string[], block: null as null | Promise<void> }))
const logColumns = vi.hoisted(() => [] as string[])
const creationCards = vi.hoisted(() => ({ enabled: false, ids: [1] }))
const returnResponses = vi.hoisted(() => [] as Promise<{ data: Record<string, unknown>[]; error: unknown }> [])
const groupResponses = vi.hoisted(() => [] as Promise<{ data: Record<string, unknown>[]; error: unknown }> [])
const assetResponses = vi.hoisted(() => [] as Promise<{ data: Record<string, unknown>[]; error: unknown }> [])
const calendarResponses = vi.hoisted(() => [] as Promise<{ data: Record<string, unknown>[]; error: unknown }> [])
const buildingResponses = vi.hoisted(() => [] as Promise<{ data: Record<string, unknown>[]; error: unknown }> [])
const calendarAssignmentState = vi.hoisted(() => ({ failedTable: '', rows: {} as Record<string, Record<string, unknown>[]> }))
const updatedEvent = vi.hoisted(() => vi.fn())
const toast = vi.hoisted(() => vi.fn())
vi.mock('../lib/toast', () => ({ showToast: toast }))
vi.mock('./calendarEventRefresh', () => ({ CALENDAR_EVENT_COLUMNS: '*, event_participants(*)', fetchUpdatedCalendarEvent: updatedEvent }))
vi.mock('./territorySync', () => ({ fetchChangedBuildings: state.changed, fetchTerritoryClock: state.clock, fetchBuildingRecoveryIndex: state.index }))
vi.mock('../lib/supabase', () => ({ supabase: {
  rpc: (...args: unknown[]) => state.rpc(...args) ?? Promise.resolve({ error: null }),
  from: (table: string) => {
    const chain: Record<string, unknown> = {}
    let lookup = false
    let writing = false
    for (const name of ['select', 'order', 'range', 'eq', 'in', 'is', 'gte', 'lte', 'neq']) chain[name] = () => chain
    for (const name of ['insert', 'update', 'upsert', 'delete']) chain[name] = () => { writing = true; return chain }
    chain.select = (columns: string) => {
      if (table === 'card_boundaries') state.boundaryColumns.push(columns)
      if (table === 'return_visit_logs') logColumns.push(columns)
      return chain
    }
    chain.limit = () => { lookup = true; return chain }
    chain.single = async () => { state.reads.push(table); return { data: { id: 7 }, error: null } }
    chain.then = async (resolve: (r: unknown) => void) => {
      state.reads.push(table)
      if (!writing && table === 'return_visits' && returnResponses.length) return resolve(await returnResponses.shift())
      if (!writing && table === 'informal_groups' && groupResponses.length) return resolve(await groupResponses.shift())
      if (!writing && table === 'informal_assets' && assetResponses.length) return resolve(await assetResponses.shift())
      if (!writing && table === 'calendar_events' && calendarResponses.length) return resolve(await calendarResponses.shift())
      if (!writing && table === 'buildings' && buildingResponses.length) return resolve(await buildingResponses.shift())
      if (!writing && (table === 'event_card_assignments' || table === 'event_card_assignment_cards')) {
        return resolve({ data: calendarAssignmentState.rows[table] ?? [],
          error: calendarAssignmentState.failedTable === table ? new Error('assignment read failed') : null })
      }
      if (table === 'buildings') await state.block
      return resolve({ data: creationCards.enabled && table === 'cards' ? creationCards.ids.map(id => ({ id, name: 'card', card_assignments: [] })) : writing && (table === 'buildings' || table === 'units' || table === 'return_visits' || table === 'informal_groups' || table === 'informal_assets') ? [{ id: 1 }] : writing && table === 'card_boundaries' ? [{ card_id: 1 }] : lookup ? [{ id: 1 }] : [], error: null })
    }
    return chain
  },
} }))
afterEach(() => { cleanup(); vi.clearAllMocks(); state.rpc.mockReset(); state.changed.mockReset(); vi.unstubAllEnvs(); localStorage.clear(); state.reads = []; state.boundaryColumns = []; state.block = null })
afterEach(() => { logColumns.length = 0; creationCards.enabled = false; returnResponses.length = 0; groupResponses.length = 0; assetResponses.length = 0 })
afterEach(() => { calendarResponses.length = 0; buildingResponses.length = 0; updatedEvent.mockReset(); creationCards.ids = [1] })
afterEach(() => { calendarAssignmentState.failedTable = ''; calendarAssignmentState.rows = {} })

const eventInput = { time: '11:00', title: 'edited', place: '', leader: '', memo: '', hasMeeting: true, allowApplications: true }
const rawEvents = [
  { id: 1, event_date: '2026-10-20', time: '10:00', title: 'before', event_participants: [{ user_name: 'A' }] },
  { id: 2, event_date: '2026-08-20', time: '10:00', title: 'history', event_participants: [{ user_name: 'B' }] },
]
const calendarMoveFlagCases = [
  [undefined, undefined, false], ['false', undefined, false], ['true', undefined, true],
  ['false', 'true', true], ['true', 'false', false], ['false', 'false', false],
] as const

const fullReadNotificationCases = (['buildings', 'calendar'] as const).flatMap(slice =>
  ['true', 'false'].flatMap(flag => [true, false].map(loaded => ({ slice, flag, loaded }))))

test('refetchAll reports a real parallel failure after calendar supersession', async () => {
  vi.stubEnv('VITE_DEMO_MODE', 'false')
  vi.stubEnv('VITE_CALENDAR_EVENT_REFRESH_ENABLED', 'true')
  const { result } = renderHook(() => useStore(false))
  await act(async () => { await result.current.refetchAll() })
  toast.mockClear()
  let releaseCalendar!: (value: { data: Record<string, unknown>[]; error: null }) => void
  let releaseVisits!: (value: { data: Record<string, unknown>[]; error: unknown }) => void
  calendarResponses.push(new Promise(resolve => { releaseCalendar = resolve }))
  returnResponses.push(new Promise(resolve => { releaseVisits = resolve }))
  let refresh!: Promise<unknown>
  act(() => { refresh = result.current.refetchAll().then(() => null, error => error) })
  await waitFor(() => {
    expect(calendarResponses).toHaveLength(0)
    expect(returnResponses).toHaveLength(0)
  })
  await act(async () => { await result.current.refetchSlices(['calendar']) })
  await act(async () => { releaseCalendar({ data: [], error: null }) })
  await act(async () => {
    releaseVisits({ data: [], error: new Error('offline') })
    expect(await refresh).toEqual(expect.objectContaining({ message: 'Return visit data load failed' }))
  })
  expect(result.current.error).toBeNull()
  expect(toast).toHaveBeenCalledExactlyOnceWith(expect.any(String), 'error')
})

test.each(['buildings', 'calendar'] as const)(
  'loaded refetchAll superseded by actual %s mutation preserves save without error toast',
  async (slice) => {
    vi.stubEnv('VITE_DEMO_MODE', 'false')
    vi.stubEnv('VITE_BUILDING_MOVE_REFRESH_ENABLED', 'true')
    vi.stubEnv('VITE_CALENDAR_EVENT_REFRESH_ENABLED', 'true')
    localStorage.setItem('auth_token', 'test')
    state.rpc.mockResolvedValue({ data: { ok: true }, error: null })
    creationCards.enabled = true
    creationCards.ids = [1, 2]
    buildingResponses.push(Promise.resolve({ data: rawMoveBuildings(1, 'before'), error: null }))
    calendarResponses.push(Promise.resolve({ data: rawEvents, error: null }))
    const { result } = renderHook(() => useStore(false))
    await act(async () => { await result.current.refetchAll() })
    toast.mockClear()
    const responses = slice === 'buildings' ? buildingResponses : calendarResponses
    let release!: (value: { data: Record<string, unknown>[]; error: null }) => void
    responses.push(new Promise(resolve => { release = resolve }))
    let older!: Promise<unknown>
    act(() => { older = result.current.refetchAll().then(() => null, error => error) })
    await waitFor(() => expect(responses).toHaveLength(0))
    responses.push(Promise.resolve({
      data: slice === 'buildings' ? rawMoveBuildings(2, 'saved')
        : rawEvents.map(e => e.id === 1 ? { ...e, title: 'saved' } : e),
      error: null,
    }))
    await act(async () => {
      const saved = slice === 'buildings'
        ? await result.current.moveBuildingToCard(1, 2)
        : await result.current.updateCalendarEvent(1, eventInput, false)
      expect(saved).toBe(true)
    })
    await act(async () => {
      release({ data: slice === 'buildings' ? rawMoveBuildings(1, 'stale') : rawEvents, error: null })
      expect(await older).toEqual(expect.objectContaining({
        message: slice === 'buildings' ? 'Building read superseded' : 'Calendar read superseded',
      }))
    })
    if (slice === 'buildings') {
      expect(result.current.buildings.find(b => b.id === 1)).toMatchObject({ cardId: 2, name: 'saved' })
      expect(result.current.cards.map(c => [c.id, c.buildings, c.units])).toEqual([[1, 0, 0], [2, 2, 2]])
    } else {
      expect(result.current.calendarEvents.find(e => e.id === 1)?.title).toBe('saved')
    }
    expect(result.current.error).toBeNull()
    expect(toast.mock.calls.filter(([, kind]) => kind === 'error')).toEqual([])
  },
)

test.each(fullReadNotificationCases)(
  'superseded refetchAll reports only incomplete initial loads: $slice flag=$flag loaded=$loaded',
  async ({ slice, flag, loaded }) => {
    vi.stubEnv('VITE_DEMO_MODE', 'false')
    vi.stubEnv('VITE_BUILDING_MOVE_REFRESH_ENABLED', slice === 'buildings' ? flag : 'false')
    vi.stubEnv('VITE_CALENDAR_EVENT_REFRESH_ENABLED', slice === 'calendar' ? flag : 'false')
    const { result } = renderHook(() => useStore(false))
    if (loaded) await act(async () => { await result.current.refetchAll() })
    toast.mockClear()
    const responses = slice === 'buildings' ? buildingResponses : calendarResponses
    let release!: (value: { data: Record<string, unknown>[]; error: null }) => void
    responses.push(new Promise(resolve => { release = resolve }))
    let older!: Promise<unknown>
    act(() => { older = result.current.refetchAll().then(() => null, error => error) })
    await waitFor(() => expect(responses).toHaveLength(0))
    await act(async () => { await result.current.refetchSlices([slice]) })
    let outcome: unknown
    await act(async () => {
      release({ data: [], error: null })
      outcome = await older
    })
    if (flag === 'true') {
      expect(outcome).toEqual(expect.objectContaining({
        message: slice === 'buildings' ? 'Building read superseded' : 'Calendar read superseded',
      }))
    } else {
      expect(outcome).toBeNull()
    }
    if (flag === 'true' && !loaded) {
      expect(result.current.error).toEqual(expect.any(String))
    } else {
      expect(result.current.error).toBeNull()
    }
    expect(toast).not.toHaveBeenCalled()
  },
)

test.each(fullReadNotificationCases)(
  'refetchAll still reports genuine network failure: $slice flag=$flag loaded=$loaded',
  async ({ slice, flag, loaded }) => {
    vi.stubEnv('VITE_DEMO_MODE', 'false')
    vi.stubEnv('VITE_BUILDING_MOVE_REFRESH_ENABLED', slice === 'buildings' ? flag : 'false')
    vi.stubEnv('VITE_CALENDAR_EVENT_REFRESH_ENABLED', slice === 'calendar' ? flag : 'false')
    const { result } = renderHook(() => useStore(false))
    if (loaded) await act(async () => { await result.current.refetchAll() })
    toast.mockClear()
    const responses = slice === 'buildings' ? buildingResponses : calendarResponses
    responses.push(Promise.resolve({ data: [], error: new Error('network unavailable') }))
    await act(async () => { await expect(result.current.refetchAll()).rejects.toThrow() })
    if (loaded) {
      expect(result.current.error).toBeNull()
      expect(toast).toHaveBeenCalledExactlyOnceWith(expect.any(String), 'error')
    } else {
      expect(result.current.error).toEqual(expect.any(String))
      expect(toast).not.toHaveBeenCalled()
    }
  },
)

test.each((['calendar', 'buildings'] as const).flatMap(slice =>
  ([['true', 'false'], ['false', undefined]] as const).map(([demo, flag]) => ({ slice, demo, flag }))))(
  '$slice full-read guard remains off with demo=$demo explicit=$flag', async ({ slice, demo, flag }) => {
    vi.stubEnv('VITE_DEMO_MODE', demo)
    vi.stubEnv('VITE_CALENDAR_EVENT_REFRESH_ENABLED', slice === 'calendar' ? flag : 'true')
    vi.stubEnv('VITE_BUILDING_MOVE_REFRESH_ENABLED', slice === 'buildings' ? flag : 'true')
    const responses = slice === 'calendar' ? calendarResponses : buildingResponses
    let release!: (value: { data: Record<string, unknown>[]; error: null }) => void
    responses.push(new Promise(resolve => { release = resolve }))
    const { result } = renderHook(() => useStore(false))
    let older!: Promise<unknown>
    act(() => { older = result.current.refetchSlices([slice]).then(() => null, error => error) })
    await waitFor(() => expect(responses).toHaveLength(0))
    responses.push(Promise.resolve({ data: [], error: null }))
    await act(async () => { await result.current.refetchSlices([slice]) })
    await act(async () => {
      release({ data: [], error: null })
      expect(await older).toBeNull()
    })
  },
)

test.each(['event_card_assignments', 'event_card_assignment_cards'].flatMap(table =>
  ['true', 'false'].map(demo => ({ table, demo }))))('incomplete calendar from $table forces broad recovery (demo=$demo)', async ({ table, demo }) => {
  vi.stubEnv('VITE_DEMO_MODE', demo)
  vi.stubEnv('VITE_CALENDAR_EVENT_REFRESH_ENABLED', demo === 'true' ? undefined : 'true')
  localStorage.setItem('auth_token', 'test')
  state.rpc.mockResolvedValue({ data: { ok: true }, error: null })
  calendarAssignmentState.rows = {
    event_card_assignments: [{ id: 1, event_id: 2, user_name: 'B', assigned_card_id: 10 }],
    event_card_assignment_cards: [{ id: 2, event_id: 2, user_name: 'B', card_id: 11 }],
  }
  calendarAssignmentState.failedTable = table
  const { result } = renderHook(() => useStore(false))
  calendarResponses.push(Promise.resolve({ data: rawEvents, error: null }))
  await act(async () => { await result.current.refetchSlices(['calendar']) })
  expect(result.current.calendarEvents.find(e => e.id === 1)).toBeDefined()
  expect(result.current.calendarEvents.find(e => e.id === 2)?.cardAssignments[0]?.assignedCardId).not.toBe(11)
  calendarAssignmentState.failedTable = ''
  calendarResponses.push(Promise.resolve({
    data: rawEvents.map(e => e.id === 1 ? { ...e, title: 'recovered' } : e), error: null,
  }))
  // A working narrow reader must still be bypassed when another event is incomplete.
  updatedEvent.mockResolvedValue({ ...result.current.calendarEvents.find(e => e.id === 1)!, title: 'narrow' })
  state.reads = []
  await act(async () => { expect(await result.current.updateCalendarEvent(1, eventInput, false)).toBe(true) })
  expect(updatedEvent).not.toHaveBeenCalled()
  expect(state.reads).toEqual(['calendar_events', 'event_card_assignments', 'event_card_assignment_cards'])
  expect(result.current.calendarEvents.find(e => e.id === 1)?.title).toBe('recovered')
  expect(result.current.calendarEvents.find(e => e.id === 2)).toMatchObject({
    title: 'history', applicants: ['B'], cardAssignments: [{ assignedCardId: 11, assignedCardIds: [11] }],
  })
  await act(async () => { expect(await result.current.updateCalendarEvent(1, eventInput, false)).toBe(true) })
  expect(updatedEvent).toHaveBeenCalledExactlyOnceWith(1)
})

test.each(calendarMoveFlagCases)('single event edit honors demo=%s explicit=%s and preserves historical participants', async (demo, flag, enabled) => {
  vi.stubEnv('VITE_DEMO_MODE', demo)
  vi.stubEnv('VITE_CALENDAR_EVENT_REFRESH_ENABLED', flag)
  vi.stubEnv('VITE_BUILDING_MOVE_REFRESH_ENABLED', enabled ? 'false' : 'true')
  localStorage.setItem('auth_token', 'test')
  state.rpc.mockResolvedValue({ data: { ok: true }, error: null })
  const { result } = renderHook(() => useStore(false))
  calendarResponses.push(Promise.resolve({ data: rawEvents, error: null }))
  await act(async () => { await result.current.refetchSlices(['calendar']) })
  const original = result.current.calendarEvents.find(e => e.id === 2)
  updatedEvent.mockResolvedValue({ ...result.current.calendarEvents[0], time: '11:00', title: 'edited', applicants: ['A', 'C'] })
  calendarResponses.push(Promise.resolve({ data: rawEvents.map(e => e.id === 1 ? { ...e, title: 'edited' } : e), error: null }))
  state.reads = []
  await act(async () => { expect(await result.current.updateCalendarEvent(1, eventInput, false)).toBe(true) })
  expect(updatedEvent).toHaveBeenCalledTimes(enabled ? 1 : 0)
  expect(state.reads.includes('calendar_events')).toBe(!enabled)
  expect(result.current.calendarEvents.find(e => e.id === 2)).toEqual(original)
  expect(result.current.calendarEvents.find(e => e.id === 1)?.title).toBe('edited')
})

test.each(['true', 'false'])('newer failed full calendar read cannot turn a targeted edit into false success (demo=%s)', async (demo) => {
  vi.stubEnv('VITE_DEMO_MODE', demo)
  vi.stubEnv('VITE_CALENDAR_EVENT_REFRESH_ENABLED', demo === 'true' ? undefined : 'true')
  vi.stubEnv('VITE_BUILDING_MOVE_REFRESH_ENABLED', 'false')
  localStorage.setItem('auth_token', 'test')
  state.rpc.mockResolvedValue({ data: { ok: true }, error: null })
  const { result } = renderHook(() => useStore(false))
  calendarResponses.push(Promise.resolve({ data: rawEvents, error: null }))
  await act(async () => { await result.current.refetchSlices(['calendar']) })
  let release!: (event: typeof result.current.calendarEvents[number]) => void
  updatedEvent.mockReturnValue(new Promise(resolve => { release = resolve }))
  let saved!: Promise<boolean>
  act(() => { saved = result.current.updateCalendarEvent(1, eventInput, false) })
  await waitFor(() => expect(updatedEvent).toHaveBeenCalledOnce())
  calendarResponses.push(Promise.resolve({ data: [], error: new Error('offline') }))
  await act(async () => { await expect(result.current.refetchSlices(['calendar'])).rejects.toThrow() })
  calendarResponses.push(Promise.resolve({ data: rawEvents.map(e => ({ ...e, title: 'recovered' })), error: null }))
  await act(async () => {
    release({ ...result.current.calendarEvents[0], title: 'edited' })
    expect(await saved).toBe(true)
  })
  expect(result.current.calendarEvents.every(e => e.title === 'recovered')).toBe(true)
})

test.each(calendarMoveFlagCases)('building card movement honors demo=%s explicit=%s', async (demo, flag, enabled) => {
  vi.stubEnv('VITE_DEMO_MODE', demo)
  vi.stubEnv('VITE_BUILDING_MOVE_REFRESH_ENABLED', flag)
  vi.stubEnv('VITE_CALENDAR_EVENT_REFRESH_ENABLED', enabled ? 'false' : 'true')
  const { result } = renderHook(() => useStore(false))
  const moved = testBuilding(1, 2, 'moved')
  state.changed.mockResolvedValue({ buildings: [moved], histories: [] })
  await act(async () => { expect(await result.current.moveBuildingToCard(1, 2)).toBe(true) })
  expect(state.changed).toHaveBeenCalledTimes(enabled ? 1 : 0)
  expect(state.reads.includes('cards')).toBe(!enabled)
  if (enabled) expect(result.current.buildings[0].cardId).toBe(2)
})

test.each(['true', 'false'])('moving a building recomputes both card totals and preserves other buildings (demo=%s)', async (demo) => {
  vi.stubEnv('VITE_DEMO_MODE', demo)
  vi.stubEnv('VITE_BUILDING_MOVE_REFRESH_ENABLED', demo === 'true' ? undefined : 'true')
  const { result } = renderHook(() => useStore(false))
  const source = testBuilding(1, 1, 'source')
  const other = testBuilding(2, 2, 'other')
  state.changed.mockResolvedValueOnce({ buildings: [source, other], histories: [] })
  await act(async () => { await result.current.syncChangedBuildings([1, 2]) })
  creationCards.enabled = true
  creationCards.ids = [1, 2]
  await act(async () => { await result.current.refetchSlices(['cards']) })
  expect(result.current.cards.map(c => c.buildings)).toEqual([1, 1])
  state.changed.mockResolvedValueOnce({ buildings: [{ ...source, cardId: 2 }], histories: [] })
  state.reads = []
  await act(async () => { await result.current.moveBuildingToCard(1, 2) })
  expect(result.current.cards.map(c => [c.id, c.buildings, c.units])).toEqual([[1, 0, 0], [2, 2, 2]])
  expect(result.current.buildings.find(b => b.id === 2)).toEqual(other)
  expect(state.reads).toEqual(['buildings'])
})

test.each([1, 2])('production card totals use the same snapshot after %s queued building changes', async (changes) => {
  vi.stubEnv('VITE_DEMO_MODE', 'false')
  const { result } = renderHook(() => {
    const [tick, setTick] = useState(0)
    const store = useStore(false)
    return { store, tick, setTick }
  })
  const first = testBuilding(1, 1, 'first')
  const second = testBuilding(2, 2, 'second')
  const untouched = testBuilding(3, 2, 'untouched')
  state.changed.mockResolvedValueOnce({ buildings: [first, second, untouched], histories: [] })
  await act(async () => { await result.current.store.syncChangedBuildings([1, 2, 3]) })
  creationCards.enabled = true
  creationCards.ids = [1, 2]
  await act(async () => { await result.current.store.refetchSlices(['cards']) })
  expect(result.current.store.cards.map(c => [c.id, c.buildings, c.units])).toEqual([[1, 1, 1], [2, 2, 2]])
  state.reads = []

  act(() => {
    // Pending work prevents React's eager updater path from hiding stale ref reads.
    result.current.setTick(tick => tick + 1)
    for (const building of [first, second].slice(0, changes)) {
      result.current.store.applyPlaceDeletionSignal({
        targetType: 'building', buildingId: building.id, unitId: null,
        unitIds: building.units.map(unit => unit.id), returnVisitIds: [],
      })
    }
  })

  expect(result.current.tick).toBe(1)
  expect(result.current.store.buildings).toEqual(changes === 1 ? [second, untouched] : [untouched])
  expect(result.current.store.cards.map(c => [c.id, c.buildings, c.units]))
    .toEqual([[1, 0, 0], [2, 3 - changes, 3 - changes]])
  expect(state.reads).toEqual([])
})

const rawMoveBuildings = (cardId: number, name: string) => [
  { id: 1, card_id: cardId, name, address: 'test', type: '주택', lat: 37, lng: 127, warning: false, memo: null,
    units: [{ id: 101, building_id: 1, number: '101', status: '미방문', is_chinese: false, memo: null, regular_visits: [] }] },
  { id: 2, card_id: 2, name: 'other', address: 'test', type: '주택', lat: 37, lng: 127, warning: false, memo: null,
    units: [{ id: 201, building_id: 2, number: '101', status: '미방문', is_chinese: false, memo: null, regular_visits: [] }] },
]

test.each(['preexisting', 'during-target'].flatMap(overlap =>
  ['true', 'false'].map(demo => ({ overlap, demo }))))('building move recovers over a $overlap full read (demo=$demo)', async ({ overlap, demo }) => {
  vi.stubEnv('VITE_DEMO_MODE', demo)
  vi.stubEnv('VITE_BUILDING_MOVE_REFRESH_ENABLED', demo === 'true' ? undefined : 'true')
  vi.stubEnv('VITE_CALENDAR_EVENT_REFRESH_ENABLED', 'false')
  creationCards.enabled = true
  creationCards.ids = [1, 2]
  const { result } = renderHook(() => useStore(false))
  buildingResponses.push(Promise.resolve({ data: rawMoveBuildings(1, 'before'), error: null }))
  await act(async () => { await result.current.refetchSlices(['buildings', 'cards']) })
  expect(result.current.cards.map(c => [c.buildings, c.units])).toEqual([[1, 1], [1, 1]])
  const other = result.current.buildings.find(b => b.id === 2)

  let releaseTarget!: (value: { buildings: ReturnType<typeof testBuilding>[]; histories: [] }) => void
  state.changed.mockReturnValue(new Promise(resolve => { releaseTarget = resolve }))
  let saved!: Promise<boolean>
  if (overlap === 'during-target') {
    act(() => { saved = result.current.moveBuildingToCard(1, 2) })
    await waitFor(() => expect(state.changed).toHaveBeenCalledOnce())
  }

  let releaseFull!: (value: { data: Record<string, unknown>[]; error: null }) => void
  buildingResponses.push(new Promise(resolve => { releaseFull = resolve }))
  let oldFull!: Promise<unknown>
  act(() => {
    oldFull = result.current.refetchSlices(['buildings', 'cards']).then(() => null, error => error)
  })
  await waitFor(() => expect(buildingResponses).toHaveLength(0))
  buildingResponses.push(Promise.resolve({ data: rawMoveBuildings(2, 'recovered'), error: null }))
  await act(async () => {
    if (overlap === 'preexisting') saved = result.current.moveBuildingToCard(1, 2)
    else releaseTarget({ buildings: [testBuilding(1, 2, 'targeted')], histories: [] })
    expect(await saved).toBe(true)
  })
  expect(state.changed).toHaveBeenCalledTimes(overlap === 'preexisting' ? 0 : 1)
  expect(result.current.buildings.find(b => b.id === 1)?.name).toBe('recovered')
  expect(result.current.cards.map(c => [c.id, c.buildings, c.units])).toEqual([[1, 0, 0], [2, 2, 2]])
  await act(async () => {
    releaseFull({ data: rawMoveBuildings(1, 'stale'), error: null })
    expect(await oldFull).toEqual(expect.objectContaining({ message: 'Building read superseded' }))
  })
  expect(result.current.buildings.find(b => b.id === 1)).toMatchObject({ cardId: 2, name: 'recovered' })
  expect(result.current.buildings.find(b => b.id === 2)).toEqual(other)
  expect(result.current.cards.map(c => [c.id, c.buildings, c.units])).toEqual([[1, 0, 0], [2, 2, 2]])
})

test.each(['true', 'false'])('building move recovers when a superseding targeted read fails (demo=%s)', async (demo) => {
  vi.stubEnv('VITE_DEMO_MODE', demo)
  vi.stubEnv('VITE_BUILDING_MOVE_REFRESH_ENABLED', demo === 'true' ? undefined : 'true')
  vi.stubEnv('VITE_CALENDAR_EVENT_REFRESH_ENABLED', 'false')
  creationCards.enabled = true
  creationCards.ids = [1, 2]
  const { result } = renderHook(() => useStore(false))
  buildingResponses.push(Promise.resolve({ data: rawMoveBuildings(1, 'before'), error: null }))
  await act(async () => { await result.current.refetchSlices(['buildings', 'cards']) })
  let release!: (value: { buildings: ReturnType<typeof testBuilding>[]; histories: [] }) => void
  state.changed.mockReturnValueOnce(new Promise(resolve => { release = resolve }))
  let saved!: Promise<boolean>
  act(() => { saved = result.current.moveBuildingToCard(1, 2) })
  await waitFor(() => expect(state.changed).toHaveBeenCalledOnce())
  state.changed.mockRejectedValueOnce(new Error('newer targeted read failed'))
  await act(async () => {
    await expect(result.current.syncChangedBuildings([1])).rejects.toThrow('newer targeted read failed')
  })
  buildingResponses.push(Promise.resolve({ data: rawMoveBuildings(2, 'recovered'), error: null }))
  await act(async () => {
    release({ buildings: [testBuilding(1, 2, 'targeted')], histories: [] })
    expect(await saved).toBe(true)
  })
  expect(buildingResponses).toHaveLength(0)
  expect(result.current.buildings.find(b => b.id === 1)).toMatchObject({ cardId: 2, name: 'recovered' })
  expect(result.current.buildings.find(b => b.id === 2)?.name).toBe('other')
  expect(result.current.cards.map(c => [c.id, c.buildings, c.units])).toEqual([[1, 0, 0], [2, 2, 2]])
})

test.each(['true', 'false'])('old full calendar read finishing after edit fallback cannot restore stale events (demo=%s)', async (demo) => {
  vi.stubEnv('VITE_DEMO_MODE', demo)
  vi.stubEnv('VITE_CALENDAR_EVENT_REFRESH_ENABLED', demo === 'true' ? undefined : 'true')
  vi.stubEnv('VITE_BUILDING_MOVE_REFRESH_ENABLED', 'false')
  localStorage.setItem('auth_token', 'test')
  state.rpc.mockResolvedValue({ data: { ok: true }, error: null })
  const { result } = renderHook(() => useStore(false))
  calendarResponses.push(Promise.resolve({ data: rawEvents, error: null }))
  await act(async () => { await result.current.refetchSlices(['calendar']) })
  const history = result.current.calendarEvents.find(e => e.id === 2)
  let release!: (value: { data: Record<string, unknown>[]; error: null }) => void
  calendarResponses.push(new Promise(resolve => { release = resolve }))
  let oldFull!: Promise<unknown>
  act(() => {
    oldFull = result.current.refetchSlices(['calendar']).then(() => null, error => error)
  })
  await waitFor(() => expect(calendarResponses).toHaveLength(0))
  calendarResponses.push(Promise.resolve({
    data: rawEvents.map(e => e.id === 1 ? { ...e, title: 'recovered', time: '11:00' } : e), error: null,
  }))
  await act(async () => { expect(await result.current.updateCalendarEvent(1, eventInput, false)).toBe(true) })
  expect(updatedEvent).not.toHaveBeenCalled()
  expect(result.current.calendarEvents.find(e => e.id === 1)?.title).toBe('recovered')
  await act(async () => {
    release({ data: rawEvents, error: null })
    expect(await oldFull).toEqual(expect.objectContaining({ message: 'Calendar read superseded' }))
  })
  expect(result.current.calendarEvents.find(e => e.id === 1)).toMatchObject({ title: 'recovered', time: '11:00' })
  expect(result.current.calendarEvents.find(e => e.id === 2)).toEqual(history)
})

test.each(['true', 'false'])('group creation reads only groups in demo=%s', async (demo) => {
  vi.stubEnv('VITE_DEMO_MODE', demo)
  const { result } = renderHook(() => useStore(false))
  groupResponses.push(Promise.resolve({ data: [{ id: 7, name: 'created', position: 0 }], error: null }))
  await act(async () => { expect(await result.current.createInformalGroup({ name: 'created', createdBy: 'test' })).toBe(7) })
  expect(result.current.informalGroups[0].name).toBe('created')
  expect(state.reads.includes('informal_assets')).toBe(demo !== 'true')
  expect(state.reads.includes('event_informal_assignments')).toBe(demo !== 'true')
  expect(state.reads.includes('event_restaurant_assignments')).toBe(demo !== 'true')
})

test.each(['true', 'false'])('bulk group movement reads catalog without assignments in demo=%s', async (demo) => {
  vi.stubEnv('VITE_DEMO_MODE', demo)
  const { result } = renderHook(() => useStore(false))
  assetResponses.push(Promise.resolve({ data: [{ id: 11, name: 'moved', group_id: 7 }, { id: 12, name: 'other', group_id: 8 }], error: null }))
  groupResponses.push(Promise.resolve({ data: [{ id: 7, name: 'target' }, { id: 8, name: 'other' }], error: null }))
  await act(async () => { expect(await result.current.moveAssetsToGroup([11], 7)).toEqual({ failed: [] }) })
  expect(result.current.informalAssets.map(a => [a.id, a.groupId])).toEqual([[11, 7], [12, 8]])
  expect(state.reads.filter(t => t === 'informal_groups')).toHaveLength(1)
  expect(state.reads.includes('event_informal_assignments')).toBe(demo !== 'true')
  expect(state.reads.includes('event_restaurant_assignments')).toBe(demo !== 'true')
})

test.each(['resources', 'informalAssets'] as const)('late %s cannot undo a moved asset', async (slice) => {
  vi.stubEnv('VITE_DEMO_MODE', 'true')
  let release!: (value: { data: Record<string, unknown>[]; error: null }) => void
  assetResponses.push(new Promise(resolve => { release = resolve }))
  const { result } = renderHook(() => useStore(false))
  let pending!: Promise<void>
  act(() => { pending = result.current.refetchSlices([slice]).catch(() => undefined) })
  await waitFor(() => expect(assetResponses).toHaveLength(0))
  assetResponses.push(Promise.resolve({ data: [{ id: 11, name: 'moved', group_id: 7 }], error: null }))
  await act(async () => { expect(await result.current.moveAssetToGroup(11, 7)).toBe(true) })
  await act(async () => {
    release({ data: [{ id: 11, name: 'moved', group_id: 1 }], error: null })
    await pending
  })
  expect(result.current.informalAssets[0].groupId).toBe(7)
})

test('failed narrow and strict asset refresh preserves prior catalog', async () => {
  vi.stubEnv('VITE_DEMO_MODE', 'true')
  const { result } = renderHook(() => useStore(false))
  assetResponses.push(Promise.resolve({ data: [{ id: 11, name: 'old', group_id: 1 }], error: null }))
  await act(async () => { await result.current.refetchSlices(['informalAssets']) })
  assetResponses.push(...Array.from({ length: 2 }, () => Promise.resolve({ data: [], error: new Error('offline') })))
  await act(async () => { expect(await result.current.moveAssetToGroup(11, 7)).toBe(false) })
  expect(result.current.informalAssets[0].groupId).toBe(1)
})

test('superseding failed background read triggers post-move recovery', async () => {
  vi.stubEnv('VITE_DEMO_MODE', 'true')
  const { result } = renderHook(() => useStore(false))
  let release!: (value: { data: Record<string, unknown>[]; error: null }) => void
  assetResponses.push(new Promise(resolve => { release = resolve }))
  let moved!: Promise<boolean>
  act(() => { moved = result.current.moveAssetToGroup(11, 7) })
  await waitFor(() => expect(assetResponses).toHaveLength(0))
  assetResponses.push(Promise.resolve({ data: [], error: new Error('offline') }))
  await act(async () => { await result.current.refetchSlices(['resources']) })
  assetResponses.push(Promise.resolve({ data: [{ id: 11, name: 'moved', group_id: 7 }], error: null }))
  await act(async () => {
    release({ data: [{ id: 11, name: 'moved', group_id: 7 }], error: null })
    expect(await moved).toBe(true)
  })
  expect(result.current.informalAssets[0].groupId).toBe(7)
  expect(state.reads.filter(t => t === 'event_restaurant_assignments')).toHaveLength(2)
})

test('superseding failed background group read triggers create recovery', async () => {
  vi.stubEnv('VITE_DEMO_MODE', 'true')
  const { result } = renderHook(() => useStore(false))
  let release!: (value: { data: Record<string, unknown>[]; error: null }) => void
  groupResponses.push(new Promise(resolve => { release = resolve }))
  let created!: Promise<number | null>
  act(() => { created = result.current.createInformalGroup({ name: 'created', createdBy: 'test' }) })
  await waitFor(() => expect(groupResponses).toHaveLength(0))
  groupResponses.push(Promise.resolve({ data: [], error: new Error('offline') }))
  await act(async () => { await expect(result.current.refetchSlices(['resources'])).rejects.toThrow() })
  groupResponses.push(Promise.resolve({ data: [{ id: 7, name: 'created' }], error: null }))
  await act(async () => {
    release({ data: [{ id: 7, name: 'created' }], error: null })
    expect(await created).toBe(7)
  })
  expect(result.current.informalGroups[0].name).toBe('created')
  expect(state.reads.filter(t => t === 'event_restaurant_assignments')).toHaveLength(2)
})

test.each(['resources', 'informalGroups'] as const)('late %s read cannot undo renamed group', async (slice) => {
  vi.stubEnv('VITE_DEMO_MODE', 'true')
  let release!: (value: { data: Record<string, unknown>[]; error: null }) => void
  groupResponses.push(new Promise(resolve => { release = resolve }))
  const { result } = renderHook(() => useStore(false))
  let pending!: Promise<void>
  act(() => { pending = result.current.refetchSlices([slice]).catch(() => undefined) })
  await waitFor(() => expect(groupResponses).toHaveLength(0))
  groupResponses.push(Promise.resolve({ data: [{ id: 7, name: 'new', position: 0 }], error: null }))
  await act(async () => { await result.current.renameInformalGroup(7, 'new') })
  await act(async () => {
    release({ data: [{ id: 7, name: 'old', position: 0 }], error: null })
    await pending
  })
  expect(result.current.informalGroups[0].name).toBe('new')
})

test.each(['true', 'false'])('group read failure preserves snapshot after fallback also fails (demo=%s)', async (demo) => {
  vi.stubEnv('VITE_DEMO_MODE', demo)
  vi.stubEnv('VITE_INFORMAL_GROUP_REFRESH_ENABLED', 'true')
  const { result } = renderHook(() => useStore(false))
  groupResponses.push(Promise.resolve({ data: [{ id: 7, name: 'old', position: 0 }], error: null }))
  await act(async () => { await result.current.refetchSlices(['informalGroups']) })
  groupResponses.push(...Array.from({ length: 2 }, () => Promise.resolve({ data: [], error: new Error('offline') })))
  await act(async () => { expect(await result.current.renameInformalGroup(7, 'new')).toBe(false) })
  expect(result.current.informalGroups[0].name).toBe('old')
})

test('non-demo startup keeps the existing nonfatal groups-read failure behavior', async () => {
  vi.stubEnv('VITE_DEMO_MODE', 'false')
  vi.stubEnv('VITE_INFORMAL_GROUP_REFRESH_ENABLED', 'true')
  groupResponses.push(Promise.resolve({ data: [], error: new Error('offline') }))
  const { result } = renderHook(() => useStore(true))
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.error).toBeNull()
  expect(result.current.informalGroups).toEqual([])
})

const smallRefreshCases = [
  [undefined, undefined, false], ['true', undefined, true], ['false', undefined, false],
  ['false', 'true', true], ['true', 'false', false], ['false', 'false', false],
] as const

test.each(smallRefreshCases)('Chinese refresh honors demo=%s explicit=%s', async (demo, flag, enabled) => {
  vi.stubEnv('VITE_DEMO_MODE', demo)
  vi.stubEnv('VITE_CHINESE_FLAG_REFRESH_ENABLED', flag)
  vi.stubEnv('VITE_INFORMAL_GROUP_REFRESH_ENABLED', enabled ? 'false' : 'true')
  const { result } = renderHook(() => useStore(false))
  const building = testBuilding(1, 1, 'edited'), other = testBuilding(2, 2, 'other')
  state.changed.mockResolvedValueOnce({ buildings: [building, other], histories: [] })
  await act(async () => { await result.current.syncChangedBuildings([1, 2]) })
  state.changed.mockClear()
  const updated = { ...building, units: building.units.map(u => ({ ...u, isChinese: true })) }
  state.changed.mockResolvedValueOnce({ buildings: [updated], histories: [] })
  await act(async () => { await result.current.toggleChinese(1, 101) })
  expect(state.reads.includes('return_visits')).toBe(!enabled)
  expect(state.reads.includes('buildings')).toBe(!enabled)
  if (enabled) {
    expect(state.changed).toHaveBeenCalledWith([1])
    expect(result.current.buildings).toEqual([updated, other])
  }
})

test.each(smallRefreshCases)('group rename honors demo=%s explicit=%s', async (demo, flag, enabled) => {
  vi.stubEnv('VITE_DEMO_MODE', demo)
  vi.stubEnv('VITE_INFORMAL_GROUP_REFRESH_ENABLED', flag)
  vi.stubEnv('VITE_CHINESE_FLAG_REFRESH_ENABLED', enabled ? 'false' : 'true')
  const { result } = renderHook(() => useStore(false))
  await act(async () => { expect(await result.current.renameInformalGroup(7, 'renamed')).toBe(true) })
  expect(state.reads.filter(t => t === 'informal_groups')).toHaveLength(2)
  expect(state.reads.includes('informal_assets')).toBe(!enabled)
  expect(state.reads.includes('event_restaurant_assignments')).toBe(!enabled)
  expect(state.reads.includes('event_informal_assignments')).toBe(!enabled)
})

test('production group rename recovers through fresh resources after a narrow read failure', async () => {
  vi.stubEnv('VITE_DEMO_MODE', 'false')
  vi.stubEnv('VITE_INFORMAL_GROUP_REFRESH_ENABLED', 'true')
  const { result } = renderHook(() => useStore(false))
  groupResponses.push(
    Promise.resolve({ data: [], error: new Error('offline') }),
    Promise.resolve({ data: [{ id: 7, name: 'new', position: 0 }], error: null }),
  )
  await act(async () => { expect(await result.current.renameInformalGroup(7, 'new')).toBe(true) })
  expect(result.current.informalGroups[0].name).toBe('new')
  expect(state.reads).toContain('informal_assets')
})

test.each(['returnVisits', 'returnVisitDetails'] as const)('late %s read cannot undo a saved address', async (slice) => {
  vi.stubEnv('VITE_RETURN_VISIT_ADDRESS_REFRESH_ENABLED', 'true')
  let release!: (value: { data: Record<string, unknown>[]; error: null }) => void
  returnResponses.push(new Promise(resolve => { release = resolve }))
  const { result } = renderHook(() => useStore(false))
  let pending!: Promise<void>
  act(() => { pending = result.current.refetchSlices([slice]) })
  await waitFor(() => expect(returnResponses).toHaveLength(0))
  returnResponses.push(Promise.resolve({ data: [{ id: 7, address: 'new address' }], error: null }))
  await act(async () => { expect(await result.current.updateReturnVisitAddress(7, 'new address')).toBe(true) })
  expect(result.current.returnVisits[0].address).toBe('new address')
  await act(async () => {
    release({ data: [{ id: 7, address: 'old address' }], error: null })
    await pending
  })
  expect(result.current.returnVisits[0].address).toBe('new address')
})

test.each([
  ['true', undefined, true], ['false', undefined, false],
  ['false', 'true', true], ['true', 'false', false], ['false', 'false', false],
] as const)('return visit reads honor demo=%s explicit=%s', async (demo, flag, enabled) => {
  vi.stubEnv('VITE_DEMO_MODE', demo)
  vi.stubEnv('VITE_LAZY_RETURN_VISIT_LOGS_ENABLED', flag)
  const { result } = renderHook(() => useStore(true))
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(logColumns).toEqual([enabled ? 'id,return_visit_id,visited_at' : '*'])
  await act(async () => { await result.current.refetchSlices(['returnVisitDetails']) })
  expect(logColumns).toEqual(Array(2).fill(enabled ? 'id,return_visit_id,visited_at' : '*'))
})

test('building survey save updates its snapshot without global building or card reads', async () => {
  const { result } = renderHook(() => useStore(false))
  const building = testBuilding(1, 1, 'edited')
  const other = testBuilding(2, 2, 'unchanged')
  state.changed.mockResolvedValueOnce({ buildings: [building, other], histories: [] })
  await act(async () => { await result.current.syncChangedBuildings([1, 2]) })
  const updated = { ...building, unitsSurveyed: true }
  state.changed.mockResolvedValueOnce({ buildings: [updated], histories: [] })
  await act(async () => { await result.current.setUnitsSurveyed(1, true) })
  expect(state.changed).toHaveBeenLastCalledWith([1])
  expect(result.current.buildings).toEqual([updated, other])
  // One buildings request is the UPDATE, not a global list refresh.
  expect(state.reads.filter((table) => table === 'buildings')).toHaveLength(1)
  expect(state.reads).not.toContain('cards')
})

const refreshFlagCases = [
  ['true', undefined, true], ['false', undefined, false],
  ['false', 'true', true], ['true', 'false', false], ['false', 'false', false],
] as const

test.each(refreshFlagCases)('address save honors full-store demo=%s explicit=%s', async (demo, flag, enabled) => {
  vi.stubEnv('VITE_DEMO_MODE', demo)
  vi.stubEnv('VITE_RETURN_VISIT_ADDRESS_REFRESH_ENABLED', flag)
  vi.stubEnv('VITE_BUILDING_CREATE_REFRESH_ENABLED', enabled ? 'false' : 'true')
  const { result } = renderHook(() => useStore(false))
  await act(async () => { await result.current.updateReturnVisitAddress(7, 'new address') })
  expect(state.reads).toContain('return_visits')
  expect(state.reads).toContain('return_visit_logs')
  expect(state.reads.includes('buildings')).toBe(!enabled)
})

test.each(refreshFlagCases.flatMap(([demo, flag, enabled]) =>
  (['created', 'existing'] as const).map(action => ({ demo, flag, enabled, action }))))(
  'placement honors demo=$demo explicit=$flag action=$action', async ({ demo, flag, enabled, action }) => {
  vi.stubEnv('VITE_DEMO_MODE', demo)
  vi.stubEnv('VITE_BUILDING_CREATE_REFRESH_ENABLED', flag)
  vi.stubEnv('VITE_RETURN_VISIT_ADDRESS_REFRESH_ENABLED', enabled ? 'false' : 'true')
  localStorage.setItem('auth_token', 'test-token')
  const { result } = renderHook(() => useStore(false))
  creationCards.enabled = true
  await act(async () => { await result.current.refetchSlices(['cards']) })
  state.reads = []
  const other = testBuilding(2, 1, 'other')
  state.changed.mockResolvedValueOnce({ buildings: [other], histories: [] })
  await act(async () => { await result.current.syncChangedBuildings([2]) })
  state.rpc.mockResolvedValueOnce({ data: { ok: true, action, building_id: 9 }, error: null })
  const added = testBuilding(9, 1, 'new')
  state.changed.mockResolvedValueOnce({ buildings: [added], histories: [] })
  await act(async () => {
    expect(await result.current.createBuildingForPlacement({ cardId: 1, name: 'new', address: 'new', type: '주택', lat: 37, lng: 127 }))
      .toEqual({ action, buildingId: 9 })
  })
  expect(state.changed.mock.calls.some(([ids]) => ids.includes(9))).toBe(enabled)
  expect(state.reads.includes('buildings')).toBe(!enabled)
  expect(state.reads.includes('cards')).toBe(!enabled)
  if (enabled) expect(result.current.buildings).toEqual([other, added])
})

test('building edit targeted failure uses the existing building and card recovery', async () => {
  const { result } = renderHook(() => useStore(false))
  state.changed.mockRejectedValueOnce(new Error('offline'))
  await act(async () => { await result.current.setUnitsSurveyed(1, true) })
  expect(state.changed).toHaveBeenCalledWith([1])
  expect(state.reads).toContain('cards')
  expect(state.reads.filter((table) => table === 'buildings')).toHaveLength(2)
})

test.each(['list', 'place'] as const)('restaurant %s removal immediately updates store without realtime or reload', async (mode) => {
  localStorage.setItem('auth_token', 'test-token')
  const { result } = renderHook(() => useStore(false))
  const restaurant = { ...testBuilding(1, 1, 'restaurant'), isRestaurant: true }
  const other = testBuilding(2, 2, 'unchanged')
  state.changed.mockResolvedValueOnce({ buildings: [restaurant, other], histories: [] })
  await act(async () => { await result.current.syncChangedBuildings([1, 2]) })
  const remaining = mode === 'place' ? [] : [{ ...restaurant, isRestaurant: false, units: restaurant.units.map((u) => ({ ...u, isRestaurant: false })) }]
  state.changed.mockResolvedValueOnce({ buildings: remaining, histories: [] })
  state.rpc.mockResolvedValue({ data: { action: 'deleted' }, error: null })
  await act(async () => { await result.current.removeRestaurantUnit(restaurant.units[0].id, 1, mode, true) })
  expect(state.changed).toHaveBeenLastCalledWith([1])
  expect(result.current.buildings.find((b) => b.id === 1)).toEqual(remaining[0])
  expect(result.current.buildings.find((b) => b.id === 2)).toEqual(other)
  expect(state.reads).not.toContain('buildings')
  expect(state.reads).toContain('event_restaurant_assignments')
})

test('restaurant refresh failure falls back to buildings, cards, histories and assignments', async () => {
  const { result } = renderHook(() => useStore(false))
  state.changed.mockRejectedValueOnce(new Error('offline'))
  await act(async () => { await result.current.removeRestaurantUnit(1, 1) })
  expect(state.reads).toEqual(expect.arrayContaining(['buildings', 'cards', 'visit_histories', 'event_restaurant_assignments']))
})

test('successful building recovery skips global histories but keeps sessions and expires old records', async () => {
  vi.stubEnv('VITE_TERRITORY_REALTIME_ENABLED', 'true')
  state.clock.mockResolvedValue(new Date().toISOString())
  state.index.mockResolvedValue({ signals: [], ids: [1] })
  const { result } = renderHook(() => useStore(true))
  await waitFor(() => expect(result.current.loading).toBe(false))
  const building = testBuilding(1, 1, 'kept')
  const recent = { id: 1, unitId: building.units[0].id, visitor: 'test', result: '부재', timeSlot: '오전', visitedAt: '2026-10-02', createdAt: new Date().toISOString() }
  state.changed.mockResolvedValueOnce({ buildings: [building], histories: [recent, { ...recent, id: 2, createdAt: '2000-01-01T00:00:00Z' }] })
  await act(async () => { await result.current.syncChangedBuildings([1]) })
  state.reads = []
  await act(async () => { await result.current.refetchSlices(['buildings', 'visits'], { triggeredBy: 'foreground' }) })
  expect(state.reads).not.toContain('visit_histories')
  expect(state.reads).toContain('service_sessions')
  expect(result.current.visitHistories.map((h) => h.id)).toEqual([1])
  state.index.mockRejectedValueOnce(new Error('offline'))
  state.reads = []
  await act(async () => { await result.current.refetchSlices(['buildings', 'visits'], { triggeredBy: 'foreground' }) })
  expect(state.reads).toContain('visit_histories')
  expect(state.reads).toContain('buildings')
  expect(state.reads).toContain('service_sessions')
})

test.each([[1, 2], [2, 1]])('unit move preserves history when building responses arrive in order %j', async (first, second) => {
  const { result } = renderHook(() => useStore(false))
  const source = testBuilding(1, 1, 'source')
  const destination = { ...testBuilding(2, 2, 'destination'), units: [] }
  const history = { id: 1, unitId: source.units[0].id, visitor: 'test', result: '부재', timeSlot: '오전', visitedAt: '2026-10-02' }
  state.changed.mockResolvedValueOnce({ buildings: [source, destination], histories: [history] })
  await act(async () => { await result.current.syncChangedBuildings([1, 2]) })
  for (const id of [first, second]) {
    state.changed.mockResolvedValueOnce({
      buildings: [id === 1 ? { ...source, units: [] } : { ...destination, units: source.units }],
      histories: id === 1 ? [] : [history],
    })
    await act(async () => { await result.current.syncChangedBuildings([id]) })
  }
  expect(result.current.visitHistories).toEqual([history])
  expect(result.current.buildings.find((b) => b.id === 1)?.units).toEqual([])
  expect(result.current.buildings.find((b) => b.id === 2)?.units).toEqual(source.units)
})

test('boundary save and delete use fresh manifests, not all coordinates', async () => {
  const { result } = renderHook(() => useStore(true))
  await waitFor(() => expect(result.current.loading).toBe(false))
  state.boundaryColumns = []
  await act(async () => {
    await result.current.saveCardBoundary(1, [{ lat: 1, lng: 1 }, { lat: 2, lng: 1 }, { lat: 2, lng: 2 }])
  })
  expect(state.boundaryColumns).toEqual(['card_id', 'card_id, updated_at'])
  state.boundaryColumns = []
  await act(async () => { await result.current.deleteCardBoundary(1) })
  expect(state.boundaryColumns).toEqual(['card_id', 'card_id, updated_at'])
})

test('failed post-save targeted read falls back to authoritative buildings and visits', async () => {
  const { result } = renderHook(() => useStore(true))
  await waitFor(() => expect(result.current.loading).toBe(false))
  const one = testBuilding(1, 1, 'kept')
  state.changed.mockResolvedValueOnce({ buildings: [one], histories: [] })
  await act(async () => { await result.current.syncChangedBuildings([1]) })
  state.changed.mockRejectedValueOnce(new Error('offline'))
  state.reads = []
  await act(async () => { await result.current.updateUnitFlags(one.units[0].id, { memo: 'saved' }) })
  expect(state.reads).toContain('buildings')
  expect(state.reads).toContain('visit_histories')
  expect(state.reads).toContain('service_sessions')
})

test.each(['status', 'quick', 'add', 'edit', 'delete', 'undo', 'flags', 'invitation'] as const)(
  '%s refreshes only the affected building and histories, not all service sessions', async (action) => {
    localStorage.setItem('currentVisitor', 'tester')
    localStorage.setItem('auth_token', 'test-token')
    const { result } = renderHook(() => useStore(true))
    await waitFor(() => expect(result.current.loading).toBe(false))
    const one = testBuilding(1, 1, 'changed')
    const two = testBuilding(2, 2, 'untouched')
    const unitId = one.units[0].id
    const visit = { id: 10, buildingId: 1, unitId, visitor: 'tester', result: '부재', timeSlot: '오전', visitedAt: '2026-09-30', createdAt: '2026-09-30T10:00:00Z' }
    state.changed.mockResolvedValueOnce({ buildings: [one, two], histories: [visit] })
    await act(async () => { await result.current.syncChangedBuildings([1, 2]) })
    state.changed.mockClear()
    state.changed.mockResolvedValueOnce({ buildings: [one], histories: [] })
    state.reads = []
    await act(async () => {
      const input = { result: '부재' as const, timeSlot: '오전' as const, memo: '', visitedAt: '2026-09-30' }
      if (action === 'status') await result.current.updateUnitStatus(1, unitId, '부재')
      if (action === 'quick') await result.current.quickLogVisit(1, unitId, '부재')
      if (action === 'add') await result.current.addVisitHistory(1, unitId, input)
      if (action === 'edit') await result.current.updateVisitHistory(10, unitId, input)
      if (action === 'delete') await result.current.deleteVisitHistory(10, unitId)
      if (action === 'undo') await result.current.undoLatestVisit(1, unitId)
      if (action === 'flags') await result.current.updateUnitFlags(unitId, { memo: 'changed' })
      if (action === 'invitation') await result.current.toggleInvitationLeft(1, unitId, 'door')
    })
    expect(state.changed).toHaveBeenCalledExactlyOnceWith([1])
    expect(state.reads).not.toContain('service_sessions')
    expect(state.reads).not.toContain('buildings')
    expect(result.current.buildings.find((b) => b.id === 2)).toEqual(two)
    expect(result.current.visitHistories).toEqual([])
  },
)

test('store recovery reads only boundary versions; manual refresh still reads points', async () => {
  const { result } = renderHook(() => useStore(true))
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(state.boundaryColumns).toEqual(['card_id, points, updated_at'])
  state.boundaryColumns = []
  await act(async () => { await result.current.refetchSlices(['cardBoundaries'], { triggeredBy: 'foreground' }) })
  expect(state.boundaryColumns).toEqual(['card_id, updated_at'])
  await act(async () => { await result.current.refetchSlices(['cardBoundaries'], { triggeredBy: 'mutation:boundary' }) })
  expect(state.boundaryColumns.at(-1)).toBe('card_id, points, updated_at')
})

test('foreground and delayed reconnect use delta while manual refresh stays full', async () => {
  vi.stubEnv('VITE_TERRITORY_REALTIME_ENABLED', 'true')
  state.clock.mockResolvedValue('2026-09-30T12:00:00Z')
  state.index.mockResolvedValue({ signals: [], ids: [] })
  const { result } = renderHook(() => useStore(true))
  await waitFor(() => expect(result.current.loading).toBe(false))
  state.reads = []
  const now = Date.now()
  const date = vi.spyOn(Date, 'now').mockReturnValue(now + 125_000)
  await act(async () => { window.dispatchEvent(new Event('focus')) })
  await waitFor(() => expect(state.index).toHaveBeenCalledTimes(1))
  expect(state.reads).not.toContain('buildings')
  expect(state.reads).toContain('calendar_events')
  await act(async () => { await result.current.refetchSlices(['buildings', 'cards'], { triggeredBy: 'realtime:unit-created-recovery' }) })
  expect(state.index).toHaveBeenCalledTimes(2)
  expect(state.reads).not.toContain('buildings')
  await act(async () => { await result.current.refetchAll() })
  expect(state.reads).toContain('buildings')
  date.mockRestore()
})

test('failed delta falls back to a full read without advancing its cursor', async () => {
  vi.stubEnv('VITE_TERRITORY_REALTIME_ENABLED', 'true')
  state.clock.mockResolvedValue('2026-09-30T12:00:00Z')
  state.index.mockRejectedValue(new Error('unavailable'))
  const { result } = renderHook(() => useStore(true))
  await waitFor(() => expect(result.current.loading).toBe(false))
  state.reads = []
  await act(async () => { await result.current.refetchSlices(['buildings'], { triggeredBy: 'realtime:place-deletion-recovery' }) })
  expect(state.reads).toContain('buildings')
  expect(result.current.territoryRealtime.checkpoint.buildingsThrough).toBeNull()
})

test('manual refresh does not join an in-flight delta as if it were a full snapshot', async () => {
  vi.stubEnv('VITE_TERRITORY_REALTIME_ENABLED', 'true')
  state.clock.mockResolvedValue('2026-09-30T12:00:00Z')
  let release!: (value: unknown) => void
  state.index.mockImplementationOnce(() => new Promise((resolve) => { release = resolve }))
  const { result } = renderHook(() => useStore(true))
  await waitFor(() => expect(result.current.loading).toBe(false))
  state.reads = []
  let delta!: Promise<void>
  await act(async () => {
    delta = result.current.refetchSlices(['buildings'], { triggeredBy: 'realtime:place-deletion-recovery' })
  })
  await waitFor(() => expect(state.index).toHaveBeenCalled())
  await act(async () => { await result.current.refetchAll() })
  expect(state.reads).toContain('buildings')
  await act(async () => { release({ signals: [], ids: [] }); await delta })
})

test('publishes the server read-start baseline only after the full snapshot succeeds', async () => {
  vi.stubEnv('VITE_TERRITORY_REALTIME_ENABLED', 'true')
  state.clock.mockResolvedValue('2026-09-30T12:00:00Z')
  let release!: () => void
  state.block = new Promise<void>((resolve) => { release = resolve })
  const { result } = renderHook(() => useStore(true))
  await waitFor(() => expect(state.reads).toContain('buildings'))
  expect(result.current.territoryRealtime.checkpoint.baseline).toBeNull()
  expect(state.clock).toHaveBeenCalledTimes(1)
  await act(async () => { release() })
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.territoryRealtime.checkpoint.baseline).toBe('2026-09-30T12:00:00Z')
  state.clock.mockRejectedValueOnce(new Error('clock offline'))
  state.reads = []
  await act(async () => {
    await expect(result.current.refetchSlices(['buildings', 'visits'])).resolves.toBeUndefined()
  })
  expect(state.reads).toContain('buildings')
  expect(state.reads).toContain('visit_histories')
  expect(result.current.territoryRealtime.checkpoint.baseline).toBe('2026-09-30T12:00:00Z')
})

test.each(['RPC not found in schema cache', 'network unavailable'])(
  'initial data still loads when the optional clock fails: %s', async (message) => {
    vi.stubEnv('VITE_TERRITORY_REALTIME_ENABLED', 'true')
    state.clock.mockRejectedValue(new Error(message))
    const { result } = renderHook(() => useStore(true))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBeNull()
    expect(state.reads).toContain('buildings')
    expect(state.reads).toContain('visit_histories')
    expect(result.current.territoryRealtime.checkpoint.baseline).toBeNull()
  },
)

test('concurrent recovery requests share building reads but mutation refreshes do not', async () => {
  const { result } = renderHook(() => useStore(true))
  await waitFor(() => expect(result.current.loading).toBe(false))
  state.reads = []
  let release!: () => void
  state.block = new Promise<void>((resolve) => { release = resolve })
  let first!: Promise<void>, second!: Promise<void>, mutation!: Promise<void>
  await act(async () => {
    first = result.current.refetchSlices(['buildings'], { triggeredBy: 'realtime:place-deletion-recovery' })
    second = result.current.refetchSlices(['buildings'], { triggeredBy: 'realtime:unit-created-recovery' })
    mutation = result.current.refetchSlices(['buildings'], { triggeredBy: 'mutation:building' })
  })
  expect(state.reads.filter((table) => table === 'buildings')).toHaveLength(2)
  await act(async () => { release(); await Promise.all([first, second, mutation]) })
})

test('sync inserts empty buildings, replaces remote status and histories, and preserves unrelated buildings', async () => {
  const { result } = renderHook(() => useStore(true))
  await waitFor(() => expect(result.current.loading).toBe(false))
  const one = testBuilding(1, 1, 'first')
  const two = testBuilding(2, 2, 'other')
  const visit = { id: 10, buildingId: 1, unitId: one.units[0].id, visitor: 'peer', result: '부재', timeSlot: '오전', visitedAt: '2026-09-30', createdAt: '2026-09-30T10:00:00Z' }
  state.changed.mockResolvedValueOnce({ buildings: [one, two], histories: [] })
  await act(async () => { await result.current.syncChangedBuildings([1, 2]) })
  const updated = { ...one, units: one.units.map((u) => ({ ...u, status: '부재' })) }
  state.changed.mockResolvedValueOnce({ buildings: [updated], histories: [visit] })
  await act(async () => { await result.current.syncChangedBuildings([1]) })
  expect(result.current.buildings.find((b) => b.id === 1)?.units[0].status).toBe('부재')
  expect(result.current.buildings.find((b) => b.id === 2)).toEqual(two)
  expect(result.current.buildings.map((b) => b.id)).toEqual([1, 2])
  expect(result.current.visitHistories).toEqual([visit])
  state.changed.mockResolvedValueOnce({ buildings: [one], histories: [] })
  await act(async () => { await result.current.syncChangedBuildings([1]) })
  expect(result.current.visitHistories).toEqual([])
  expect(result.current.buildings.find((b) => b.id === 1)?.units[0].status).toBe(one.units[0].status)
  state.changed.mockResolvedValueOnce({ buildings: [testBuilding(3, 1, 'empty', [])], histories: [] })
  await act(async () => { await result.current.syncChangedBuildings([3]) })
  expect(result.current.buildings.find((b) => b.id === 3)?.units).toEqual([])
  expect(result.current.buildings).toHaveLength(3)
})

test.each(['invalidation', 'history deletion', 'unit deletion', 'building deletion'])(
  '%s removes cached old histories without erasing unrelated histories', async (change) => {
    const { result } = renderHook(() => useStore(true))
    await waitFor(() => expect(result.current.loading).toBe(false))
    const one = testBuilding(1, 1, 'changed')
    const two = testBuilding(2, 2, 'unrelated')
    const old = { id: 10, unitId: one.units[0].id, visitor: 'peer', result: '부재', timeSlot: '오전', visitedAt: '2026-08-01', createdAt: '2026-08-01T10:00:00Z' }
    const unrelated = { ...old, id: 20, unitId: two.units[0].id }
    state.changed.mockResolvedValueOnce({ buildings: [one, two], histories: [old, unrelated] })
    await act(async () => { await result.current.syncChangedBuildings([1, 2]) })
    expect(result.current.visitHistories).toHaveLength(2)
    const remaining = change === 'building deletion' ? []
      : [change === 'unit deletion' ? { ...one, units: [] } : one]
    state.changed.mockResolvedValueOnce({ buildings: remaining, histories: [] })
    await act(async () => { await result.current.syncChangedBuildings([1]) })
    expect(result.current.visitHistories).toEqual([unrelated])
    expect(result.current.buildings.find((b) => b.id === 2)).toEqual(two)
    expect(result.current.buildings.find((b) => b.id === 1)).toEqual(remaining[0])
  },
)

test('a failed targeted fetch does not erase existing data', async () => {
  const { result } = renderHook(() => useStore(true))
  await waitFor(() => expect(result.current.loading).toBe(false))
  state.changed.mockResolvedValueOnce({ buildings: [testBuilding(1, 1, 'kept')], histories: [] })
  await act(async () => { await result.current.syncChangedBuildings([1]) })
  state.changed.mockRejectedValueOnce(new Error('offline'))
  await act(async () => { await expect(result.current.syncChangedBuildings([1])).rejects.toThrow('offline') })
  expect(result.current.buildings[0].name).toBe('kept')
})

test('an older map response cannot overwrite a newer response for the same building', async () => {
  const { result } = renderHook(() => useStore(true))
  await waitFor(() => expect(result.current.loading).toBe(false))
  let finish!: (data: unknown) => void
  state.changed.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    .mockResolvedValueOnce({ buildings: [testBuilding(1, 1, 'new')], histories: [] })
  let old!: Promise<void>
  await act(async () => {
    old = result.current.syncChangedBuildings([1])
    await result.current.syncChangedBuildings([1])
  })
  await act(async () => { finish({ buildings: [testBuilding(1, 1, 'old')], histories: [] }); await old })
  expect(result.current.buildings[0].name).toBe('new')
})
