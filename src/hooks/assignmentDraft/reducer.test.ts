import { describe, it, expect } from 'vitest'
import { draftReducer } from './reducer'
import type { AssignmentDraft, DraftState, DraftTeam } from './types'

function team(over: Partial<DraftTeam> = {}): DraftTeam {
  return { id: 't1', name: '팀 1', color: 'blue', order: 0, cardIds: [], members: [], ...over }
}

function makeState(teams: DraftTeam[], activeTeamId: string | null = teams[0]?.id ?? null): DraftState {
  const draft: AssignmentDraft = { mode: 'card', status: 'draft', updatedAt: null, teams }
  return { draft, activeTeamId, undo: null }
}

describe('draftReducer — 팀', () => {
  it('CREATE_TEAM: 선택 멤버로 새 팀 생성 + 활성화', () => {
    const s = makeState([])
    const next = draftReducer(s, { type: 'CREATE_TEAM', members: ['김민준', '이영희'] })
    expect(next.draft.teams).toHaveLength(1)
    expect(next.draft.teams[0].members).toEqual(['김민준', '이영희'])
    expect(next.activeTeamId).toBe(next.draft.teams[0].id)
  })

  it('CREATE_TEAM: 새 팀 멤버는 기존 팀에서 빠진다 (한 사람 한 팀)', () => {
    const s = makeState([team({ id: 'a', members: ['김민준', '박상철'] })])
    const next = draftReducer(s, { type: 'CREATE_TEAM', members: ['김민준'] })
    const teamA = next.draft.teams.find((t) => t.id === 'a')!
    expect(teamA.members).toEqual(['박상철'])
    expect(next.draft.teams).toHaveLength(2)
  })

  it('CREATE_TEAM: 빈 번호를 재사용하고 번호 사이에 표시한다', () => {
    const s = makeState([team({ id: 'a', name: '팀 1' }), team({ id: 'b', name: '팀 3' })])
    const next = draftReducer(s, { type: 'CREATE_TEAM', members: [] })
    expect(next.draft.teams.map((t) => t.name)).toEqual(['팀 1', '팀 2', '팀 3'])
    expect(next.draft.teams.map((t) => t.order)).toEqual([0, 1, 2])
  })

  it('팀 2 삭제 후 새 팀을 묶어도 남은 팀의 ID와 배정은 바뀌지 않는다', () => {
    const teams = Array.from({ length: 6 }, (_, i) => team({ id: `t${i + 1}`, name: `팀 ${i + 1}`, order: i, members: [`멤버${i + 1}`], cardIds: [i + 10] }))
    const removed = draftReducer(makeState(teams), { type: 'DELETE_TEAM', teamId: 't2' })
    const next = draftReducer(removed, { type: 'CREATE_TEAM', members: ['새 멤버'] })
    expect(next.draft.teams.map((t) => t.name)).toEqual(['팀 1', '팀 2', '팀 3', '팀 4', '팀 5', '팀 6'])
    expect(next.draft.teams[1].id).not.toBe('t2')
    expect(next.activeTeamId).toBe(next.draft.teams[1].id)
    for (const original of teams.filter((t) => t.id !== 't2')) {
      expect(next.draft.teams.find((t) => t.id === original.id)).toEqual(original)
    }
  })

  it('사용자 지정 팀 이름은 유지하고 빈 첫 번호를 사용한다', () => {
    const next = draftReducer(makeState([team({ name: '오후팀' }), team({ id: 't3', name: '팀 3' })]), { type: 'CREATE_TEAM' })
    expect(next.draft.teams.map((t) => t.name)).toEqual(['오후팀', '팀 1', '팀 3'])
  })

  it('DELETE_TEAM: 활성팀 삭제 시 첫 팀으로 활성 이동', () => {
    const s = makeState([team({ id: 'a' }), team({ id: 'b' })], 'a')
    const next = draftReducer(s, { type: 'DELETE_TEAM', teamId: 'a' })
    expect(next.draft.teams.map((t) => t.id)).toEqual(['b'])
    expect(next.activeTeamId).toBe('b')
  })

  it('RENAME_TEAM: 공백 이름은 무시', () => {
    const s = makeState([team({ id: 'a', name: '팀 1' })])
    expect(draftReducer(s, { type: 'RENAME_TEAM', teamId: 'a', name: '   ' })).toBe(s)
    const ok = draftReducer(s, { type: 'RENAME_TEAM', teamId: 'a', name: '  A조 ' })
    expect(ok.draft.teams[0].name).toBe('A조')
  })
})

describe('draftReducer — 멤버', () => {
  it('MOVE_MEMBER: 다른 팀으로 이동(원팀에서 제거)', () => {
    const s = makeState([
      team({ id: 'a', members: ['김민준'] }),
      team({ id: 'b', members: [] }),
    ])
    const next = draftReducer(s, { type: 'MOVE_MEMBER', name: '김민준', toTeamId: 'b' })
    expect(next.draft.teams.find((t) => t.id === 'a')!.members).toEqual([])
    expect(next.draft.teams.find((t) => t.id === 'b')!.members).toEqual(['김민준'])
  })

  it('REMOVE_MEMBER: 해당 팀에서만 제거', () => {
    const s = makeState([team({ id: 'a', members: ['김민준', '이영희'] })])
    const next = draftReducer(s, { type: 'REMOVE_MEMBER', teamId: 'a', name: '김민준' })
    expect(next.draft.teams[0].members).toEqual(['이영희'])
  })
})

describe('draftReducer — 구역 카드 (여러 팀이 함께 맡을 수 있음)', () => {
  it('ASSIGN_CARD: 활성팀에 추가 + undo 스냅샷', () => {
    const s = makeState([team({ id: 'a' })])
    const next = draftReducer(s, { type: 'ASSIGN_CARD', teamId: 'a', cardId: 10 })
    expect(next.draft.teams[0].cardIds).toEqual([10])
    expect(next.undo).toBe(s.draft) // 직전 스냅샷
  })

  it('ASSIGN_CARD: 다른 팀이 맡은 카드도 뺏지 않고 함께 배정 (큰 구역 공동 배정)', () => {
    const s = makeState([
      team({ id: 'a', cardIds: [10] }),
      team({ id: 'b', cardIds: [] }),
    ])
    const next = draftReducer(s, { type: 'ASSIGN_CARD', teamId: 'b', cardId: 10 })
    expect(next.draft.teams.find((t) => t.id === 'a')!.cardIds).toEqual([10])
    expect(next.draft.teams.find((t) => t.id === 'b')!.cardIds).toEqual([10])
  })

  it('ASSIGN_CARD: 같은 카드를 두 번 넣어도 중복되지 않음', () => {
    const s = makeState([team({ id: 'a', cardIds: [10] })])
    const next = draftReducer(s, { type: 'ASSIGN_CARD', teamId: 'a', cardId: 10 })
    expect(next.draft.teams[0].cardIds).toEqual([10])
  })

  it('UNASSIGN_CARD: 공유 중이어도 해당 팀에서만 빠진다', () => {
    const s = makeState([
      team({ id: 'a', cardIds: [10] }),
      team({ id: 'b', cardIds: [10] }),
    ])
    const next = draftReducer(s, { type: 'UNASSIGN_CARD', teamId: 'b', cardId: 10 })
    expect(next.draft.teams.find((t) => t.id === 'a')!.cardIds).toEqual([10])
    expect(next.draft.teams.find((t) => t.id === 'b')!.cardIds).toEqual([])
  })

  it('MOVE_CARD: 카드가 다른 팀에 있으면 그 팀에서 빠지고 대상 팀으로 (단독 이동)', () => {
    const s = makeState([
      team({ id: 'a', cardIds: [10] }),
      team({ id: 'b', cardIds: [] }),
    ])
    const next = draftReducer(s, { type: 'MOVE_CARD', cardId: 10, toTeamId: 'b' })
    expect(next.draft.teams.find((t) => t.id === 'a')!.cardIds).toEqual([])
    expect(next.draft.teams.find((t) => t.id === 'b')!.cardIds).toEqual([10])
  })

  it('UNASSIGN_CARD: 카드 제거', () => {
    const s = makeState([team({ id: 'a', cardIds: [10, 20] })])
    const next = draftReducer(s, { type: 'UNASSIGN_CARD', teamId: 'a', cardId: 10 })
    expect(next.draft.teams[0].cardIds).toEqual([20])
  })

  it('UNDO: 직전 카드 변경을 되돌림', () => {
    const s = makeState([team({ id: 'a', cardIds: [] })])
    const assigned = draftReducer(s, { type: 'ASSIGN_CARD', teamId: 'a', cardId: 10 })
    const undone = draftReducer(assigned, { type: 'UNDO' })
    expect(undone.draft.teams[0].cardIds).toEqual([])
    expect(undone.undo).toBeNull()
  })
})

describe('draftReducer — SANITIZE', () => {
  it('현재 참가자에 없는 멤버 제거', () => {
    const s = makeState([team({ id: 'a', members: ['김민준', '탈퇴자'] })])
    const next = draftReducer(s, { type: 'SANITIZE', participants: ['김민준'] })
    expect(next.draft.teams[0].members).toEqual(['김민준'])
  })

  it('변경 없으면 동일 state 반환 (불필요한 렌더 방지)', () => {
    const s = makeState([team({ id: 'a', members: ['김민준'] })])
    const next = draftReducer(s, { type: 'SANITIZE', participants: ['김민준', '이영희'] })
    expect(next).toBe(s)
  })
})
