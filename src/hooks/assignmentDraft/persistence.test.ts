import { describe, it, expect, beforeEach } from 'vitest'
import {
  draftToAssignments,
  buildDraftFromServer,
  buildEmptyDraft,
  saveLocalDraft,
  loadLocalDraft,
  clearLocalDraft,
  resolveDraftEntry,
} from './persistence'
import type { AssignmentDraft } from './types'
import type { CalendarEvent } from '../../types'

function ev(over: Partial<CalendarEvent>): CalendarEvent {
  return {
    id: 1,
    cardAssignments: [],
    assignmentStatus: 'draft',
    assignmentSharedAt: null,
    ...over,
  } as CalendarEvent
}

function draft(teams: AssignmentDraft['teams']): AssignmentDraft {
  return { mode: 'card', status: 'draft', updatedAt: null, teams }
}

it('unpublished local draft detects server revision changes even when both sharing dates are null',()=>{
  const event=ev({assignmentRevision:'10'})
  const local=buildDraftFromServer(event)
  saveLocalDraft(1,'Revision Tester',local)
  expect(resolveDraftEntry(event,'Revision Tester').kind).not.toBe('conflict')
  expect(resolveDraftEntry({...event,assignmentRevision:'11'},'Revision Tester').kind).toBe('conflict')
  clearLocalDraft(1,'Revision Tester')
})

describe('공유 배정 (여러 팀이 같은 구역) 왕복', () => {
  it('두 팀이 같은 카드를 맡아도 저장 형식에 각자 보존된다 (teamKey 포함)', () => {
    const d = draft([
      { id: 'a', name: '팀 1', color: 'blue', order: 0, cardIds: [10, 11], members: ['김민준'] },
      { id: 'b', name: '팀 2', color: 'green', order: 1, cardIds: [10], members: ['이영희'] },
    ])
    expect(draftToAssignments(d)).toEqual([
      { userName: '김민준', cardIds: [10, 11], teamKey: 'a' },
      { userName: '이영희', cardIds: [10], teamKey: 'b' },
    ])
  })

  it('카드 구성이 완전히 같은 두 팀도 teamKey 로 나뉘어 복원된다 (합쳐지지 않음)', () => {
    // 실제 사례: 1팀·2팀이 똑같이 풍덕천12 만 맡았는데 한 팀으로 합쳐지던 문제
    const restored = buildDraftFromServer(ev({
      cardAssignments: [
        { userName: '김민준', assignedCardIds: [10], teamKey: 'a' },
        { userName: '이영희', assignedCardIds: [10], teamKey: 'b' },
      ],
    } as Partial<CalendarEvent>))
    expect(restored.teams).toHaveLength(2)
    expect(restored.teams.find((t) => t.members.includes('김민준'))!.cardIds).toEqual([10])
    expect(restored.teams.find((t) => t.members.includes('이영희'))!.cardIds).toEqual([10])
  })

  it('서버 복원 시에도 공유 배정이 유지된다 (카드 구성이 다르면 다른 팀)', () => {
    const restored = buildDraftFromServer(ev({
      cardAssignments: [
        { userName: '김민준', assignedCardIds: [10, 11] },
        { userName: '이영희', assignedCardIds: [10] },
      ],
    } as Partial<CalendarEvent>))
    const teamOf = (name: string) => restored.teams.find((t) => t.members.includes(name))!
    expect(teamOf('김민준').cardIds).toEqual([10, 11])
    expect(teamOf('이영희').cardIds).toEqual([10])
    expect(teamOf('김민준').id).not.toBe(teamOf('이영희').id)
  })

  it('teamKey 없는 옛 데이터는 카드 구성으로 묶인다 (하위호환 폴백)', () => {
    const restored = buildDraftFromServer(ev({
      cardAssignments: [
        { userName: '김민준', assignedCardIds: [10] },
        { userName: '이영희', assignedCardIds: [10] },
      ],
    } as Partial<CalendarEvent>))
    expect(restored.teams).toHaveLength(1)
    expect(restored.teams[0].members).toEqual(['김민준', '이영희'])
  })
})

describe('draftToAssignments', () => {
  it('각 팀원이 그 팀의 cardIds 를 받는다', () => {
    const d = draft([
      { id: 'a', name: '팀 1', color: 'blue', order: 0, cardIds: [10, 20], members: ['김민준', '이영희'] },
      { id: 'b', name: '팀 2', color: 'green', order: 1, cardIds: [30], members: ['박상철'] },
    ])
    expect(draftToAssignments(d)).toEqual([
      { userName: '김민준', cardIds: [10, 20], teamKey: 'a' },
      { userName: '이영희', cardIds: [10, 20], teamKey: 'a' },
      { userName: '박상철', cardIds: [30], teamKey: 'b' },
    ])
  })

  it('멤버 없는 팀은 결과에 없음', () => {
    const d = draft([{ id: 'a', name: '팀 1', color: 'blue', order: 0, cardIds: [10], members: [] }])
    expect(draftToAssignments(d)).toEqual([])
  })
})

describe('buildDraftFromServer', () => {
  it('같은 cardIds 가진 사람끼리 한 팀으로 묶는다', () => {
    const event = ev({
      assignmentStatus: 'shared',
      assignmentSharedAt: '2026-06-01T00:00:00Z',
      cardAssignments: [
        { userName: '김민준', assignedCardIds: [10, 20] },
        { userName: '이영희', assignedCardIds: [10, 20] },
        { userName: '박상철', assignedCardIds: [30] },
      ],
    } as Partial<CalendarEvent>)
    const d = buildDraftFromServer(event)
    expect(d.teams).toHaveLength(2)
    const t1 = d.teams.find((t) => t.cardIds.join(',') === '10,20')!
    expect(t1.members.sort()).toEqual(['김민준', '이영희'])
    expect(d.status).toBe('shared')
  })

  it('assignedCardId(단수) 폴백 처리', () => {
    const event = ev({
      assignmentStatus: 'shared',
      cardAssignments: [{ userName: '김민준', assignedCardId: 99 }],
    } as Partial<CalendarEvent>)
    const d = buildDraftFromServer(event)
    expect(d.teams[0].cardIds).toEqual([99])
  })

  it('buildEmptyDraft 는 빈 teams', () => {
    expect(buildEmptyDraft().teams).toEqual([])
  })
})

describe('localStorage 왕복', () => {
  beforeEach(() => localStorage.clear())

  it('save → load 라운드트립', () => {
    const d = draft([{ id: 'a', name: '팀 1', color: 'blue', order: 0, cardIds: [1], members: ['김민준'] }])
    expect(saveLocalDraft(5, '인도자', d)).toBe(true)
    expect(loadLocalDraft(5, '인도자')).toEqual(d)
  })

  it('깨진 draft 는 버리고 null', () => {
    localStorage.setItem('mobileLeaderAssignmentDraft:5:인도자', '{"teams":"not-array"}')
    expect(loadLocalDraft(5, '인도자')).toBeNull()
  })

  it('clear 후 null', () => {
    saveLocalDraft(5, '인도자', buildEmptyDraft())
    clearLocalDraft(5, '인도자')
    expect(loadLocalDraft(5, '인도자')).toBeNull()
  })
})

describe('resolveDraftEntry — 충돌 판단', () => {
  beforeEach(() => localStorage.clear())

  it('로컬 없음 + 서버 공유 → fresh(서버본)', () => {
    const event = ev({ id: 7, assignmentStatus: 'shared', assignmentSharedAt: '2026-06-01T00:00:00Z' })
    const r = resolveDraftEntry(event, '인도자')
    expect(r.kind).toBe('fresh')
  })

  it('로컬만 있음 → local', () => {
    saveLocalDraft(7, '인도자', buildEmptyDraft())
    const event = ev({ id: 7, assignmentStatus: 'draft' })
    expect(resolveDraftEntry(event, '인도자').kind).toBe('local')
  })

  it('서버가 로컬보다 최신 → conflict', () => {
    saveLocalDraft(7, '인도자', { ...buildEmptyDraft(), updatedAt: '2026-06-01T00:00:00Z' })
    const event = ev({ id: 7, assignmentStatus: 'shared', assignmentSharedAt: '2026-06-02T00:00:00Z' })
    expect(resolveDraftEntry(event, '인도자').kind).toBe('conflict')
  })

  it('로컬이 서버보다 최신 → local', () => {
    saveLocalDraft(7, '인도자', { ...buildEmptyDraft(), updatedAt: '2026-06-03T00:00:00Z' })
    const event = ev({ id: 7, assignmentStatus: 'shared', assignmentSharedAt: '2026-06-02T00:00:00Z' })
    expect(resolveDraftEntry(event, '인도자').kind).toBe('local')
  })
})
