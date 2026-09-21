import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { testCard } from '../test/territoryFixture'
import { DesktopAdminAssignment } from './DesktopAdminAssignment'

describe('PC 관리자 카드 배정', () => {
  test('선택한 카드에서 선택 인도자만 일괄 해제하고 다른 담당자는 보존한다', async () => {
    const onSetCardLeaders = vi.fn(async () => undefined)
    const cards = [
      testCard(1, '기흥구 구갈동 1', { buildings: 1, units: 1, assignedLeader: '김인도', assignedLeaders: ['김인도', '박인도'] }),
      testCard(2, '기흥구 구갈동 2', { buildings: 1, units: 1, assignedLeader: '김인도', assignedLeaders: ['김인도'] }),
      testCard(3, '기흥구 구갈동 3', { buildings: 1, units: 1, assignedLeader: '박인도', assignedLeaders: ['박인도'] }),
    ]

    render(
      <DesktopAdminAssignment
        cards={cards}
        currentVisitor="관리자"
        leaderNames={['김인도', '박인도']}
        onSetCardLeaders={onSetCardLeaders}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /김인도.*담당 구역 2개/ }))
    fireEvent.click(screen.getByRole('button', { name: '선택 모드' }))
    fireEvent.click(screen.getByRole('button', { name: '전체 선택' }))
    expect(screen.getByRole('button', { name: '전체 선택 해제' })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: '김인도 일괄 해제' }))

    await waitFor(() => expect(onSetCardLeaders).toHaveBeenCalledTimes(2))
    expect(onSetCardLeaders).toHaveBeenCalledWith(1, ['박인도'], { silentSuccess: true })
    expect(onSetCardLeaders).toHaveBeenCalledWith(2, [], { silentSuccess: true })
  })

  test('카드 담당자가 많으면 두 명과 나머지 인원수로 요약한다', () => {
    const leaders = ['가인도', '나인도', '다인도', '라인도', '마인도']
    const card = testCard(1, '기흥구 구갈동 1', {
      buildings: 1,
      units: 1,
      assignedLeader: leaders[0],
      assignedLeaders: leaders,
    })

    const { container } = render(
      <DesktopAdminAssignment
        cards={[card]}
        currentVisitor="관리자"
        leaderNames={leaders}
        onSetCardLeaders={vi.fn()}
      />,
    )

    const row = container.querySelector('.la-card-row') as HTMLElement
    const summary = row.querySelector('.la-assignee-summary') as HTMLElement
    expect(within(summary).getByText('가인도')).toBeVisible()
    expect(within(summary).getByText('나인도')).toBeVisible()
    expect(within(summary).getByText('+3명')).toBeVisible()
    expect(summary.querySelectorAll('.la-assignee-badge')).toHaveLength(2)
    expect(summary).toHaveAttribute('title', leaders.join(', '))
  })
})
