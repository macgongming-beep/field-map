import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { clearUserChatsCache } from '../lib/userChatsCache'
import { useUserChats } from './useUserChats'
import { NotificationCenter } from '../components/NotificationCenter'
import { GlobalChatModal } from '../components/GlobalChatModal'
import type { AppNotification } from './useNotifications'

const mocks = vi.hoisted(() => ({
  from: vi.fn(), rpc: vi.fn(), channel: vi.fn(), removeChannel: vi.fn(),
  select: vi.fn(), token: 'test-token',
}))
vi.mock('../lib/supabase', () => ({ supabase: mocks }))
vi.mock('../lib/authToken', () => ({ getAuthToken: () => mocks.token }))
vi.mock('../config/features', () => ({ CART_APPLICATIONS_ENABLED: true }))

type Payload = { new: { event_id?: unknown } }
const handlers = new Map<string, (payload: Payload) => void>()
let subscribeStatus: (status: string) => void
let eventIds: number[]

beforeEach(() => {
  vi.useFakeTimers()
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
  clearUserChatsCache()
  mocks.token = 'test-token'
  handlers.clear()
  eventIds = [1]
  mocks.rpc.mockImplementation(async (name: string) => ({
    data: name === 'get_chat_message_meta'
      ? eventIds.map((event_id) => ({ event_id, created_at: '2026-10-05T10:00:00Z', author_id: 20 }))
      : [],
    error: null,
  }))
  mocks.from.mockImplementation((table: string) => {
    let personal = false
    const query = {
      select: vi.fn((columns: string) => { mocks.select(table, columns); return query }),
      eq: vi.fn((column: string) => { personal = column === 'user_name'; return query }),
      in: vi.fn(() => query),
      then: (resolve: (value: { data: unknown[]; error: null }) => unknown) => Promise.resolve({
        data: table === 'event_participants' && personal
          ? eventIds.map((id) => ({ event_id: id, events: { id, event_date: '2026-10-05', time: '10:00', title: 'Test' } }))
          : [],
        error: null,
      }).then(resolve),
    }
    return query
  })
  const channel = {
    on: vi.fn((_type: string, filter: { table: string }, handler: (payload: Payload) => void) => {
      handlers.set(filter.table, handler)
      return channel
    }),
    subscribe: vi.fn((callback: (status: string) => void) => {
      subscribeStatus = callback
      callback('SUBSCRIBED')
      return channel
    }),
  }
  mocks.channel.mockReturnValue(channel)
})

afterEach(() => {
  cleanup()
  clearUserChatsCache()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

async function mount() {
  const hook = renderHook(() => useUserChats(10, 'test-user'))
  await act(async () => {})
  mocks.from.mockClear()
  mocks.rpc.mockClear()
  return hook
}

test.each([undefined, false])('full mode (%s) retains participant and session detail reads', async (badgeOnly) => {
  renderHook(() => useUserChats(10, 'test-user', { badgeOnly, realtime: false }))
  await act(async () => {})
  expect(mocks.select).toHaveBeenCalledWith('event_participants', 'event_id')
  expect(mocks.select).toHaveBeenCalledWith('event_cart_applications', 'event_id')
  expect(mocks.select).toHaveBeenCalledWith('service_sessions', 'calendar_event_id, ended_at')
})

test('badge skips list details but preserves unread across old rooms, own messages and read receipts', async () => {
  mocks.rpc.mockImplementation(async (name: string) => ({
    data: name === 'get_my_chat_reads' ? [{ event_id: 1, last_read_at: '2026-10-05T09:00:00Z' }]
      : name === 'get_chat_message_meta' ? [
        { event_id: 1, created_at: '2026-10-05T10:00:00Z', author_id: 20 },
        { event_id: 1, created_at: '2026-10-05T11:00:00Z', author_id: 10 },
        { event_id: 1, created_at: '2026-10-05T08:00:00Z', author_id: 20 },
      ] : [], error: null,
  }))
  const badge = renderHook(() => useUserChats(10, 'test-user', { badgeOnly: true, realtime: false }))
  await act(async () => {})
  expect(badge.result.current.totalUnread).toBe(1)
  expect(mocks.select).not.toHaveBeenCalledWith('event_participants', 'event_id')
  expect(mocks.select).not.toHaveBeenCalledWith('event_cart_applications', 'event_id')
  expect(mocks.from).not.toHaveBeenCalledWith('service_sessions')
  expect(mocks.rpc).toHaveBeenCalledWith('get_my_chat_reads', { p_token: 'test-token' })
  const full = renderHook(() => useUserChats(10, 'test-user', { realtime: false }))
  await act(async () => {})
  expect(full.result.current.totalUnread).toBe(badge.result.current.totalUnread)
  expect(mocks.from).toHaveBeenCalledWith('service_sessions')
  act(() => badge.result.current.markChatReadLocally(1))
  expect(badge.result.current.totalUnread).toBe(0)
})

test('badge inflight cannot satisfy a concurrently opened full list', async () => {
  renderHook(() => useUserChats(10, 'test-user', { badgeOnly: true, realtime: false }))
  renderHook(() => useUserChats(10, 'test-user', { realtime: false }))
  await act(async () => {})
  expect(mocks.from.mock.calls.filter(([table]) => table === 'calendar_events')).toHaveLength(2)
  expect(mocks.select).toHaveBeenCalledWith('event_participants', 'event_id')
  expect(mocks.from).toHaveBeenCalledWith('service_sessions')
})

test('opening the actual modal after a warmed badge still loads full list details', async () => {
  renderHook(() => useUserChats(10, 'test-user', { badgeOnly: true, realtime: false }))
  await act(async () => {})
  mocks.select.mockClear()
  mocks.from.mockClear()
  render(<GlobalChatModal userId={10} userName="test-user" onClose={() => {}} />)
  await act(async () => {})
  expect(mocks.select).toHaveBeenCalledWith('event_participants', 'event_id')
  expect(mocks.select).toHaveBeenCalledWith('event_cart_applications', 'event_id')
  expect(mocks.select).toHaveBeenCalledWith('service_sessions', 'calendar_event_id, ended_at')
})

test('badge cache is separated by account and session token', async () => {
  const { rerender, result } = renderHook(({ id }) => useUserChats(id, 'test-user', { badgeOnly: true, realtime: false }),
    { initialProps: { id: 10 } })
  await act(async () => {})
  mocks.rpc.mockClear()
  mocks.token = 'replacement-token'
  eventIds = [2]
  rerender({ id: 10 })
  await act(async () => {})
  expect(mocks.rpc).toHaveBeenCalledWith('get_chat_message_meta', { p_token: 'replacement-token', p_event_ids: [2] })
  expect(result.current.chats.map((chat) => chat.eventId)).toEqual([2])
  mocks.rpc.mockClear()
  rerender({ id: 11 })
  await act(async () => {})
  expect(mocks.rpc).toHaveBeenCalledWith('get_chat_message_meta', expect.anything())
})

test.each(['account', 'token'])('badge hides old identity on the first %s render before effects', async (change) => {
  const renders: number[] = []
  const { rerender } = renderHook(({ id }) => {
    const value = useUserChats(id, 'test-user', { badgeOnly: true, realtime: false })
    renders.push(value.totalUnread)
    return value
  }, { initialProps: { id: 10 } })
  await act(async () => {})
  expect(renders.at(-1)).toBe(1)
  renders.length = 0
  if (change === 'token') mocks.token = 'new-token'
  rerender({ id: change === 'account' ? 11 : 10 })
  expect(renders[0]).toBe(0)
  await act(async () => {})
})

test('late badge response from a replaced token cannot overwrite the new session', async () => {
  let finishOld!: (value: { data: unknown[]; error: null }) => void
  mocks.rpc.mockImplementation(async (name: string, args: { p_token: string }) => {
    if (name === 'get_chat_message_meta' && args.p_token === 'test-token') {
      return new Promise((resolve) => { finishOld = resolve })
    }
    return { data: [], error: null }
  })
  const { result, rerender } = renderHook(() => useUserChats(10, 'test-user', { badgeOnly: true, realtime: false }))
  await act(async () => {})
  expect(finishOld).toBeTypeOf('function')
  mocks.token = 'new-token'
  eventIds = [2]
  rerender()
  await act(async () => {})
  expect(result.current.chats.map((chat) => chat.eventId)).toEqual([2])
  await act(async () => finishOld({
    data: [{ event_id: 1, created_at: '2026-10-05T10:00:00Z', author_id: 20 }], error: null,
  }))
  expect(result.current.chats.map((chat) => chat.eventId)).toEqual([2])
  expect(result.current.totalUnread).toBe(0)
})

async function emit(table: string, eventId: unknown) {
  await act(async () => {
    handlers.get(table)!({ new: { event_id: eventId } })
    await vi.advanceTimersByTimeAsync(1500)
  })
}

test('unrelated room messages do not reload the header list', async () => {
  await mount()
  await emit('chat_message_signals', 999)
  expect(mocks.from).not.toHaveBeenCalled()
  expect(mocks.rpc).not.toHaveBeenCalled()
})

test('own room messages refresh unread metadata and coalesce a burst', async () => {
  const { result } = await mount()
  await act(async () => {
    handlers.get('chat_message_signals')!({ new: { event_id: 1 } })
    handlers.get('chat_message_signals')!({ new: { event_id: 1 } })
    await vi.advanceTimersByTimeAsync(1500)
  })
  expect(mocks.rpc.mock.calls.filter(([name]) => name === 'get_chat_message_meta')).toHaveLength(1)
  expect(result.current.totalUnread).toBe(1)
})

test('unknown membership falls back to refresh instead of dropping a message', async () => {
  await mount()
  clearUserChatsCache()
  await emit('chat_message_signals', 999)
  expect(mocks.rpc).toHaveBeenCalledWith('get_chat_message_meta', expect.anything())
})

test('malformed message signals retain the recovery path', async () => {
  await mount()
  await emit('chat_message_signals', undefined)
  expect(mocks.rpc).toHaveBeenCalledWith('get_chat_message_meta', expect.anything())
})

test('a confirmed empty room list skips messages but still discovers newly joined rooms', async () => {
  eventIds = []
  const { result } = await mount()
  await emit('chat_message_signals', 2)
  expect(mocks.from).not.toHaveBeenCalled()
  eventIds = [2]
  await emit('event_participants', 2)
  expect(result.current.chats.map((chat) => chat.eventId)).toEqual([2])
  mocks.rpc.mockClear()
  await emit('chat_message_signals', 2)
  expect(mocks.rpc).toHaveBeenCalledWith('get_chat_message_meta', { p_token: 'test-token', p_event_ids: [2] })
})

test('leaving a room refreshes membership and stops its later message reloads', async () => {
  const { result } = await mount()
  eventIds = []
  await emit('event_participants', 1)
  expect(result.current.chats).toEqual([])
  mocks.from.mockClear()
  mocks.rpc.mockClear()
  await emit('chat_message_signals', 1)
  expect(mocks.from).not.toHaveBeenCalled()
  expect(mocks.rpc).not.toHaveBeenCalled()
})

test('cart application changes still refresh membership', async () => {
  await mount()
  await emit('event_cart_applications', 2)
  expect(mocks.from).toHaveBeenCalledWith('event_cart_applications')
  expect(mocks.rpc).toHaveBeenCalledWith('get_chat_message_meta', expect.anything())
})

test('reconnection still refreshes even without a related message signal', async () => {
  await mount()
  await act(async () => { subscribeStatus('CHANNEL_ERROR'); subscribeStatus('SUBSCRIBED') })
  expect(mocks.rpc).toHaveBeenCalledWith('get_chat_message_meta', expect.anything())
})

test('two minute visible fallback remains and hidden polling stays stopped', async () => {
  await mount()
  await act(async () => { await vi.advanceTimersByTimeAsync(120_000) })
  expect(mocks.rpc).toHaveBeenCalledWith('get_chat_message_meta', expect.anything())
  mocks.rpc.mockClear()
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
  await act(async () => { await vi.advanceTimersByTimeAsync(120_000) })
  expect(mocks.rpc).not.toHaveBeenCalled()
})

test('unmount cancels a pending refresh and removes the subscription', async () => {
  const { unmount } = await mount()
  act(() => handlers.get('chat_message_signals')!({ new: { event_id: 1 } }))
  unmount()
  await act(async () => { await vi.advanceTimersByTimeAsync(1500) })
  expect(mocks.rpc).not.toHaveBeenCalled()
  expect(mocks.removeChannel).toHaveBeenCalled()
})

function notification(overrides: Partial<AppNotification> = {}): AppNotification {
  return {
    id: 1, userId: 10, type: 'daily_service', title: 'Notification fixture',
    body: null, link: '/calendar?openEvent=1', relatedId: null,
    isRead: false, createdAt: '2026-10-05T10:00:00Z', ...overrides,
  }
}

function CurrentLocation() {
  const location = useLocation()
  return <output data-testid="location">{location.pathname}{location.search}</output>
}

test.each(['daily_service', 'comment', 'mention'] as const)(
  'notification center skips chat requests for %s without a chat link and preserves read/navigation',
  async (type) => {
    const markRead = vi.fn(async () => {})
    const onClose = vi.fn()
    render(<MemoryRouter>
      <NotificationCenter userId={10} userName="test-user" onClose={onClose}
        notifications={[notification({ type })]} markRead={markRead} markAllRead={async () => {}} />
      <CurrentLocation />
    </MemoryRouter>)
    await act(async () => {})
    expect(mocks.from).not.toHaveBeenCalled()
    expect(mocks.rpc).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('Notification fixture'))
    expect(markRead).toHaveBeenCalledWith(1)
    expect(onClose).toHaveBeenCalledOnce()
    expect(screen.getByTestId('location').textContent).toBe('/calendar?openEvent=1')
  },
)

test.each(['chat', 'mention'] as const)(
  'notification center loads metadata when a %s group arrives and opens the room',
  async (type) => {
    const markRead = vi.fn(async () => {})
    const onClose = vi.fn()
    const openChat = vi.fn()
    window.addEventListener('app:open-event-chat', openChat)
    const view = (items: AppNotification[]) => <MemoryRouter>
      <NotificationCenter userId={10} userName="test-user" onClose={onClose}
        notifications={items} markRead={markRead} markAllRead={async () => {}} />
    </MemoryRouter>
    try {
      const { rerender } = render(view([]))
      await act(async () => {})
      expect(mocks.from).not.toHaveBeenCalled()
      rerender(view([notification({ type, link: '/calendar?openChat=1' })]))
      await act(async () => {})
      expect(mocks.rpc).toHaveBeenCalledWith('get_chat_message_meta', { p_token: 'test-token', p_event_ids: [1] })
      fireEvent.click(screen.getByText('Test'))
      expect(markRead).toHaveBeenCalledWith(1)
      expect(openChat).toHaveBeenCalledWith(expect.objectContaining({
        detail: expect.objectContaining({ eventId: 1, eventTitle: 'Test' }),
      }))
      expect(onClose).toHaveBeenCalledOnce()
      mocks.from.mockClear()
      mocks.rpc.mockClear()
      rerender(view([notification()]))
      await act(async () => {})
      expect(mocks.from).not.toHaveBeenCalled()
      expect(mocks.rpc).not.toHaveBeenCalled()
      expect(mocks.channel).not.toHaveBeenCalled()
    } finally {
      window.removeEventListener('app:open-event-chat', openChat)
    }
  },
)
