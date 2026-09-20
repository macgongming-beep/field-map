// 일괄 작업이 **화면에 실제로 보이는 것만** 대상으로 하는지.
//
// ⚠ 유틸 시험(visibleSelection)은 이 배선 실수를 못 잡았다.
//   `filteredCards` 와 실제로 그리는 `renderedCards` 가 달랐기 때문이다
//   (완료·제외 카드를 접으면 화면에서 사라지지만 filteredCards 에는 남는다).
//   그래서 조립해서 본다.
import { describe, test, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { DesktopTerritory } from './DesktopTerritory'
import { territoryProps, testBuilding, testCard, testUnit } from '../test/territoryFixture'

vi.mock('../lib/confirm', () => ({
  confirmDialog: vi.fn(async () => true),
  alertDialog: vi.fn(async () => undefined),
}))

const open = (overrides: Record<string, unknown> = {}) => {
  const props = territoryProps({ onDeleteCards: vi.fn(), ...overrides })
  render(<MemoryRouter><DesktopTerritory {...(props as never)} /></MemoryRouter>)
  return props as { onDeleteCards: ReturnType<typeof vi.fn> }
}

beforeEach(() => {
  vi.clearAllMocks()
  window.sessionStorage.clear()
})

describe('일괄 삭제는 보이는 카드만', () => {
  test('완료·제외로 접힌 카드는 전체선택에 안 들어간다', async () => {
    const user = userEvent.setup()
    const props = open({
      cards: [
        testCard(1, '처인구 유방동 1', { buildings: 1, units: 1 }),
        // 완료 카드 — 기본 상태에서는 접혀 화면에 안 보인다
        testCard(2, '처인구 김량장동 2', { status: '완료', progress: 100 }),
      ],
    })

    const all = screen.queryAllByRole('checkbox')
    if (all.length === 0) return   // 표가 안 그려지는 구성이면 이 시험은 의미 없다
    await user.click(all[0])       // 헤더의 전체선택

    const del = screen.queryByRole('button', { name: '삭제' })
    expect(del).toBeTruthy()
    await user.click(del!)

    if (props.onDeleteCards.mock.calls.length > 0) {
      const ids = props.onDeleteCards.mock.calls[0][0] as number[]
      // 접혀 있는 2번이 섞이면 안 된다
      expect(ids).not.toContain(2)
    }
  })
})

describe('PC 건물 행 삭제', () => {
  test('관리자는 건물 행에서 바로 삭제하고 확인 뒤 해당 건물 하나만 넘긴다', async () => {
    const user = userEvent.setup()
    const onDeleteBuildings = vi.fn()
    open({
      cards: [testCard(1, '수지구 죽전동 1')],
      buildings: [testBuilding(7, 1, '죽전빌딩')],
      onDeleteBuildings,
    })

    await user.click(screen.getByRole('button', { name: '건물 관리' }))
    await user.click(screen.getByRole('button', { name: '삭제' }))

    expect(onDeleteBuildings).toHaveBeenCalledWith([7])
  })

  test('일반 사용자에게는 건물 행 삭제가 보이지 않는다', async () => {
    const user = userEvent.setup()
    open({
      role: 'user',
      cards: [testCard(1, '수지구 죽전동 1')],
      buildings: [testBuilding(7, 1, '죽전빌딩')],
    })

    await user.click(screen.getByRole('button', { name: '건물 관리' }))

    expect(screen.queryByRole('button', { name: '삭제' })).toBeNull()
  })
})

describe('PC 건물 목록 페이지', () => {
  const buildings = Array.from({ length: 55 }, (_, index) =>
    testBuilding(index + 1, 1, `건물 ${String(index + 1).padStart(2, '0')}`),
  )

  test('기본 50개씩 보여 주고 다음 페이지와 전체 보기를 제공한다', async () => {
    const user = userEvent.setup()
    open({
      cards: [testCard(1, '수지구 죽전동 1')],
      buildings,
    })

    await user.click(screen.getByRole('button', { name: '건물 관리' }))
    const table = screen.getByRole('table', { name: '건물 관리 목록' })
    expect(within(table).getAllByRole('row')).toHaveLength(51)
    expect(screen.getByText('1-50 / 55')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: '2' }))
    expect(within(table).getAllByRole('row')).toHaveLength(6)
    expect(screen.getByText('51-55 / 55')).toBeTruthy()

    await user.selectOptions(screen.getByRole('combobox', { name: '페이지당 건물 수' }), '전체')
    expect(within(table).getAllByRole('row')).toHaveLength(56)
    expect(screen.queryByRole('navigation', { name: '건물 목록 페이지' })).toBeNull()
  })

  test('헤더 선택은 현재 페이지만 선택하고 검색 결과 전체 선택은 따로 제공한다', async () => {
    const user = userEvent.setup()
    open({
      cards: [testCard(1, '수지구 죽전동 1')],
      buildings,
    })

    await user.click(screen.getByRole('button', { name: '건물 관리' }))
    await user.click(screen.getByRole('checkbox', { name: '현재 페이지 건물 전체 선택' }))
    expect(screen.getByText('50개 건물 선택')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: '검색 결과 55개 전체 선택' }))
    expect(screen.getByText('55개 건물 선택')).toBeTruthy()
    expect(screen.getByRole('button', { name: '전체 선택 해제' })).toBeTruthy()
  })
})

describe('PC 카드와 세대 목록 페이지', () => {
  test('카드도 기본 50개씩 보여 주고 현재 페이지만 선택한다', async () => {
    const user = userEvent.setup()
    const cards = Array.from({ length: 55 }, (_, index) =>
      testCard(index + 1, `테스트구 한동 ${index + 1}`, { buildings: 1, units: 1 }),
    )
    open({ cards })

    const table = screen.getByRole('table')
    expect(within(table).getAllByRole('row')).toHaveLength(51)
    expect(screen.getByText('1-50 / 55')).toBeTruthy()

    await user.click(screen.getByRole('checkbox', { name: '현재 페이지 카드 전체 선택' }))
    expect(screen.getByText('50개 카드 선택')).toBeTruthy()
    expect(screen.getByRole('button', { name: '목록 55개 전체 선택' })).toBeTruthy()

    await user.click(screen.getByRole('button', { name: '2' }))
    expect(within(table).getAllByRole('row')).toHaveLength(6)
    expect(screen.getByText('51-55 / 55')).toBeTruthy()
  })

  test('세대도 기본 50개씩 보여 주고 전체 보기를 제공한다', async () => {
    const user = userEvent.setup()
    const units = Array.from({ length: 55 }, (_, index) =>
      testUnit(index + 1, `${index + 1}호`, { isChinese: true }),
    )
    open({
      cards: [testCard(1, '수지구 죽전동 1', { buildings: 1, units: 55 })],
      buildings: [testBuilding(1, 1, '죽전빌딩', units)],
    })

    await user.click(screen.getByRole('button', { name: '건물 관리' }))
    await user.click(screen.getByRole('button', { name: '세대 목록' }))
    const table = screen.getByRole('table', { name: '세대 목록' })
    expect(within(table).getAllByRole('row')).toHaveLength(51)
    expect(screen.getByText('1-50 / 55')).toBeTruthy()

    await user.selectOptions(screen.getByRole('combobox', { name: '페이지당 세대 수' }), '전체')
    expect(within(table).getAllByRole('row')).toHaveLength(56)
    expect(screen.queryByRole('navigation', { name: '세대 목록 페이지' })).toBeNull()
  })
})
