import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, test, vi } from 'vitest'
import type { InformalAsset } from '../types'
import { testBuilding, testCard, testUnit, territoryProps } from '../test/territoryFixture'
import { MobileMap } from './MobileMap'

const confirmDialog = vi.hoisted(() => vi.fn().mockResolvedValue(true))
vi.mock('../lib/confirm', () => ({ confirmDialog }))

const parent: InformalAsset = {
  id: 1,
  name: '경희대',
  kind: '비공식구역',
  imageUrl: '',
  imagePath: '',
  uploadedBy: '관리자',
  createdAt: '2026-09-04T00:00:00Z',
  archived: false,
  groupId: null,
}

const child: InformalAsset = {
  ...parent,
  id: 2,
  parentId: 1,
  name: '정자',
  kind: '대화장소',
  memo: '점심시간에 학생들이 많이 지납니다.',
  lat: 37.277,
  lng: 127.118,
}

function renderMap(
  onUpdateInformalPlace?: ReturnType<typeof vi.fn>,
  onDeleteInformalAsset?: ReturnType<typeof vi.fn>,
) {
  const props = {
    language: 'ko',
    buildings: [],
    cardBoundaries: [],
    cards: [],
    currentVisitor: '관리자',
    actualRole: onUpdateInformalPlace ? 'admin' : 'leader',
    serviceSessions: [],
    informalAssets: [parent, child],
    focusedInformalId: 1,
    onUpdateInformalPlace,
    onDeleteInformalAsset,
    focusedCardIds: [],
    onBack: vi.fn(),
    visitHistories: [],
    specialPeriods: [],
    eventRestaurantAssignments: [],
    calendarEvents: [],
  }
  render(<MemoryRouter><MobileMap {...(props as never)} /></MemoryRouter>)
}

describe('모바일 비공식 포인트', () => {
  test('빈 상위 메모 안내는 숨기고 포인트 메모는 크게 읽을 수 있게 보여 준다', () => {
    renderMap()

    expect(screen.queryByText(/메모가 없습니다/)).not.toBeInTheDocument()
    expect(screen.getByText('정자')).toBeVisible()
    expect(screen.getByText('점심시간에 학생들이 많이 지납니다.')).toBeVisible()
  })

  test('관리자는 포인트 이름과 메모를 모바일에서 함께 고친다', async () => {
    const update = vi.fn().mockResolvedValue(true)
    renderMap(update)

    fireEvent.click(screen.getByRole('button', { name: '정자 수정' }))
    fireEvent.change(screen.getByLabelText('메모'), { target: { value: '저녁에는 조용합니다.' } })
    fireEvent.click(screen.getByRole('button', { name: '저장' }))

    await waitFor(() => expect(update).toHaveBeenCalledWith(2, {
      name: '정자',
      memo: '저녁에는 조용합니다.',
    }))
  })

  test('관리자는 포인트 위치를 지도에서 다시 정해 저장한다', async () => {
    const update = vi.fn().mockResolvedValue(true)
    renderMap(update)

    fireEvent.click(screen.getByRole('button', { name: '정자 수정' }))
    fireEvent.click(screen.getByRole('button', { name: '위치 변경' }))
    expect(screen.getByText(/정자 핀을 끌거나 지도를 눌러 옮기세요/)).toBeVisible()

    const map = screen.getByLabelText('샘플 지도')
    map.getBoundingClientRect = () => ({
      x: 0, y: 0, left: 0, top: 0, right: 200, bottom: 200,
      width: 200, height: 200, toJSON: () => ({}),
    })
    fireEvent.click(map, { clientX: 150, clientY: 50 })
    fireEvent.click(screen.getByRole('button', { name: '저장' }))

    await waitFor(() => expect(update).toHaveBeenCalledWith(2, expect.objectContaining({
      lat: expect.any(Number),
      lng: expect.any(Number),
    })))
    const saved = update.mock.calls[0][1]
    expect(saved.lat).not.toBe(child.lat)
    expect(saved.lng).not.toBe(child.lng)
  })

  test('관리자는 확인 후 개별 포인트를 삭제한다', async () => {
    const update = vi.fn().mockResolvedValue(true)
    const remove = vi.fn().mockResolvedValue(true)
    renderMap(update, remove)

    fireEvent.click(screen.getByRole('button', { name: '정자 수정' }))
    fireEvent.click(screen.getByRole('button', { name: '삭제' }))

    await waitFor(() => expect(confirmDialog).toHaveBeenCalledWith(expect.objectContaining({
      title: '포인트 삭제',
      danger: true,
    })))
    await waitFor(() => expect(remove).toHaveBeenCalledWith(2))
  })
})

describe('모바일 세대 상세', () => {
  test('하단 호수 목록을 유지한 채 다른 세대로 이동하고 닫으면 시트 높이를 복원한다', async () => {
    Element.prototype.scrollIntoView = vi.fn()
    const units = [
      testUnit(203, '203호', { isChinese: true }),
      testUnit(204, '204호', { isChinese: true }),
      testUnit(205, '205호', { isChinese: true }),
    ]
    const building = testBuilding(9, 1, '우일빌라G동', units)
    const props = territoryProps({
      actualRole: 'leader',
      currentVisitor: '인도자',
      cards: [testCard(1, '처인구 고림동 9')],
      buildings: [building],
      focusedCardId: 1,
      focusedBuildingId: 9,
      focusedCardIds: [],
      serviceSessions: [],
      specialPeriods: [],
      visitHistories: [{
        id: 1,
        buildingId: 9,
        unitId: 203,
        visitor: '인도자',
        result: '부재',
        visitedAt: '2026-09-05T06:00:00Z',
        timeSlot: '오후',
      }],
      eventRestaurantAssignments: [],
      calendarEvents: [],
      onBack: vi.fn(),
    })

    const { container } = render(<MemoryRouter><MobileMap {...(props as never)} /></MemoryRouter>)
    const sheet = container.querySelector('.mobile-bottom-sheet') as HTMLElement
    await waitFor(() => expect(screen.getByRole('button', { name: /203호/ })).toBeVisible())
    const originalHeight = sheet.style.height

    fireEvent.click(screen.getByRole('button', { name: /203호/ }))
    expect(await screen.findByText('우일빌라G동 203호')).toBeVisible()
    expect(screen.getByText(/다른 호수를 눌러 이동/)).toBeVisible()
    expect(screen.getByRole('button', { name: /방문 시간/ })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByText(/못 만난 시간 · 주말 오후/)).toBeVisible()
    expect(screen.getByRole('button', { name: /203호/ }).closest('.unit-grid-row')).toHaveClass('is-detail-selected')

    fireEvent.click(screen.getByRole('button', { name: '메모' }))
    expect(screen.getByPlaceholderText(/메모를 입력하세요/)).toBeVisible()
    expect(screen.getByRole('button', { name: '메모' })).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(screen.getByRole('button', { name: '메모' }))
    expect(screen.queryByPlaceholderText(/메모를 입력하세요/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /204호/ }))
    expect(await screen.findByText('우일빌라G동 204호')).toBeVisible()
    expect(screen.getByRole('button', { name: /204호/ }).closest('.unit-grid-row')).toHaveClass('is-detail-selected')

    const navigatorHeight = sheet.style.height
    expect(screen.getByRole('combobox', { name: '장소 종류' })).toHaveValue('주택')
    fireEvent.click(screen.getByRole('button', { name: /메모/ }))
    expect(screen.getByLabelText('세대 정보')).toBeVisible()
    expect(screen.getByText('이름·연락처 등 개인정보는 적지 마세요.')).toBeVisible()
    expect(sheet.style.height).toBe('65px')
    fireEvent.click(screen.getByRole('button', { name: '취소' }))
    expect(sheet.style.height).toBe(navigatorHeight)

    fireEvent.click(screen.getByRole('button', { name: '닫기' }))
    await waitFor(() => expect(screen.queryByText('우일빌라G동 204호')).not.toBeInTheDocument())
    expect(sheet.style.height).toBe(originalHeight)
  })

  test('일반 사용자에게는 세대의 장소 종류 설정을 숨긴다', async () => {
    Element.prototype.scrollIntoView = vi.fn()
    const building = testBuilding(9, 1, '우일빌라G동', [testUnit(203, '203호')])
    const props = territoryProps({
      actualRole: 'user',
      currentVisitor: '봉사자',
      cards: [testCard(1, '처인구 고림동 9')],
      buildings: [building],
      focusedCardId: 1,
      focusedBuildingId: 9,
      focusedCardIds: [],
      serviceSessions: [],
      specialPeriods: [],
      visitHistories: [],
      eventRestaurantAssignments: [],
      calendarEvents: [],
      onBack: vi.fn(),
    })

    render(<MemoryRouter><MobileMap {...(props as never)} /></MemoryRouter>)
    fireEvent.click(await screen.findByRole('button', { name: /203호/ }))

    expect(await screen.findByText('우일빌라G동 203호')).toBeVisible()
    expect(screen.queryByRole('combobox', { name: '장소 종류' })).not.toBeInTheDocument()
    expect(screen.getByText('이름·연락처 등 개인정보는 적지 마세요.')).toBeVisible()
  })
})
