import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { AppLoading, AppScreenReady } from './AppLoading'
import { lazy, StrictMode, Suspense } from 'react'
import { setCurrentLang } from '../i18n'
import { readFileSync } from 'node:fs'
const apply = vi.hoisted(() => vi.fn())
vi.mock('../lib/pwa', () => ({ applyUpdate: apply }))
afterEach(() => { cleanup(); vi.useRealTimers(); setCurrentLang('ko'); apply.mockReset() })

test('slow loading keeps waiting and only reloads on a click', async () => {
  vi.useFakeTimers()
  render(<AppLoading kind="screen" />)
  expect(screen.queryByRole('button')).toBeNull()
  await act(() => vi.advanceTimersByTimeAsync(12_000))
  expect(apply).not.toHaveBeenCalled()
  apply.mockResolvedValue(undefined)
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '앱 다시 불러오기' })))
  expect(apply).toHaveBeenCalledOnce()
})

test('failed update keeps a retry button and does not clear login storage', async () => {
  localStorage.setItem('auth_token', 'keep-me')
  apply.mockRejectedValue(new Error('offline'))
  render(<AppLoading failed />)
  await act(async () => fireEvent.click(screen.getByRole('button')))
  expect(screen.getByRole('alert').textContent).toContain('잠시 후')
  expect(screen.getByRole('button').hasAttribute('disabled')).toBe(false)
  expect(localStorage.getItem('auth_token')).toBe('keep-me')
  localStorage.removeItem('auth_token')
})

test.each([['zh', '重新加载应用'], ['en', 'Reload app']] as const)('recovery is translated for %s', (lang, label) => {
  setCurrentLang(lang)
  render(<AppLoading failed />)
  expect(screen.getByRole('button', { name: label })).toBeTruthy()
})

test('pre-JS shell and React share the same brand, layout and inline icon without asset requests', () => {
  const boot = new DOMParser().parseFromString(readFileSync('index.html', 'utf8'), 'text/html')
  const { container } = render(<AppLoading startup />)
  expect(boot.head.querySelector('#app-loading-style')).not.toBeNull()
  for (const selector of ['.app-loading-main', '.app-loading-brand', '.app-loading-mark']) {
    expect(container.querySelector(selector)).not.toBeNull()
    expect(boot.querySelector(selector)).not.toBeNull()
  }
  expect(container.querySelector('.app-loading')?.textContent?.trim()).toBe('')
  expect(boot.querySelector('.app-loading')?.textContent?.trim()).toBe('')
  expect(screen.getByRole('status', { name: '데이터 불러오는 중...' })).toBeTruthy()
  expect(boot.querySelector('.app-loading')?.getAttribute('aria-label')).toBe('데이터 불러오는 중...')
  expect(container.querySelector('.app-loading-spinner')).toBeNull()
  expect(boot.querySelector('.app-loading-spinner')).toBeNull()
  expect(boot.head.querySelector('#app-loading-style')?.textContent).not.toMatch(/animation|@keyframes/)
  const shapes = (root: ParentNode) => Array.from(root.querySelectorAll('.app-loading-mark *'), element => ({
    tag: element.tagName, attributes: Object.fromEntries(Array.from(element.attributes, attr => [attr.name, attr.value])),
  }))
  expect(shapes(container)).toEqual(shapes(boot))
  expect(container.querySelector('.app-loading-mark')?.getAttribute('aria-hidden')).toBe('true')
  expect(container.querySelector('img,image,use,iframe,video')).toBeNull()
  expect(boot.querySelector('#root img,#root image,#root use')).toBeNull()
})

test('the recovery timer never delays leaving loading or reloads automatically', async () => {
  vi.useFakeTimers()
  const { unmount } = render(<AppLoading />)
  await act(() => vi.advanceTimersByTimeAsync(11_999))
  expect(screen.queryByRole('button')).toBeNull()
  unmount()
  expect(document.querySelector('.app-loading')).toBeNull()
  expect(vi.getTimerCount()).toBe(0)
  await act(() => vi.advanceTimersByTimeAsync(20_000))
  expect(apply).not.toHaveBeenCalled()
  expect(vi.getTimerCount()).toBe(0)
})

test('failed load retains the brand and recovery action without a spinning progress indicator', () => {
  const { container } = render(<AppLoading failed startup />)
  expect(container.querySelector('.app-loading-mark')).not.toBeNull()
  expect(container.querySelector('.app-loading-spinner')).toBeNull()
  expect(screen.getByRole('status').textContent).toContain('자료를 불러오지 못했습니다.')
  expect(screen.getByRole('button', { name: '앱 다시 불러오기' })).toBeTruthy()
})

test.each(['data', 'screen', 'login'] as const)('%s waits after startup have text but no logo or animation', kind => {
  const { container } = render(<AppLoading kind={kind} />)
  expect(container.querySelector('.app-loading-mark')).toBeNull()
  expect(container.querySelector('svg')).toBeNull()
  expect(screen.getByRole('status').textContent?.trim()).not.toBe('')
})

test('readiness waits for the lazy screen commit, not just its parent render', async () => {
  let resolve!: (value: { default: () => React.ReactNode }) => void
  const Screen = lazy(() => new Promise<{ default: () => React.ReactNode }>(r => { resolve = r }))
  const ready = vi.fn()
  render(<StrictMode><Suspense fallback={<AppLoading startup />}>
    <Screen /><AppScreenReady onReady={ready} />
  </Suspense></StrictMode>)
  expect(document.querySelector('.app-loading-mark')).not.toBeNull()
  expect(ready).not.toHaveBeenCalled()
  await act(async () => resolve({ default: () => <div>ready screen</div> }))
  expect(screen.getByText('ready screen')).toBeTruthy()
  expect(ready).toHaveBeenCalled()
  expect(document.querySelector('.app-loading')).toBeNull()
})
