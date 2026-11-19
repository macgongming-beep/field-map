// 카드를 만든 뒤 "구역선 그릴까요?" 를 묻는 흐름을 못 박는다.
//
// 이 테스트는 **모달을 떼어내기 전에** 쓴 것이다. 추출 뒤에도 그대로 통과해야
// 한다. 그래야 "안 깨졌다" 를 말로가 아니라 확인으로 말할 수 있다.
//
// 두 층으로 본다 (모달만 그리면 배선 실수를 못 잡는다).
//   ① 조립  — 카드 추가 → 생성 → 제안이 뜨고 → 버튼이 부모 콜백까지 닿는가
//   ② 단위  — 제안 모달 자체의 선택지 (나중에 / 그리기 / 바깥 클릭)
import { describe, test, expect, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { DesktopTerritory } from './DesktopTerritory'
import { AuthContext } from '../hooks/AuthContext'
import { authFixture } from '../test/authFixture'
import { territoryProps } from '../test/territoryFixture'
import { setRegions } from '../lib/regions'

const NEW_AREA_LABEL = '+ 새 동 직접 입력'

// 이 화면의 label 은 htmlFor 로 컨트롤과 묶여 있지 않다. getByLabelText 가 안 먹는다.
// 접근성 관점에선 고쳐야 할 일이지만, 지금은 추출 작업 중이라 화면을 건드리지 않는다.
// 대신 label 이 든 .cal-field 안에서 컨트롤을 찾는다. (별도 과제로 남긴다)
function field(scope: HTMLElement, labelText: string): HTMLElement {
  const label = within(scope).getByText(labelText, { selector: 'label' })
  const control = label.closest('.cal-field')?.querySelector('select, input')
  if (!control) throw new Error(`'${labelText}' 에 딸린 입력을 못 찾았다`)
  return control as HTMLElement
}

beforeEach(() => {
  setRegions([
    { id: 1, name: '수지구', city: '용인시', sortOrder: 1, nameZh: '', nameEn: '' },
  ])
})

function renderTerritory(overrides: Record<string, unknown> = {}) {
  const props = territoryProps(overrides)
  render(<MemoryRouter><AuthContext.Provider value={authFixture()}><DesktopTerritory {...(props as never)} /></AuthContext.Provider></MemoryRouter>)
  return props
}

/** 카드 추가 모달을 열고 새 동으로 카드를 하나 만든다 */
async function createCard(user: ReturnType<typeof userEvent.setup>, area = '죽전동') {
  await user.click(screen.getByRole('button', { name: '+ 카드 추가' }))
  const dialog = screen.getByText('생성될 카드 이름').closest('.cal-modal') as HTMLElement
  await user.selectOptions(field(dialog, '동'), NEW_AREA_LABEL)
  await user.type(field(dialog, '새 동 이름'), area)
  await user.click(within(dialog).getByRole('button', { name: '카드 생성' }))
}

describe('카드 생성 → 구역선 제안', () => {
  test('카드를 만들면 구역선 제안이 뜬다', async () => {
    const user = userEvent.setup()
    const props = renderTerritory()

    await createCard(user)

    expect(props.onCreateCard).toHaveBeenCalledWith(
      expect.objectContaining({ region: '수지구', area: '죽전동' }),
    )
    expect(await screen.findByText('카드 생성 완료')).toBeTruthy()
    // 어느 카드인지 이름이 보여야 한다
    expect(screen.getByText('수지구 죽전동 1')).toBeTruthy()
  })

  test('"구역선 그리기" 는 지도를 편집 모드로 연다', async () => {
    const user = userEvent.setup()
    const props = renderTerritory({ onCreateCard: async () => 42 })

    await createCard(user)
    await user.click(await screen.findByRole('button', { name: '구역선 그리기' }))

    // 두 번째 인자 true 가 "구역선 편집으로 열기" 다. 이게 빠지면 그냥 지도만 열린다.
    expect(props.onOpenCardMap).toHaveBeenCalledWith(42, true)
    expect(screen.queryByText('카드 생성 완료')).toBeNull()
  })

  test('"나중에" 는 아무것도 열지 않고 닫는다', async () => {
    const user = userEvent.setup()
    const props = renderTerritory()

    await createCard(user)
    await user.click(await screen.findByRole('button', { name: '나중에' }))

    expect(props.onOpenCardMap).not.toHaveBeenCalled()
    expect(screen.queryByText('카드 생성 완료')).toBeNull()
  })

  test('카드를 못 만들면 제안이 뜨지 않는다', async () => {
    const user = userEvent.setup()
    renderTerritory({ onCreateCard: async () => null })

    await createCard(user)

    expect(screen.queryByText('카드 생성 완료')).toBeNull()
  })
})
