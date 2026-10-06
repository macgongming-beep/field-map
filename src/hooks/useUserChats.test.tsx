import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { clearUserChatsCache } from '../lib/userChatsCache'
import { useUserChats } from './useUserChats'
import { NotificationCenter } from '../components/NotificationCenter'
import type { AppNotification } from './useNotifications'

const mocks = vi.hoisted(() => ({
  from: vi.fn(), rpc: vi.fn(), channel: vi.fn(), removeChannel: vi.fn(),
}))
vi.mock('../lib/supabase', () => ({ supabase: mocks }))
vi.mock('../lib/authToken', () => ({ getAuthToken: () => 'test-token' }))
vi.mock('../config/features', () => ({ CART_APPLICATIONS_ENABLED: true }))

type Payload = { new: { event_id?: unknown } }
const handlers = new Map<string, (payload: Payload) => void>()
let subscribeStatus: (status: string) => void
let eventIds: number[]

beforeEach(() => {
  vi.useFakeTimers()
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
  clearUserChatsCache()
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
      select: vi.fn(() => query),
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
