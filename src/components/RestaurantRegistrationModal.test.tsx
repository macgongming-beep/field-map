import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { RestaurantRegistrationModal } from './RestaurantRegistrationModal'
import type { Building } from '../types'

const searchPlacesAndAddressesForCongregation = vi.hoisted(() => vi.fn())
vi.mock('../lib/placeSearch', async (importOriginal) => ({
  ...await importOriginal<typeof import('../lib/placeSearch')>(),
  searchPlacesAndAddressesForCongregation,
}))

const buildings = [{
  id: 7, cardId: 1, name: '우정원', address: '용인시 우정원길 1', type: '상가',
  lat: 0, lng: 0, warning: false, isRestaurant: false,
  units: [{ id: 70, buildingId: 7, number: '기존식당', status: '미방문', isChinese: false, isRestaurant: true, memo: '' }],
}] as Building[]

describe('RestaurantRegistrationModal', () => {
  beforeEach(() => searchPlacesAndAddressesForCongregation.mockReset())
  it('새 상가와 식당 이름을 함께 넘긴다', async () => {
    const onRegister = vi.fn().mockResolvedValue(true)
    const onClose = vi.fn()
    render(<RestaurantRegistrationModal buildings={buildings} onRegister={onRegister} onClose={onClose} />)
    fireEvent.change(screen.getByLabelText('식당 이름'), { target: { value: '새 식당' } })
    fireEvent.click(screen.getByRole('button', { name: '검색 결과에 없나요? 주소 직접 입력' }))
    fireEvent.change(screen.getByLabelText('주소'), { target: { value: '용인시 새길 2' } })
    fireEvent.click(screen.getByRole('button', { name: '등록' }))
    await waitFor(() => expect(onRegister).toHaveBeenCalledWith({
      name: '새 식당', address: '용인시 새길 2', existingBuildingId: null,
      isChinese: true, initialState: '미방문', regularVisitor: null,
    }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('직접 입력한 주소에 기존 건물이 하나면 자동으로 세대를 추가한다', async () => {
    const onRegister = vi.fn().mockResolvedValue(true)
    render(<RestaurantRegistrationModal buildings={buildings} onRegister={onRegister} onClose={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('식당 이름'), { target: { value: '두번째 식당' } })
    fireEvent.click(screen.getByRole('button', { name: '검색 결과에 없나요? 주소 직접 입력' }))
    fireEvent.change(screen.getByLabelText('주소'), { target: { value: '용인시 우정원길 1' } })
    expect(screen.getByText('기존 건물을 자동으로 찾았습니다.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '등록' }))
    await waitFor(() => expect(onRegister).toHaveBeenCalledWith({
      name: '두번째 식당', address: '용인시 우정원길 1', existingBuildingId: 7,
      isChinese: true, initialState: '미방문', regularVisitor: null,
    }))
  })

  it('저장 실패 시 입력을 유지하고 다시 시도할 수 있다', async () => {
    const onRegister = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    render(<RestaurantRegistrationModal buildings={[]} onRegister={onRegister} onClose={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('식당 이름'), { target: { value: '다시 식당' } })
    fireEvent.click(screen.getByRole('button', { name: '검색 결과에 없나요? 주소 직접 입력' }))
    fireEvent.change(screen.getByLabelText('주소'), { target: { value: '용인시 다시길 3' } })
    fireEvent.click(screen.getByRole('button', { name: '등록' }))
    await screen.findByRole('alert')
    expect((screen.getByLabelText('식당 이름') as HTMLInputElement).value).toBe('다시 식당')
    fireEvent.click(screen.getByRole('button', { name: '등록' }))
    await waitFor(() => expect(onRegister).toHaveBeenCalledTimes(2))
  })

  it('정기방문은 담당자를 받고 중국어 여부와 함께 넘긴다', async () => {
    localStorage.setItem('currentVisitor', '김진수')
    const onRegister = vi.fn().mockResolvedValue(true)
    render(<RestaurantRegistrationModal buildings={[]} onRegister={onRegister} onClose={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('식당 이름'), { target: { value: '정기 식당' } })
    fireEvent.click(screen.getByRole('button', { name: '검색 결과에 없나요? 주소 직접 입력' }))
    fireEvent.change(screen.getByLabelText('주소'), { target: { value: '용인시 새길 4' } })
    fireEvent.change(screen.getByLabelText('현재 상태'), { target: { value: '정기방문' } })
    fireEvent.click(screen.getByLabelText('중국어를 사용하는 식당'))
    fireEvent.click(screen.getByRole('button', { name: '등록' }))
    await waitFor(() => expect(onRegister).toHaveBeenCalledWith(expect.objectContaining({
      initialState: '정기방문', regularVisitor: '김진수', isChinese: false,
    })))
  })

  it('새 건물·기존 건물 라디오 없이 주소로 기존 건물을 자동 연결한다', () => {
    render(<RestaurantRegistrationModal buildings={buildings} onRegister={vi.fn()} onClose={vi.fn()} />)
    expect(screen.queryByRole('radio')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '검색 결과에 없나요? 주소 직접 입력' }))
    fireEvent.change(screen.getByLabelText('주소'), { target: { value: '우정원길 1' } })
    expect(screen.getByText('기존 건물을 자동으로 찾았습니다.')).toBeTruthy()
    expect(screen.getByText('우정원 · 용인시 우정원길 1')).toBeTruthy()
  })

  it('네이버 후보에서 등록 여부를 보여주고 고른 좌표를 등록에 사용한다', async () => {
    searchPlacesAndAddressesForCongregation.mockResolvedValue({ ok: true, places: [
      { name: '기존식당', address: '용인시 우정원길 1', category: '중식', lat: 37.2, lng: 127.2 },
      { name: '새 식당', address: '용인시 새길 8', category: '중식', lat: 37.3, lng: 127.3 },
    ] })
    const onRegister = vi.fn().mockResolvedValue(true)
    render(<RestaurantRegistrationModal buildings={buildings} onRegister={onRegister} onClose={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('식당 이름'), { target: { value: '식당' } })
    fireEvent.click(screen.getByRole('button', { name: '검색' }))
    expect(await screen.findByText('이미 등록됨')).toBeTruthy()
    expect((screen.getByRole('button', { name: /기존식당/ }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: /새 식당/ }))
    expect(screen.getByText('새 건물로 등록합니다.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '등록' }))
    await waitFor(() => expect(onRegister).toHaveBeenCalledWith(expect.objectContaining({
      name: '새 식당', address: '용인시 새길 8', lat: 37.3, lng: 127.3,
    })))
  })

  it('같은 주소의 건물이 여러 개면 선택 전까지 등록을 막는다', async () => {
    const duplicated = [
      buildings[0],
      { ...buildings[0], id: 8, name: '우정원 별관', units: [] },
    ] as Building[]
    searchPlacesAndAddressesForCongregation.mockResolvedValue({ ok: true, places: [
      { name: '새 식당', address: '용인시 우정원길 1', category: '중식', lat: 37.2, lng: 127.2 },
    ] })
    const onRegister = vi.fn().mockResolvedValue(true)
    render(<RestaurantRegistrationModal buildings={duplicated} onRegister={onRegister} onClose={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('식당 이름'), { target: { value: '새 식당' } })
    fireEvent.click(screen.getByRole('button', { name: '검색' }))
    fireEvent.click(await screen.findByRole('button', { name: /새 식당/ }))

    expect(screen.getByText('같은 주소의 건물이 여러 개입니다.')).toBeTruthy()
    expect((screen.getByRole('button', { name: '등록' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: /우정원 별관/ }))
    fireEvent.click(screen.getByRole('button', { name: '등록' }))
    await waitFor(() => expect(onRegister).toHaveBeenCalledWith(expect.objectContaining({ existingBuildingId: 8 })))
  })

  it('정기방문 담당자는 승인된 사용자 목록에서 대신 지정할 수 있다', () => {
    localStorage.setItem('currentVisitor', '현재 사용자')
    render(<RestaurantRegistrationModal buildings={[]} visitorNames={['현재 사용자', '다른 방문자']} onRegister={vi.fn()} onClose={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('현재 상태'), { target: { value: '정기방문' } })
    const select = screen.getByLabelText('정기방문 담당자') as HTMLSelectElement
    expect(select.value).toBe('현재 사용자')
    fireEvent.change(select, { target: { value: '다른 방문자' } })
    expect(select.value).toBe('다른 방문자')
  })

  it('도로명 주소도 같은 검색창에서 찾고 식당 이름은 따로 받는다', async () => {
    searchPlacesAndAddressesForCongregation.mockResolvedValue({ ok: true, places: [{
      name: '언동로 213',
      address: '경기도 용인시 기흥구 언동로 213',
      category: '주소',
      lat: 37.2,
      lng: 127.2,
      source: 'address',
    }] })
    render(<RestaurantRegistrationModal buildings={[]} onRegister={vi.fn()} onClose={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('식당 이름'), { target: { value: '언동로213' } })
    fireEvent.click(screen.getByRole('button', { name: '검색' }))
    fireEvent.click(await screen.findByRole('button', { name: /언동로 213/ }))

    expect((screen.getByLabelText('식당 이름') as HTMLInputElement).value).toBe('')
    expect((screen.getByLabelText('식당 이름') as HTMLInputElement).placeholder).toBe('식당 이름을 입력하세요')
    expect(screen.getByText('주소를 확인했습니다. 식당 이름을 입력하면 등록할 수 있습니다.')).toBeTruthy()
    expect(screen.getByText('경기도 용인시 기흥구 언동로 213')).toBeTruthy()
    expect(screen.getByText('새 건물로 등록합니다.')).toBeTruthy()
    expect((screen.getByRole('button', { name: '등록' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('식당 이름'), { target: { value: '테스트 식당' } })
    expect(screen.queryByText('주소를 확인했습니다. 식당 이름을 입력하면 등록할 수 있습니다.')).toBeNull()
    expect((screen.getByRole('button', { name: '등록' }) as HTMLButtonElement).disabled).toBe(false)
  })
})
