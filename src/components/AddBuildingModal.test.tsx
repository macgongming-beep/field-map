// 모달 자체의 동작. 조립 테스트(DesktopTerritory.addBuilding)가 안 덮는 것들이다.
//
// 좌표 찾기는 사용자가 저장 전에 눌러 확인하는 단계다. 여기가 깨지면
// "핀 없이 생성됩니다" 를 못 보고 저장해 버린다 — 지도에 안 뜨는 건물이 생긴다.
import { describe, test, expect, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AddBuildingModal } from './AddBuildingModal'
import { testCard } from '../test/territoryFixture'

/** 원할 때 응답시키는 지오코더. 경쟁 상태를 만들려면 순서를 우리가 쥐어야 한다. */
function deferredGeocoder() {
  const pending: Array<{ address: string; resolve: (v: unknown) => void }> = []
  const fn = vi.fn((address: string) => new Promise((resolve) => { pending.push({ address, resolve }) }))
  return { fn, pending }
}

function setup(geocode: ReturnType<typeof vi.fn>) {
  const onSubmit = vi.fn(async () => true)
  const onClose = vi.fn()
  render(
    <AddBuildingModal
      cards={[testCard(1, '수지구 죽전동 1')]}
      onClose={onClose}
      onGeocode={geocode}
      onSubmit={onSubmit}
    />,
  )
  return { onSubmit, onClose }
}

const address = () => screen.getByRole('textbox', { name: '주소' })

describe('AddBuildingModal — 좌표 찾기', () => {
  test('찾으면 좌표를 보여 준다', async () => {
    const user = userEvent.setup()
    setup(vi.fn(async () => ({ lat: 37.12345, lng: 127.6789 })))

    await user.type(address(), '경기도 용인시 수지구 죽전동 1')
    await user.click(screen.getByRole('button', { name: '좌표 찾기' }))

    expect(await screen.findByText(/좌표 확인/)).toBeTruthy()
    expect(screen.getByText(/37\.12345/)).toBeTruthy()
  })

  test('못 찾으면 핀 없이 생성된다고 알린다', async () => {
    const user = userEvent.setup()
    setup(vi.fn(async () => null))

    await user.type(address(), '없는 주소')
    await user.click(screen.getByRole('button', { name: '좌표 찾기' }))

    expect(await screen.findByText(/핀 없이 건물이 생성됩니다/)).toBeTruthy()
  })

  test('주소를 고치면 찾아 둔 좌표를 버린다', async () => {
    const user = userEvent.setup()
    setup(vi.fn(async () => ({ lat: 37.5, lng: 127.1 })))

    await user.type(address(), '첫 주소')
    await user.click(screen.getByRole('button', { name: '좌표 찾기' }))
    expect(await screen.findByText(/좌표 확인/)).toBeTruthy()

    // 옛 좌표가 남아 있으면 엉뚱한 자리에 핀이 꽂힌다
    await user.type(address(), '2')
    expect(screen.queryByText(/좌표 확인/)).toBeNull()
  })

  test('주소가 비면 좌표 찾기를 못 누른다', () => {
    setup(vi.fn())
    expect(screen.getByRole('button', { name: '좌표 찾기' })).toHaveProperty('disabled', true)
  })

  test('이미 찾은 좌표가 있으면 저장할 때 다시 찾지 않는다', async () => {
    const user = userEvent.setup()
    const geocode = vi.fn(async () => ({ lat: 37.5, lng: 127.1 }))
    const { onSubmit } = setup(geocode)

    await user.type(address(), '경기도 용인시 수지구 죽전동 1')
    await user.click(screen.getByRole('button', { name: '좌표 찾기' }))
    await screen.findByText(/좌표 확인/)
    await user.click(screen.getByRole('button', { name: '건물 추가' }))

    expect(geocode).toHaveBeenCalledTimes(1)
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ address: '경기도 용인시 수지구 죽전동 1' }),
      { lat: 37.5, lng: 127.1 },
    )
  })

  test('카드를 직접 고르면 그대로 넘긴다', async () => {
    const user = userEvent.setup()
    const { onSubmit } = setup(vi.fn(async () => null))

    await user.type(address(), '어딘가')
    await user.selectOptions(screen.getByDisplayValue('자동 (주소 기준)'), '1')
    await user.click(screen.getByRole('button', { name: '건물 추가' }))

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ cardId: 1 }), null)
  })
})

describe('AddBuildingModal — 늦게 온 결과 / 예외 / 저장 중', () => {
  test('주소를 바꾸면, 뒤늦게 온 옛 주소 좌표를 쓰지 않는다', async () => {
    const user = userEvent.setup()
    const geo = deferredGeocoder()
    const { onSubmit } = setup(geo.fn as never)

    // A 주소로 검색을 시작해 두고 (아직 응답 안 옴)
    await user.type(address(), 'A동 1')
    await user.click(screen.getByRole('button', { name: '좌표 찾기' }))
    expect(geo.pending).toHaveLength(1)

    // 응답 전에 주소를 B 로 바꾼다
    await user.clear(address())
    await user.type(address(), 'B동 2')

    // 이제야 A 결과가 도착한다
    await act(async () => { geo.pending[0].resolve({ lat: 11, lng: 11 }) })

    // A 좌표가 화면에 붙으면 안 된다
    expect(screen.queryByText(/좌표 확인/)).toBeNull()

    // B 를 검색해 저장하면 B 좌표여야 한다
    await user.click(screen.getByRole('button', { name: '좌표 찾기' }))
    await act(async () => { geo.pending[1].resolve({ lat: 22, lng: 22 }) })
    await user.click(screen.getByRole('button', { name: '건물 추가' }))

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ address: 'B동 2' }),
      { lat: 22, lng: 22 },
    )
  })

  test('저장이 예외를 던져도 "추가 중..." 에 갇히지 않는다', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn(async () => { throw new Error('네트워크 끊김') })
    render(
      <AddBuildingModal
        cards={[testCard(1, '수지구 죽전동 1')]}
        onClose={vi.fn()}
        onGeocode={vi.fn(async () => ({ lat: 37.5, lng: 127.1 }))}
        onSubmit={onSubmit as never}
      />,
    )

    await user.type(address(), '어딘가')
    await user.click(screen.getByRole('button', { name: '건물 추가' }))

    // 버튼이 다시 눌리는 상태로 돌아와야 한다
    expect(await screen.findByRole('button', { name: '건물 추가' })).toHaveProperty('disabled', false)
    expect((address() as HTMLInputElement).value).toBe('어딘가')   // 입력도 살아 있어야
  })

  test('지오코딩이 예외를 던져도 저장은 진행된다 (핀 없이)', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn(async () => true)
    render(
      <AddBuildingModal
        cards={[]}
        onClose={vi.fn()}
        onGeocode={vi.fn(async () => { throw new Error('지도 SDK 없음') })}
        onSubmit={onSubmit}
      />,
    )

    await user.type(address(), '어딘가')
    await user.click(screen.getByRole('button', { name: '건물 추가' }))

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ address: '어딘가' }), null)
  })

  test('저장 중에는 취소·닫기로 창을 닫을 수 없다', async () => {
    const user = userEvent.setup()
    let release: (v: boolean) => void = () => {}
    const onClose = vi.fn()
    render(
      <AddBuildingModal
        cards={[]}
        onClose={onClose}
        onGeocode={vi.fn(async () => ({ lat: 37.5, lng: 127.1 }))}
        onSubmit={vi.fn(() => new Promise<boolean>((r) => { release = r }))}
      />,
    )

    await user.type(address(), '어딘가')
    await user.click(screen.getByRole('button', { name: '건물 추가' }))

    // 저장이 끝나기 전 — 닫으면 결과를 아무도 못 본다.
    // 취소 버튼은 disabled 로 막히고, 배경 클릭은 requestClose 가 막는다.
    await user.click(screen.getByRole('button', { name: '취소' }))
    const backdrop = document.querySelector('.cal-modal-backdrop') as HTMLElement
    await user.click(backdrop)
    expect(onClose).not.toHaveBeenCalled()

    await act(async () => { release(true) })
    expect(onClose).toHaveBeenCalled()
  })
})
