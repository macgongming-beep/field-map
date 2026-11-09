import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { Login } from './Login'

afterEach(cleanup)
test.each(['ko', 'zh', 'en'] as const)('retry hint in %s follows the current ID, survives PIN edits and never disables submit', (language) => {
  const { container, rerender } = render(<Login language={language} onChangeLanguage={vi.fn()}
    onLogin={vi.fn()} onSignup={vi.fn()} loginRetryHintFor="member" />)
  const id = container.querySelector<HTMLInputElement>('#login-id')!
  const pin = container.querySelector<HTMLInputElement>('#pin')!
  expect(screen.queryByRole('status')).toBeNull()
  fireEvent.change(id, { target: { value: 'member' } })
  fireEvent.change(pin, { target: { value: 'changed-password' } })
  expect(screen.getByRole('status').textContent).toContain('15')
  expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(false)
  fireEvent.change(id, { target: { value: 'another' } })
  expect(screen.queryByRole('status')).toBeNull()
  fireEvent.change(id, { target: { value: 'member' } })
  rerender(<Login language={language} onChangeLanguage={vi.fn()} onLogin={vi.fn()} onSignup={vi.fn()} loginRetryHintFor={null} />)
  expect(screen.queryByRole('status')).toBeNull()
})
