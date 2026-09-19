import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { pushBackHandler } from './backStack'

beforeEach(() => {
  window.history.replaceState({}, '', '/')
})

afterEach(() => vi.restoreAllMocks())

describe('backStack', () => {
  it('겹친 화면도 스와이프 한 번에 최상단 한 층만 닫는다', () => {
    const closeOuter = vi.fn()
    const closeInner = vi.fn()
    const disposeOuter = pushBackHandler(closeOuter)
    const outerState = window.history.state
    const disposeInner = pushBackHandler(closeInner)

    window.history.replaceState(outerState, '', '/')
    window.dispatchEvent(new PopStateEvent('popstate', { state: outerState }))

    expect(closeInner).toHaveBeenCalledTimes(1)
    expect(closeOuter).not.toHaveBeenCalled()
    disposeInner()

    window.history.replaceState({}, '', '/')
    window.dispatchEvent(new PopStateEvent('popstate', { state: {} }))

    expect(closeOuter).toHaveBeenCalledTimes(1)
    disposeOuter()
  })

  it('다른 라우트가 먼저 기록을 바꿨으면 cleanup이 추가 뒤로가기를 하지 않는다', () => {
    const historyBack = vi.spyOn(window.history, 'back')
    const dispose = pushBackHandler(vi.fn())

    window.history.replaceState({}, '', '/calendar')
    dispose()

    expect(historyBack).not.toHaveBeenCalled()
  })
})
