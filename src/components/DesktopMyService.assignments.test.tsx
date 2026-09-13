import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { Building, CalendarEvent, InformalAsset, TerritoryCard } from '../types'
import { DesktopMyService } from './DesktopMyService'

afterEach(() => {
  vi.useRealTimers()
})

describe('PC 나의 봉사 배정', () => {
  test('전시대 신청 일정도 나의 봉사에 표시하고 일반 구역 배정으로 오인하지 않는다', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-06T10:00:00+09:00'))

    const event = {
      id: 12,
      date: '2026-09-06',
      time: '10:00',
      title: '오전 봉사',
      applicants: [],
      assigned: [],
      leaders: [],
      cardAssignments: [],
      cartApplicants: [{ userId: 3, name: '김사용', isTeamLead: true, createdAt: '2026-09-05' }],
    } as unknown as CalendarEvent

    render(
      <DesktopMyService
        language="ko"
        buildings={[]}
        calendarEvents={[event]}
        cards={[]}
        currentVisitor="김사용"
        role="user"
        serviceSessions={[]}
        onOpenMap={vi.fn()}
        onEndServiceSession={vi.fn()}
      />,
    )

    expect(screen.getByText('1개 일정')).toBeTruthy()
    expect(screen.getByText('전시대 · 팀장')).toBeTruthy()
    expect(screen.queryByText('배정된 장소가 없습니다')).toBeNull()
  })

  test('구역·비공식·식당을 한 일정에 합치고 각각 올바른 대상으로 연다', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-06T10:00:00+09:00'))

    const event = {
      id: 11,
      date: '2026-09-06',
      time: '18:00',
      title: '저녁 봉사',
      applicants: ['김사용'],
      assigned: [],
      leaders: [],
      cardAssignments: [{
        id: 101,
        eventId: 11,
        userName: '김사용',
        assignedCardId: 21,
        assignedCardIds: [21],
      }],
    } as unknown as CalendarEvent
    const card = {
      id: 21,
      name: '기흥구 1',
      area: '구갈동',
      units: 10,
      progress: 20,
      assignedUsers: ['김사용'],
    } as unknown as TerritoryCard
    const building = {
      id: 31,
      cardId: 21,
      name: '상가 건물',
      address: '기흥로 31',
      lat: 0,
      lng: 0,
      units: [{ id: 41, number: '중화반점' }],
    } as unknown as Building
    const informal = {
      id: 51,
      name: '시장 비공식 구역',
      memo: '시장 입구부터',
    } as unknown as InformalAsset
    const onOpenMap = vi.fn()
    const onOpenInformalMap = vi.fn()
    const onOpenBuildingMap = vi.fn()

    render(
      <DesktopMyService
        language="ko"
        buildings={[building]}
        calendarEvents={[event]}
        cards={[card]}
        currentVisitor="김사용"
        role="user"
        serviceSessions={[]}
        informalAssets={[informal]}
        eventInformalAssignments={[
          { id: 61, eventId: 11, userName: '김사용', assetId: 51, assignedBy: '관리자', assignedAt: '', memo: '' },
          { id: 62, eventId: 11, userName: '다른사람', assetId: 51, assignedBy: '관리자', assignedAt: '', memo: '' },
        ]}
        eventRestaurantAssignments={[
          { id: 71, eventId: 11, userName: '김사용', buildingId: 31, unitId: 41, assignedBy: '관리자', assignedAt: '', memo: '' },
        ]}
        onOpenMap={onOpenMap}
        onOpenInformalMap={onOpenInformalMap}
        onOpenBuildingMap={onOpenBuildingMap}
        onEndServiceSession={vi.fn()}
      />,
    )

    expect(screen.getByText('3개 배정')).toBeTruthy()
    if (!screen.queryByText('중화반점')) {
      fireEvent.click(screen.getByRole('button', { name: /18:00 저녁 봉사/ }))
    }

    expect(screen.getAllByText('기흥구 1').length).toBeGreaterThan(0)
    expect(screen.getByText('시장 비공식 구역')).toBeTruthy()
    expect(screen.getByText('중화반점')).toBeTruthy()
    expect(screen.getAllByText('시장 비공식 구역')).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: '지도' }))
    fireEvent.click(screen.getByRole('button', { name: '구역 보기' }))
    fireEvent.click(screen.getByRole('button', { name: '길찾기' }))

    expect(onOpenMap).toHaveBeenCalledWith(21)
    expect(onOpenInformalMap).toHaveBeenCalledWith(51)
    expect(onOpenBuildingMap).toHaveBeenCalledWith(31)
  })
})
