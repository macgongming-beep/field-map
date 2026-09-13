import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { DesktopProfileSettings } from './DesktopProfileSettings'

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: { group_name: null } }),
        }),
      }),
    }),
  },
}))

afterEach(cleanup)

describe('PC 내 정보 언어 설정', () => {
  test('세 언어를 표시하고 선택을 상위 저장 함수에 전달한다', () => {
    const onChangeLanguage = vi.fn()

    render(
      <DesktopProfileSettings
        language="ko"
        onChangeLanguage={onChangeLanguage}
        onChangePin={vi.fn()}
        onUpdateProfile={vi.fn()}
        user={{ id: 1, loginId: 'user', name: '사용자', role: 'user' }}
      />,
    )

    expect(screen.getByRole('button', { name: '한국어' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: '简体中文' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'English' }))

    expect(onChangeLanguage).toHaveBeenCalledWith('en')
  })
})
