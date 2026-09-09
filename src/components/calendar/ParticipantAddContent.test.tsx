import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import { ParticipantAddContent } from './ParticipantAddContent'

const users = [
  { id: 1, name: '활성 봉사자', approvalStatus: 'approved' as const, isActive: true },
  { id: 2, name: '비활성 계정', approvalStatus: 'approved' as const, isActive: false },
  { id: 3, name: '승인 대기', approvalStatus: 'pending' as const, isActive: true },
]

describe('ParticipantAddContent', () => {
  test('활성·승인 계정만 후보에 표시한다', () => {
    render(<ParticipantAddContent existingNames={[]} onAdd={vi.fn()} users={users} />)

    expect(screen.getByText('활성 봉사자')).toBeTruthy()
    expect(screen.queryByText('비활성 계정')).toBeNull()
    expect(screen.queryByText('승인 대기')).toBeNull()
  })

  test('계정 참가자와 게스트를 서로 다른 역할로 추가한다', async () => {
    const user = userEvent.setup()
    const onAdd = vi.fn().mockResolvedValue(true)
    render(<ParticipantAddContent existingNames={[]} onAdd={onAdd} users={users} />)

    await user.click(screen.getByRole('button', { name: /활성 봉사자/ }))
    expect(onAdd).toHaveBeenCalledWith('활성 봉사자', '신청')

    await user.type(screen.getByRole('textbox', { name: '게스트 이름' }), '새 손님')
    await user.click(screen.getAllByRole('button', { name: '추가' }).at(-1)!)
    expect(onAdd).toHaveBeenCalledWith('새 손님', '게스트')
  })

  test('비활성 계정 이름을 게스트로 우회해 추가하지 않는다', async () => {
    const user = userEvent.setup()
    const onAdd = vi.fn()
    render(<ParticipantAddContent existingNames={[]} onAdd={onAdd} users={users} />)

    await user.type(screen.getByRole('textbox', { name: '게스트 이름' }), '비활성 계정')
    await user.click(screen.getAllByRole('button', { name: '추가' }).at(-1)!)

    expect(onAdd).not.toHaveBeenCalled()
  })

  test('기존 참가자의 공백·대소문자 변형도 게스트 중복으로 막는다', async () => {
    const user = userEvent.setup()
    const onAdd = vi.fn()
    render(<ParticipantAddContent existingNames={['Wang Xiao Ming']} onAdd={onAdd} users={[]} />)

    await user.type(screen.getByRole('textbox', { name: '게스트 이름' }), 'wang   xiao ming')
    await user.click(screen.getAllByRole('button', { name: '추가' }).at(-1)!)

    expect(onAdd).not.toHaveBeenCalled()
  })
})
