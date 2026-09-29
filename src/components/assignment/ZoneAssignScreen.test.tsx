import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import { ZoneAssignScreen } from './ZoneAssignScreen'
import { testCard } from '../../test/territoryFixture'

vi.mock('../MapCanvas', () => ({ MapCanvas: () => <div data-testid="assignment-map" /> }))

function renderAssignment(dispatch = vi.fn()) {
  return render(<ZoneAssignScreen
    teams={[{ id: 'team-1', name: '팀 1', color: 'blue', order: 0, cardIds: [], members: ['인도자'] }]}
    activeTeamId="team-1"
    cards={[
      testCard(1, '처인구 고림동 1', { region: '처인구', area: '고림동' }),
      testCard(2, '기흥구 구갈동 1', { region: '기흥구', area: '구갈동' }),
    ]}
    buildings={[]} cardBoundaries={[]} canEdit dispatch={dispatch}
    eventId={1} currentVisitor="인도자" onBack={vi.fn()}
    informalAssets={[{ id: 10, name: '경희대', kind: '비공식구역', imageUrl: '', imagePath: '',
      uploadedBy: '인도자', createdAt: '', archived: false, groupId: null }]}
  />)
}

test('팀원 헤더를 유지하고 구성 조회는 배분을 변경하지 않는다', () => {
  const dispatch = vi.fn()
  const { container } = renderAssignment(dispatch)
  expect(container.querySelector('.asg-editor-titles')).toHaveTextContent('팀 1 · 인도자')
  expect(screen.queryByText('배분할 팀')).not.toBeInTheDocument()
  expect(container.querySelector('.asg-teambar-card')).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByRole('button', { name: '지도', exact: true })).toHaveAttribute('title', '지도')
  fireEvent.click(screen.getByRole('button', { name: '목록', exact: true }))
  fireEvent.change(screen.getByRole('combobox', { name: '카드 구성' }), { target: { value: '상가' } })
  expect(screen.getByRole('combobox', { name: '카드 구성' })).toHaveValue('상가')
  expect(dispatch).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '비공식', exact: true }))
  expect(screen.queryByRole('combobox', { name: '카드 구성' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '카드', exact: true }))
  expect(screen.getByRole('combobox', { name: '카드 구성' })).toHaveValue('상가')
})

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

test('데모 실제 지도와 목록에서 봉사 형태를 팀 초안에 저장한다', () => {
  vi.stubEnv('VITE_DEMO_MODE', 'true')
  try {
    const dispatch = vi.fn()
    renderAssignment(dispatch)
    expect(screen.queryByText('카드 봉사')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '상가', exact: true }))
    expect(dispatch).toHaveBeenCalledWith({ type: 'SET_CARD_SCOPE', teamId: 'team-1', scope: '상가', cardIds: [] })
    fireEvent.click(screen.getByRole('button', { name: '목록', exact: true }))
    expect(screen.getByRole('button', { name: '주택', exact: true })).toBeVisible()
    expect(screen.queryByRole('combobox', { name: '카드 구성' })).not.toBeInTheDocument()
  } finally { vi.unstubAllEnvs() }
})

test('데모 통합 탭은 비공식에서 돌아와도 같은 봉사 형태를 다시 저장하지 않는다', () => {
  vi.stubEnv('VITE_DEMO_MODE', 'true')
  try {
    const dispatch = vi.fn()
    const { container } = renderAssignment(dispatch)
    expect(screen.queryByRole('button', { name: '카드', exact: true })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '비공식', exact: true }))
    expect(screen.queryByRole('button', { name: '지도', exact: true })).not.toBeInTheDocument()
    expect(screen.getByRole('group', { name: '봉사 형태' })).toBeVisible()
    expect(container.querySelector('.asg-zone-scope-tabs button')).toHaveAttribute('aria-pressed','false')
    fireEvent.click(screen.getByRole('group', { name: '봉사 형태' }).querySelector('button')!)
    expect(screen.getByTestId('assignment-map')).toBeVisible()
    expect(dispatch).not.toHaveBeenCalled()
  } finally { vi.unstubAllEnvs() }
})

test('데모 비공식 선택은 개인 즉시 저장 대신 팀 초안 액션이다', () => {
  vi.stubEnv('VITE_DEMO_MODE', 'true')
  try {
    const dispatch = vi.fn()
    renderAssignment(dispatch)
    fireEvent.click(screen.getByRole('button', { name: '비공식', exact: true }))
    fireEvent.click(screen.getByText('미분류'))
    fireEvent.click(screen.getByText('경희대'))
    expect(dispatch).toHaveBeenCalledExactlyOnceWith({ type: 'TOGGLE_TEAM_INFORMAL', teamId: 'team-1', assetId: 10 })
  } finally { vi.unstubAllEnvs() }
})
