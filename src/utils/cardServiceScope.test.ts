import { expect, test, vi } from 'vitest'
import { assignedServiceScope, scopeServiceBuildings } from './cardServiceScope'
import { scopedPreviewBuildings } from '../components/assignment/previewData'
import { buildDraftFromServer, draftToAssignments } from '../hooks/assignmentDraft/persistence'
import { draftReducer } from '../hooks/assignmentDraft/reducer'
import type { CalendarEvent } from '../types'

test('개별 카드 진입은 배정 범위 안에서만 좁히고 봉사 형태를 유지한다', () => {
  const event = { cardAssignments: [{ userName: 'A', assignedCardIds: [1, 3], cardScope: '상가' }] } as CalendarEvent
  expect(assignedServiceScope(event, 'A')).toEqual({ ids: [1, 3], scope: '상가' })
  expect(assignedServiceScope(event, 'A', 3)).toEqual({ ids: [3], scope: '상가' })
  expect(assignedServiceScope(event, 'A', 999).ids).toEqual([])
  expect(assignedServiceScope(event, 'A', NaN).ids).toEqual([])
})

test('실제 배정의 팀 키와 상가 범위가 복원 및 재공유에도 유지된다', () => {
  vi.stubEnv('VITE_DEMO_MODE', 'true')
  try {
    const event = { cardAssignments: [{ userName: 'A', teamKey: 'stable', assignedCardIds: [3], cardScope: '상가' }] } as CalendarEvent
    const draft = buildDraftFromServer(event)
    expect(draft.teams[0]).toMatchObject({ id: 'stable', cardScope: '상가' })
    expect(draftToAssignments(draft)).toEqual([{ userName: 'A', teamKey: 'stable', cardIds: [3], cardScope: '상가', informalAssetIds: [] }])
    const scoped = assignedServiceScope(event, 'A')
    const buildings = scopeServiceBuildings(scopedPreviewBuildings([1, 3], '전체'), scoped.ids, scoped.scope)
    expect(buildings).toHaveLength(1)
    expect(buildings[0].units.map((u) => u.usageType)).toEqual(['상가', '상가'])
    expect(assignedServiceScope(event, 'B').ids).toEqual([])
    expect(scopeServiceBuildings(buildings, [], '전체')).toEqual([])
    const changed = draftReducer({ draft, activeTeamId: 'stable', undo: null }, { type: 'SET_CARD_SCOPE', teamId: 'stable', scope: '주택', cardIds: [] })
    expect(changed.draft.teams[0]).toMatchObject({ cardScope: '주택', cardIds: [] })
    expect(draftReducer(changed, { type: 'UNDO' }).draft).toEqual(draft)
  } finally { vi.unstubAllEnvs() }
})

// ── 나의 봉사 지도: 빈 건물과 봉사 유형 ────────────────────────────────
// 방금 추가한 건물은 세대가 0개다. 예전에는 걸러진 세대 수로 판정해서
// 주택·상가 봉사에서 그 건물을 버렸고, 첫 세대 등록으로 넘어가지 못했다.
import type { Building } from '../types'

const unit = (id: number, patch: Partial<Building['units'][number]> = {}) =>
  ({ id, number: `${id}호`, status: '미방문', ...patch }) as Building['units'][number]
const building = (id: number, cardId: number, type: Building['type'], units: Building['units']) =>
  ({ id, cardId, type, name: `건물${id}`, address: `주소${id}`, units }) as Building
const ids = (list: Building[]) => list.map((b) => b.id)
const map = { includeEmptyOfScopeType: true }

test('주택 봉사 지도에 빈 주택 건물이 보인다', () => {
  expect(ids(scopeServiceBuildings([building(1, 10, '주택', [])], [10], '주택', map))).toEqual([1])
})

test('주택 봉사 지도에 빈 상가 건물은 보이지 않는다 — 유형이 다르다', () => {
  expect(ids(scopeServiceBuildings([building(1, 10, '상가', [])], [10], '주택', map))).toEqual([])
})

test('상가 세대만 있는 주택 건물은 빈 건물이 아니다 — 주택 봉사에서 보이지 않는다', () => {
  // 걸러지고 나면 세대가 0개라 빈 건물처럼 보인다. 원래 세대로 판정해야 한다.
  const onlyShops = building(1, 10, '주택', [unit(1, { usageType: '상가' }), unit(2, { isRestaurant: true })])
  expect(ids(scopeServiceBuildings([onlyShops], [10], '주택', map))).toEqual([])
})

test('혼합 건물은 봉사 유형의 세대만 남긴다', () => {
  const mixed = building(1, 10, '주택', [unit(1), unit(2, { usageType: '상가' }), unit(3, { isRestaurant: true })])
  const [house] = scopeServiceBuildings([mixed], [10], '주택', map)
  const [shop] = scopeServiceBuildings([mixed], [10], '상가', map)
  expect(house.units.map((u) => u.id)).toEqual([1])
  expect(shop.units.map((u) => u.id)).toEqual([2, 3])
})

test('배정 밖 카드의 빈 건물은 지도에도 보이지 않는다', () => {
  expect(ids(scopeServiceBuildings([building(1, 99, '주택', [])], [10], '주택', map))).toEqual([])
})

test('전체 봉사는 빈 건물과 모든 세대를 그대로 보여 준다', () => {
  const list = [building(1, 10, '상가', []), building(2, 10, '주택', [unit(1), unit(2, { usageType: '상가' })])]
  const scoped = scopeServiceBuildings(list, [10], '전체', map)
  expect(ids(scoped)).toEqual([1, 2])
  expect(scoped[1].units.map((u) => u.id)).toEqual([1, 2])
})

test("'출입불가' 가짜 세대만 있는 건물은 빈 건물로 본다", () => {
  const legacy = building(1, 10, '주택', [unit(1, { number: '출입불가' })])
  expect(ids(scopeServiceBuildings([legacy], [10], '주택', map))).toEqual([1])
})

test('배정 화면 계약은 그대로다 — 옵션이 없으면 빈 건물만 있는 카드는 주택·상가 범위에 안 잡힌다', () => {
  // 배정 화면은 이 함수로 "이 범위에 넣을 수 있는 카드" 를 정한다. 여기서 빈 건물을
  // 넣으면 빈 건물만 있는 카드가 주택 범위로 잡혀 배정 범위가 바뀐다.
  const list = [building(1, 10, '주택', []), building(2, 20, '주택', [unit(1)])]
  expect(scopeServiceBuildings(list, [10, 20], '주택').map((b) => b.cardId)).toEqual([20])
  expect(scopeServiceBuildings(list, [10, 20], '상가')).toEqual([])
})
