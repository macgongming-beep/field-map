import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { SpecialPeriodSettings } from './SpecialPeriodSettings'

describe('특별봉사 시즌 날짜 입력', () => {
  it('기간 일수 대신 시작일과 종료일을 직접 저장한다', async () => {
    const user = userEvent.setup()
    const onCreate = vi.fn()
    render(<SpecialPeriodSettings isAdmin onCreateSpecialPeriod={onCreate} />)

    await user.click(screen.getByRole('button', { name: /새 시즌/ }))
    expect(screen.queryByText('기간 (일)')).toBeNull()

    await user.type(screen.getByPlaceholderText('예: 봄 특별봉사 2026'), '가을 특별봉사')
    fireEvent.change(screen.getByLabelText('시작일'), { target: { value: '2026-10-03' } })
    fireEvent.change(screen.getByLabelText('종료일'), { target: { value: '2026-10-11' } })
    await user.click(screen.getByRole('button', { name: '시즌 생성' }))

    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({
      label: '가을 특별봉사',
      startDate: '2026-10-03',
      endDate: '2026-10-11',
    }))
  })

  it('시작일을 종료일 뒤로 옮기면 종료일도 같은 날로 맞춘다', async () => {
    const user = userEvent.setup()
    render(<SpecialPeriodSettings isAdmin />)

    await user.click(screen.getByRole('button', { name: /새 시즌/ }))
    fireEvent.change(screen.getByLabelText('종료일'), { target: { value: '2026-10-05' } })
    fireEvent.change(screen.getByLabelText('시작일'), { target: { value: '2026-10-10' } })

    expect((screen.getByLabelText('종료일') as HTMLInputElement).value).toBe('2026-10-10')
  })

  it('서버 저장이 실패하면 입력 창과 작성값을 유지한다', async () => {
    const user = userEvent.setup()
    const onCreate = vi.fn().mockResolvedValue(false)
    render(<SpecialPeriodSettings isAdmin onCreateSpecialPeriod={onCreate} />)

    await user.click(screen.getByRole('button', { name: /새 시즌/ }))
    await user.type(screen.getByPlaceholderText('예: 봄 특별봉사 2026'), '저장 실패 시험')
    fireEvent.change(screen.getByLabelText('종료일'), { target: { value: '2026-10-11' } })
    await user.click(screen.getByRole('button', { name: '시즌 생성' }))

    expect(screen.getByRole('dialog', { name: '새 특별봉사 시즌' })).not.toBeNull()
    expect((screen.getByPlaceholderText('예: 봄 특별봉사 2026') as HTMLInputElement).value).toBe('저장 실패 시험')
  })
})
