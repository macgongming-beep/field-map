import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import ServiceScopePreview from './ServiceScopePreview'
import { scopedPreviewBuildings } from './previewData'
import type { Building } from '../../types'

vi.mock('../MapCanvas', () => ({
  MapCanvas: ({ buildings }: { buildings: Building[] }) => (
    <div data-testid="preview-map">
      {buildings.flatMap((b) =>
        b.units.map((u) => <span key={u.id}>{u.number}</span>),
      )}
    </div>
  ),
}))

test('혼합 카드에서도 배정 범위 세대만 표시하며 빈 배정은 전체로 확대하지 않는다', () => {
  expect(
    scopedPreviewBuildings([3], '주택')[0].units.map((u) => u.usageType),
  ).toEqual(['주택', '주택'])
  expect(
    scopedPreviewBuildings([3], '상가')[0].units.map((u) => u.usageType),
  ).toEqual(['상가', '상가'])
  expect(scopedPreviewBuildings([], '전체')).toEqual([])
})

test('주택과 비공식을 함께 보여주고 비공식 지도에는 건물 세대를 넘기지 않는다', () => {
  render(<ServiceScopePreview />)
  fireEvent.click(
    screen.getByRole('button', { name: '나의 봉사', exact: true }),
  )
  expect(
    screen.getByRole('heading', { name: '주택 봉사 카드 3개' }),
  ).toBeVisible()
  expect(
    screen.getByRole('heading', { name: '비공식 증거 카드 1개' }),
  ).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: '열기', exact: true }))
  expect(screen.getByTestId('preview-map')).toBeEmptyDOMElement()
})

test('개인 식당 배정은 같은 팀의 다른 사람에게 복제되지 않는다', () => {
  render(<ServiceScopePreview />)
  fireEvent.click(screen.getByRole('button', { name: '식당', exact: true }))
  fireEvent.change(screen.getByRole('combobox'), {
    target: { value: '예시 김민수' },
  })
  fireEvent.click(screen.getAllByRole('checkbox')[0])
  fireEvent.click(screen.getByRole('button', { name: '나의 봉사 미리보기 →' }))
  expect(
    screen.getByRole('heading', { name: '내 식당 배정 1곳' }),
  ).toBeVisible()
  fireEvent.change(screen.getByRole('combobox', { name: '봉사자' }), {
    target: { value: '예시 이서연' },
  })
  expect(
    screen.queryByRole('heading', { name: /내 식당 배정/ }),
  ).not.toBeInTheDocument()
})

test('범위 변경 취소 시 선택 카드와 봉사 범위를 유지한다', () => {
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
  render(<ServiceScopePreview />)
  fireEvent.click(screen.getByRole('button', { name: '상가', exact: true }))
  expect(confirm).toHaveBeenCalledOnce()
  expect(
    screen.getByRole('button', { name: '주택', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByRole('button', { name: '카드 3' })).toBeVisible()
  confirm.mockRestore()
})
