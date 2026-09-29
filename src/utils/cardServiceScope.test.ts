import { expect, test, vi } from 'vitest'
import { assignedServiceScope, scopeServiceBuildings } from './cardServiceScope'
import { scopedPreviewBuildings } from '../components/assignment/previewData'
import { buildDraftFromServer, draftToAssignments } from '../hooks/assignmentDraft/persistence'
import { draftReducer } from '../hooks/assignmentDraft/reducer'
import type { CalendarEvent } from '../types'

test('실제 배정의 팀 키와 상가 범위가 복원 및 재공유에도 유지된다', () => {
  vi.stubEnv('VITE_DEMO_MODE', 'true')
  try {
    const event = { cardAssignments: [{ userName: 'A', teamKey: 'stable', assignedCardIds: [3], cardScope: '상가' }] } as CalendarEvent
    const draft = buildDraftFromServer(event)
    expect(draft.teams[0]).toMatchObject({ id: 'stable', cardScope: '상가' })
    expect(draftToAssignments(draft)).toEqual([{ userName: 'A', teamKey: 'stable', cardIds: [3], cardScope: '상가' }])
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
