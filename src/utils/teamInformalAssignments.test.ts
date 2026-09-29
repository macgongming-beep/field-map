import { afterEach, expect, test, vi } from 'vitest'
import type { CalendarEvent, EventInformalAssignment } from '../types'
import { teamInformalAssignments } from './teamInformalAssignments'
import { buildDraftFromServer, draftToAssignments } from '../hooks/assignmentDraft/persistence'
import { draftReducer } from '../hooks/assignmentDraft/reducer'

afterEach(() => vi.unstubAllEnvs())
const event = {
  id: 12, assignmentTeamInformal: { t1: [9], t2: [10] },
  cardAssignments: [
    { userName: 'A', teamKey: 't1', assignedCardIds: [] },
    { userName: 'B', teamKey: 't1', assignedCardIds: [] },
    { userName: 'C', teamKey: 't2', assignedCardIds: [] },
  ],
} as unknown as CalendarEvent

test('팀원 이동 후 비공식은 사람이 아니라 팀에 남고 지난 개인 배정은 보존된다', () => {
  const old = [{ id: 1, eventId: 12, userName: 'A', assetId: 99 }, { id: 2, eventId: 11, userName: 'A', assetId: 98 }] as EventInformalAssignment[]
  expect(teamInformalAssignments([event], old).map((a) => [a.userName, a.assetId])).toEqual([['A',98],['A',9],['B',9],['C',10]])
  const moved = { ...event, cardAssignments: event.cardAssignments.map((a) => a.userName === 'A' ? { ...a, teamKey: 't2' } : a) }
  expect(teamInformalAssignments([moved], []).filter((a) => a.userName === 'A').map((a) => a.assetId)).toEqual([10])
  expect(teamInformalAssignments([{ ...event, cardAssignments: [] }], old)).toEqual([old[1]])
})

test('비공식만 있는 팀의 선택, 되돌리기, 서버 복원과 재공유', () => {
  vi.stubEnv('VITE_DEMO_MODE','true')
  const draft = buildDraftFromServer(event)
  expect(draft.teams[0].informalAssetIds).toEqual([9])
  const changed = draftReducer({ draft, activeTeamId: 't1', undo: null }, { type: 'TOGGLE_TEAM_INFORMAL', teamId: 't1', assetId: 9 })
  expect(changed.draft.teams[0].informalAssetIds).toEqual([])
  expect(changed.draft.teams[1].informalAssetIds).toEqual([10])
  expect(draftReducer(changed,{type:'UNDO'}).draft).toEqual(draft)
  expect(draftToAssignments(draft).map((a) => [a.userName,a.teamKey,a.informalAssetIds])).toEqual([['A','t1',[9]],['B','t1',[9]],['C','t2',[10]]])
})
