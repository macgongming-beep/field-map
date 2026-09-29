import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import { ZoneAssignScreen } from './ZoneAssignScreen'
import { testCard } from '../../test/territoryFixture'

vi.mock('../MapCanvas', () => ({ MapCanvas: () => <div data-testid="assignment-map" /> }))

function renderAssignment() {
  return render(<ZoneAssignScreen
    teams={[{ id: 'team-1', name: '팀 1', color: 'blue', order: 0, cardIds: [], members: ['인도자'] }]}
    activeTeamId="team-1"
    cards={[
      testCard(1, '처인구 고림동 1', { region: '처인구', area: '고림동' }),
      testCard(2, '기흥구 구갈동 1', { region: '기흥구', area: '구갈동' }),
    ]}
    buildings={[]} cardBoundaries={[]} canEdit dispatch={vi.fn()}
    eventId={1} currentVisitor="인도자" onBack={vi.fn()}
    informalAssets={[{ id: 10, name: '경희대', kind: '비공식구역', imageUrl: '', imagePath: '',
      uploadedBy: '인도자', createdAt: '', archived: false, groupId: null }]}
  />)
}

test('카드는 지도로 시작하고 비공식과 식당은 지도 토글 없는 목록으로 전환한다', () => {
  const { container } = renderAssignment()
  expect(screen.getByTestId('assignment-map')).toBeVisible()
  for (const tab of ['비공식', '식당']) {
    fireEvent.click(screen.getByRole('button', { name: tab, exact: true }))
    expect(screen.queryByTestId('assignment-map')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '지도', exact: true })).not.toBeInTheDocument()
    expect(container.querySelector('.asg-zone')).not.toHaveClass('is-map-view')
  }
  fireEvent.click(screen.getByRole('button', { name: '카드', exact: true }))
  expect(screen.getByTestId('assignment-map')).toBeVisible()
})

test('목록에서도 지역을 골라 카드를 좁히고 지도와 목록 전환 후 선택을 유지한다', () => {
  renderAssignment()
  fireEvent.click(screen.getByRole('button', { name: '목록', exact: true }))
  fireEvent.click(screen.getByRole('button', { name: '처인구 1' }))
  expect(screen.getByText('처인구 고림동 1')).toBeVisible()
  expect(screen.queryByText('기흥구 구갈동 1')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '지도', exact: true }))
  fireEvent.click(screen.getByRole('button', { name: '목록', exact: true }))
  expect(screen.getByRole('button', { name: '처인구 1' })).toHaveAttribute('aria-pressed', 'true')
  fireEvent.click(screen.getByRole('button', { name: '전체 2' }))
  expect(screen.getByText('기흥구 구갈동 1')).toBeVisible()
})

test('사진 없는 비공식 카드는 공용 종류 아이콘을 사용한다', () => {
  const { container } = renderAssignment()
  fireEvent.click(screen.getByRole('button', { name: '비공식', exact: true }))
  fireEvent.click(screen.getByText('미분류'))
  expect(screen.getByText('경희대')).toBeVisible()
  expect(container.querySelector('.asg-informal-icon svg')).toBeInTheDocument()
  expect(container.textContent).not.toContain('🖼️')
})
