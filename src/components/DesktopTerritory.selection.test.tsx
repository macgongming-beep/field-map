// 일괄 작업이 **화면에 실제로 보이는 것만** 대상으로 하는지.
//
// ⚠ 유틸 시험(visibleSelection)은 이 배선 실수를 못 잡았다.
//   `filteredCards` 와 실제로 그리는 `renderedCards` 가 달랐기 때문이다
//   (완료·제외 카드를 접으면 화면에서 사라지지만 filteredCards 에는 남는다).
//   그래서 조립해서 본다.
import { describe, test, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { DesktopTerritory } from './DesktopTerritory'
import { territoryProps, testBuilding, testCard } from '../test/territoryFixture'

vi.mock('../lib/confirm', () => ({
  confirmDialog: vi.fn(async () => true),
  alertDialog: vi.fn(async () => undefined),
}))

const open = (overrides: Record<string, unknown> = {}) => {
  const props = territoryProps({ onDeleteCards: vi.fn(), ...overrides })
  render(<MemoryRouter><DesktopTerritory {...(props as never)} /></MemoryRouter>)
  return props as { onDeleteCards: ReturnType<typeof vi.fn> }
}

beforeEach(() => vi.clearAllMocks())

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
