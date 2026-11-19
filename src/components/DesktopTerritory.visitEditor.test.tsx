// 세대 방문 기록 편집기. **추출 전에** 쓴 것이다.
//
// 여기서 못 박는 것은 두 가지다.
//   ① 새 기록이냐 수정이냐에 따라 다른 콜백으로 가는가 (섞이면 기록이 덮인다)
//   ② 기본값 — 특히 **세대 메모를 방문 메모에 미리 채우지 않는 것**.
//      예전에 그랬다가 같은 문장이 방문할 때마다 기록에 복제됐다.
import { describe, test, expect, beforeEach, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { DesktopTerritory } from './DesktopTerritory'
import { territoryProps, testBuilding, testCard, testUnit } from '../test/territoryFixture'
import { setRegions } from '../lib/regions'
import type { VisitHistory } from '../types'
import { AuthContext } from '../hooks/AuthContext'
import { authFixture } from '../test/authFixture'

// ⚠ `allUsers` 는 props 가 아니라 `useSharedAuth()` 에서 온다. 이걸 안 채우면
//   방문자 목록이 비어 **칸 자체가 안 그려지고**, 시험이 헛돈다.
function editorAuth() {
  return authFixture({
    allUsers: [
      { id: 1, name: '박진호', loginId: 'admin', created_at: '', role: 'admin', approvalStatus: 'approved' },
      { id: 2, name: '정찬양', loginId: 'member', created_at: '', role: 'user', approvalStatus: 'approved' },
    ],
  })
}

vi.mock('../lib/naverGeocode', () => ({
  geocodeFirstMatch: vi.fn(async () => null),
  geocodeQuery: vi.fn(async () => null),
  isNaverMapsReady: () => true,
}))

// 세대 목록은 기본이 '중국어' 필터다 (이 앱은 중국어 봉사 구역을 다룬다).
// 실제 화면과 같은 조건으로 둔다.
const unit = testUnit(11, '101호', { status: '미방문', isChinese: true })
const building = testBuilding(1, 1, '언동로빌라', [unit])

beforeEach(() => {
  setRegions([{ id: 1, name: '수지구', city: '용인시', sortOrder: 1, nameZh: '', nameEn: '' }])
  sessionStorage.clear()
})

function open(overrides: Record<string, unknown> = {}) {
  const props = territoryProps({
    cards: [testCard(1, '수지구 죽전동 1')],
    buildings: [building],
    ...overrides,
  })
  render(<MemoryRouter><AuthContext.Provider value={editorAuth()}><DesktopTerritory {...(props as never)} /></AuthContext.Provider></MemoryRouter>)
  return props
}

/** 건물 관리 → 세대 목록 → 세대 고르기 */
async function selectUnit(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: '건물 관리' }))
  await user.click(screen.getByRole('button', { name: '세대 목록' }))
  const rows = screen.getAllByRole('row').filter((r) => r.className.includes('point-management-row'))
  await user.click(rows[0])
}

const editor = () => screen.getByText(/방문 기록 (등록|수정)/, { selector: 'h2' }).closest('.cal-modal') as HTMLElement

describe('방문 기록 편집기', () => {
  test('새 기록은 onAddVisitHistory 로 간다', async () => {
    const user = userEvent.setup()
    const props = open()

    await selectUnit(user)
    await user.click(screen.getByRole('button', { name: '+ 방문 기록 추가' }))
    await user.click(within(editor()).getByRole('button', { name: '저장' }))

    expect(props.onAddVisitHistory).toHaveBeenCalledWith(
      building.id, unit.id,
      expect.objectContaining({ result: '미방문', memo: '' }),
    )
    expect(props.onUpdateVisitHistory).not.toHaveBeenCalled()
  })

  test('세대 메모를 방문 메모에 미리 채우지 않는다', async () => {
    const user = userEvent.setup()
    const withMemo = testBuilding(1, 1, '언동로빌라', [testUnit(11, '101호', { memo: '개 조심', isChinese: true })])
    open({ buildings: [withMemo] })

    await selectUnit(user)
    await user.click(screen.getByRole('button', { name: '+ 방문 기록 추가' }))

    // 미리 채우면 같은 문장이 방문할 때마다 기록에 복제된다
    const memo = within(editor()).getByPlaceholderText(/메모/) as HTMLTextAreaElement
    expect(memo.value).toBe('')
  })

  test('날짜를 비우면 저장을 못 누른다', async () => {
    const user = userEvent.setup()
    open()

    await selectUnit(user)
    await user.click(screen.getByRole('button', { name: '+ 방문 기록 추가' }))
    const date = within(editor()).getByDisplayValue(/^\d{4}-\d{2}-\d{2}$/)
    await user.clear(date)

    expect(within(editor()).getByRole('button', { name: '저장' })).toHaveProperty('disabled', true)
  })

  test('고른 값이 그대로 저장된다', async () => {
    const user = userEvent.setup()
    const props = open()

    await selectUnit(user)
    await user.click(screen.getByRole('button', { name: '+ 방문 기록 추가' }))
    const box = editor()
    await user.type(within(box).getByPlaceholderText(/메모/), '부재')
    await user.click(within(box).getByRole('button', { name: '저장' }))

    expect(props.onAddVisitHistory).toHaveBeenCalledWith(
      building.id, unit.id, expect.objectContaining({ memo: '부재' }),
    )
  })
})

describe('중복 저장', () => {
  test('저장을 두 번 눌러도 기록은 하나만 생긴다', async () => {
    const user = userEvent.setup()
    const props = open()

    await selectUnit(user)
    await user.click(screen.getByRole('button', { name: '+ 방문 기록 추가' }))
    const btn = within(editor()).getByRole('button', { name: '저장' })
    await user.click(btn)
    // 저장에 성공하면 편집기가 닫힌다. 두 번째 클릭은 사라진 버튼을 누르는 셈이다.
    await user.click(btn).catch(() => {})

    expect(props.onAddVisitHistory).toHaveBeenCalledTimes(1)
  })

  test('저장이 실패하면 창을 닫지 않는다 — 적은 내용을 지킨다', async () => {
    const user = userEvent.setup()
    open({ onAddVisitHistory: vi.fn(async () => false) })

    await selectUnit(user)
    await user.click(screen.getByRole('button', { name: '+ 방문 기록 추가' }))
    await user.type(within(editor()).getByPlaceholderText(/메모/), '잃으면 안 되는 메모')
    await user.click(within(editor()).getByRole('button', { name: '저장' }))

    const memo = within(editor()).getByPlaceholderText(/메모/) as HTMLTextAreaElement
    expect(memo.value).toBe('잃으면 안 되는 메모')
  })
})

describe('방문 기록 수정 — 새 기록과 갈리는 지점', () => {
  const history: VisitHistory = {
    id: 900, unitId: unit.id, visitor: '김민준', result: '부재',
    timeSlot: '오후', memo: '벨 안 눌림', visitedAt: '2026-08-01',
  } as VisitHistory

  test('기존 기록을 고치면 onUpdateVisitHistory 로 간다', async () => {
    const user = userEvent.setup()
    const props = open({ visitHistories: [history] })

    await selectUnit(user)
    await user.click(screen.getByRole('button', { name: '방문 기록 작업' }))
    const popover = document.querySelector('.point-history-menu-popover') as HTMLElement
    await user.click(within(popover).getByRole('button', { name: '수정' }))

    // 기존 값이 채워져 있어야 한다 — 비어 있으면 고치는 순간 내용이 날아간다
    const box = editor()
    expect(within(box).getByDisplayValue('2026-08-01')).toBeTruthy()
    expect((within(box).getByPlaceholderText(/메모/) as HTMLTextAreaElement).value).toBe('벨 안 눌림')

    await user.click(within(box).getByRole('button', { name: '저장' }))

    // 여기가 갈림길이다. 새 기록으로 가면 같은 방문이 두 건으로 남는다.
    expect(props.onUpdateVisitHistory).toHaveBeenCalledWith(
      history.id, unit.id,
      expect.objectContaining({ result: '부재', memo: '벨 안 눌림', visitedAt: '2026-08-01' }),
    )
    expect(props.onAddVisitHistory).not.toHaveBeenCalled()
  })
})

describe('방문자 고치기 (조립)', () => {
  // ⚠ 이 묶음이 필요한 이유: 편집기 단위 시험은 `initial.visitor` 를 **직접** 넣어
  //   통과했지만, 정작 화면이 그 값을 안 넘기고 있었다. 그래서 실제로는
  //   현재 방문자가 안 보이고 첫 항목이 고른 것처럼 보였다 —
  //   **열었다 저장만 해도 남의 기록이 되는** 상태였다. 리뷰가 잡았다.
  const history: VisitHistory = {
    id: 900, unitId: 11, visitor: '정찬양', result: '부재',
    timeSlot: '오후', visitedAt: '2026-08-30', memo: '',
  } as VisitHistory

  const openEdit = async (user: ReturnType<typeof userEvent.setup>) => {
    await selectUnit(user)
    const menuBtn = screen.getByRole('button', { name: '방문 기록 작업' })
    await user.click(menuBtn)
    // ⚠ '수정' 버튼은 화면에 여럿이다. **그 기록의 팝오버 안**에서 고른다
    const popover = menuBtn.closest('.point-history-menu') as HTMLElement
    await user.click(within(popover).getByRole('button', { name: '수정' }))
  }

  test('⚠ 편집기에 **현재 방문자**가 들어간다', async () => {
    const user = userEvent.setup()
    open({ visitHistories: [history] })
    await openEdit(user)

    const select = within(editor()).getByDisplayValue('정찬양') as HTMLSelectElement
    expect(select.value).toBe('정찬양')
  })

  test('안 건드리고 저장하면 원래 방문자 그대로 나간다', async () => {
    const user = userEvent.setup()
    const props = open({ visitHistories: [history] })
    await openEdit(user)
    await user.click(within(editor()).getByRole('button', { name: '저장' }))

    expect(props.onUpdateVisitHistory).toHaveBeenCalledWith(
      900, 11, expect.objectContaining({ visitor: '정찬양' }),
    )
  })
})
