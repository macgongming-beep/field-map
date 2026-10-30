import { afterEach, expect, test, vi } from 'vitest'
import { createHistoryCoverage, HISTORY_RECHECK_MS, scopedHistoryRecoveryEnabled } from './scopedHistoryRecovery'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs() })

test('only a completed matching generation can establish history coverage', () => {
  const state = createHistoryCoverage()
  const read = state.begin('old')
  expect(state.canReuse('old')).toBe(false)
  state.invalidate()
  state.commit(read, 'old')
  expect(state.canReuse('old')).toBe(false)
  state.commit(state.begin('old'), 'new')
  expect(state.canReuse('new')).toBe(false)
  state.applyDelta('new', 'changed')
  expect(state.canReuse('changed')).toBe(false)
})

test('successful deltas may change coverage but cannot extend its original read-start deadline', () => {
  const clock = vi.spyOn(Date, 'now').mockReturnValue(100)
  const state = createHistoryCoverage(), read = state.begin('a')
  clock.mockReturnValue(200)
  state.commit(read, 'a')
  expect(state.canReuse('a')).toBe(true)
  state.applyDelta('a', 'b')
  expect(state.canReuse('a')).toBe(false)
  expect(state.canReuse('b')).toBe(true)
  clock.mockReturnValue(100 + HISTORY_RECHECK_MS)
  expect(state.canReuse('b')).toBe(false)
  clock.mockReturnValue(99)
  expect(state.canReuse('b')).toBe(false)
})

test.each([
  [undefined, 'true', true, false], ['false', 'true', true, false],
  ['true', undefined, true, true], ['true', 'false', true, false], ['true', 'true', false, false],
] as const)('demo-only scoped recovery gate %s/%s/%s', (demo, flag, scoped, expected) => {
  vi.stubEnv('VITE_DEMO_MODE', demo)
  vi.stubEnv('VITE_SCOPED_HISTORY_RECOVERY_ENABLED', flag)
  expect(scopedHistoryRecoveryEnabled(scoped)).toBe(expected)
})
