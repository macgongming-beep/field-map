import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { lazy, StrictMode, Suspense } from 'react'
import { readFileSync } from 'node:fs'
import { afterEach, expect, test, vi } from 'vitest'
import { AppLoading, AppScreenReady } from './AppLoading'

const apply = vi.hoisted(() => vi.fn())
vi.mock('../lib/pwa', () => ({ applyUpdate: apply }))

function installBootShell() {
  const html = new DOMParser().parseFromString(readFileSync('index.html', 'utf8'), 'text/html')
  const root = document.importNode(html.getElementById('root')!, true)
  document.body.appendChild(root)
  return { root, container: root.querySelector<HTMLElement>('#app-content')!, logo: root.querySelector('.app-loading-mark')! }
}

afterEach(() => {
  cleanup()
  document.getElementById('root')?.remove()
  vi.useRealTimers()
  apply.mockReset()
})

test('React mounts beside the original logo and keeps that same node through keyed startup stages', () => {
  const { root, container, logo } = installBootShell()
  const entry = readFileSync('src/main.tsx', 'utf8')
  expect(entry).toContain("createRoot(document.getElementById('app-content')!)")
  const view = render(<StrictMode><AppLoading key="guest" startup /></StrictMode>, { container })
  for (const key of ['authenticated', 'data', 'screen']) {
    view.rerender(<StrictMode><AppLoading key={key} kind="screen" startup /></StrictMode>)
    expect(root.querySelector('.app-loading-mark')).toBe(logo)
    expect(logo.isConnected).toBe(true)
    expect(root.querySelectorAll('.app-loading-mark')).toHaveLength(1)
    expect(screen.getByRole('status', { name: '화면 구성 불러오는 중...' })).toBeTruthy()
  }
})

test('the original logo survives suspended screen loading and disappears only when the screen commits', async () => {
  const { root, container, logo } = installBootShell()
  let resolve!: (value: { default: () => React.ReactNode }) => void
  const Page = lazy(() => new Promise<{ default: () => React.ReactNode }>(r => { resolve = r }))
  const onReady = vi.fn()
  const view = render(<Suspense fallback={<AppLoading startup />}><Page /><AppScreenReady onReady={onReady} /></Suspense>, { container })
  expect(root.querySelector('.app-loading-mark')).toBe(logo)
  expect(onReady).not.toHaveBeenCalled()
  await act(async () => resolve({ default: () => <div>home ready</div> }))
  expect(screen.getByText('home ready')).toBeTruthy()
  expect(logo.isConnected).toBe(false)
  expect(root.querySelector('#app-startup')).toBeNull()
  expect(onReady).toHaveBeenCalledOnce()
  view.rerender(<AppLoading kind="screen" />)
  expect(root.querySelector('.app-loading-mark')).toBeNull()
  expect(screen.getByRole('status').textContent).toContain('화면 구성')
})

test('slow and failed startup use the persistent shell for accessible recovery, not a second logo', async () => {
  vi.useFakeTimers()
  const { root, container, logo } = installBootShell()
  const view = render(<AppLoading startup />, { container })
  await act(() => vi.advanceTimersByTimeAsync(12_000))
  expect(screen.getByRole('button', { name: '앱 다시 불러오기' }).closest('#app-startup')).not.toBeNull()
  expect(apply).not.toHaveBeenCalled()
  view.rerender(<AppLoading startup failed />)
  expect(screen.getByRole('status').textContent).toContain('자료를 불러오지 못했습니다.')
  apply.mockRejectedValue(new Error('offline'))
  await act(async () => fireEvent.click(screen.getByRole('button')))
  expect(screen.getByRole('alert').textContent).toContain('잠시 후')
  expect(root.querySelector('.app-loading-mark')).toBe(logo)
  expect(root.querySelectorAll('.app-loading-mark')).toHaveLength(1)
})

test('standalone error and shared screens can dismiss startup without an App session callback', () => {
  const { root, container } = installBootShell()
  render(<><div role="alert">failed page</div><AppScreenReady /></>, { container })
  expect(root.querySelector('#app-startup')).toBeNull()
  expect(screen.getByRole('alert').textContent).toBe('failed page')
})
