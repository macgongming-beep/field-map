import { afterEach, expect, test, vi } from 'vitest'
import { normalizeSentryDsn } from './sentryDsn'

const sdk = vi.hoisted(() => ({ init: vi.fn(), getClient: vi.fn(), setUser: vi.fn() }))
vi.mock('@sentry/react', () => ({ ...sdk, browserTracingIntegration: vi.fn(), replayIntegration: vi.fn() }))
import { initSentry, setSentryUser, clearSentryUser } from './sentry'

const valid = 'https://publicKey@o123.ingest.us.sentry.io/456'
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); vi.clearAllMocks() })

test.each([undefined, '', '   '])('empty DSN remains optional: %s', value => {
  expect(normalizeSentryDsn(value)).toBeUndefined()
  vi.stubEnv('VITE_SENTRY_DSN', value)
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  initSentry()
  expect(sdk.init).not.toHaveBeenCalled()
})

test.each([`Sentry.init({dsn: "${valid}"});`, 'not-a-url', 'https://example.com/456',
  'https://key:private@example.com/456', 'http://key@example.com/456',
  `${valid}?secret=example`, `${valid}#fragment`, 'https://key@example.com/project'])('rejects invalid DSN without exposing it: %s', value => {
  expect(() => normalizeSentryDsn(value)).toThrow('HTTPS public DSN URL')
  vi.stubEnv('VITE_SENTRY_DSN', value)
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  initSentry()
  expect(sdk.init).not.toHaveBeenCalled()
  expect(warn).toHaveBeenCalledExactlyOnceWith('[sentry] Invalid VITE_SENTRY_DSN; monitoring disabled')
})

test('valid trimmed DSN initializes the existing privacy-protected client', () => {
  vi.stubEnv('VITE_SENTRY_DSN', `  ${valid}\n`)
  initSentry()
  expect(sdk.init).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ dsn: valid,
    sendDefaultPii: false, beforeSend: expect.any(Function), beforeBreadcrumb: expect.any(Function) }))
  expect(normalizeSentryDsn('https://key@sentry.example.com/prefix/42')).toBe('https://key@sentry.example.com/prefix/42')
})

test('user scope is not changed when monitoring has no client', () => {
  sdk.getClient.mockReturnValue(undefined)
  setSentryUser({ id: 1, name: 'test' }); clearSentryUser()
  expect(sdk.setUser).not.toHaveBeenCalled()
  sdk.getClient.mockReturnValue({})
  setSentryUser({ id: 1, name: 'test' }); clearSentryUser()
  expect(sdk.setUser.mock.calls).toEqual([[{ id: '1', username: 'test' }], [null]])
})
