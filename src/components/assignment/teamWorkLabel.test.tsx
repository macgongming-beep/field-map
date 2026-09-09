// 팀 줄 밑에 무엇을 적는지. 다른 일정의 배정이 섞이면 안 된다.
import { describe, test, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TeamBuildScreen } from './TeamBuildScreen'
import type { EventInformalAssignment, EventRestaurantAssignment } from '../../types'

const TEAM = { id: 't1', name: '팀 1', members: ['가나다'], cardIds: [] as number[], color: '#000' }

const renderScreen = (over: {
  eventId: number
  informal?: EventInformalAssignment[]
  restaurant?: EventRestaurantAssignment[]
  guests?: string[]
}) =>
  render(
    <TeamBuildScreen
      eventId={over.eventId}
      participants={['가나다']}
      guests={over.guests}
      teams={[TEAM] as never}
      cards={[] as never}
      canEdit
      dispatch={vi.fn()}
      onOpenTeamZones={vi.fn()}
      informalAssets={[{ id: 32, name: '경희대(홈플러스)' }] as never}
      eventInformalAssignments={over.informal ?? []}
      eventRestaurantAssignments={over.restaurant ?? []}
      buildings={[{ id: 1596, name: '신구로 20' }] as never}
    />,
  )

describe('팀 줄 밑 글자', () => {
  test('이 일정의 비공식 배정은 보여 준다', () => {
    renderScreen({
      eventId: 342,
      informal: [{ eventId: 342, userName: '가나다', assetId: 32 } as EventInformalAssignment],
    })
    expect(screen.getByText(/경희대\(홈플러스\)/)).toBeTruthy()
  })

  test('⚠ **다른 일정**의 비공식 배정은 안 보여 준다', () => {
    // 실제로 있었던 일: 일정 394 의 비공식 배정이 오늘(342) 팀에 붙어 보였다
    renderScreen({
      eventId: 342,
      informal: [{ eventId: 394, userName: '가나다', assetId: 32 } as EventInformalAssignment],
    })
    expect(screen.queryByText(/경희대/)).toBeNull()
    expect(screen.getByText(/구역 미배정/)).toBeTruthy()
  })

  test('⚠ **다른 일정**의 식당 배정도 안 보여 준다', () => {
    // 일정 543 의 식당 배정('신구로 20')이 오늘 팀에 붙어 보였다
    renderScreen({
      eventId: 342,
      restaurant: [{ eventId: 543, userName: '가나다', buildingId: 1596 } as EventRestaurantAssignment],
    })
    expect(screen.queryByText(/신구로 20/)).toBeNull()
    expect(screen.getByText(/구역 미배정/)).toBeTruthy()
  })

  test('아무것도 없으면 구역 미배정', () => {
    renderScreen({ eventId: 342 })
    expect(screen.getByText(/구역 미배정/)).toBeTruthy()
  })

  test('손님은 글자 배지 없이 파란 테두리 상태만 붙는다', () => {
    renderScreen({ eventId: 342, guests: ['가나다'] })
    const guest = screen.getByRole('button', { name: '가나다, 손님' })
    expect(guest.classList.contains('is-guest')).toBe(true)
    expect(screen.queryByText('손님')).toBeNull()
  })
})
