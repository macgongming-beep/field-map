import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useUnitCreationRealtime } from './useUnitCreationRealtime'

const mocks = vi.hoisted(() => {
  const handlers: Array<(payload: { new: unknown }) => void> = []
  const channel = {
    topic: 'unit-creation-test',
    on: vi.fn((_type, _filter, handler: (payload: { new: unknown }) => void) => {
      handlers.push(handler)
      return channel
    }),
    subscribe: vi.fn(() => channel),
  }
  return { handlers, channel, removeChannel: vi.fn(), subscribeWithRecovery: vi.fn() }
})

vi.mock('../lib/supabase', () => ({
  supabase: { channel: vi.fn(() => mocks.channel), removeChannel: mocks.removeChannel },
}))
vi.mock('../lib/realtimeRecovery', () => ({ subscribeWithRecovery: mocks.subscribeWithRecovery }))

beforeEach(() => {
  vi.useFakeTimers()
  mocks.handlers.length = 0
  mocks.channel.on.mockClear()
  mocks.removeChannel.mockClear()
  mocks.subscribeWithRecovery.mockClear()
})
afterEach(() => vi.useRealTimers())

describe('세대 생성 Realtime 동기화', () => {
  it('일괄 생성 신호를 모아 한 번만 전달한다', () => {
    const onCreate = vi.fn()
    renderHook(() => useUnitCreationRealtime(onCreate))
    act(() => {
      mocks.handlers[0]({ new: { unit_id: 21 } })
      mocks.handlers[0]({ new: { unit_id: 22 } })
      mocks.handlers[0]({ new: { unit_id: 21 } })
      vi.advanceTimersByTime(250)
    })
    expect(onCreate).toHaveBeenCalledTimes(1)
    expect(onCreate).toHaveBeenCalledWith([21, 22])
  })

  it('로그인 전에는 채널을 열지 않는다', () => {
    renderHook(() => useUnitCreationRealtime(vi.fn(), { enabled: false }))
    expect(mocks.channel.on).not.toHaveBeenCalled()
  })

  it('화면을 떠날 때 대기 중 호출을 취소하고 채널을 닫는다', () => {
    const onCreate = vi.fn()
    const { unmount } = renderHook(() => useUnitCreationRealtime(onCreate))
    act(() => mocks.handlers[0]({ new: { unit_id: 21 } }))
    unmount()
    act(() => vi.advanceTimersByTime(300))
    expect(onCreate).not.toHaveBeenCalled()
    expect(mocks.removeChannel).toHaveBeenCalledWith(mocks.channel)
  })
})
