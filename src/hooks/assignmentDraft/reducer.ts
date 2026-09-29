// 인도자 배정 draft reducer — 순수 함수, 단일 진실
// 설계: docs/leader-assignment-redesign.md v3
//
// 모든 배정 변경은 이 reducer를 거친다. 지도/목록 UI는 dispatch만 호출.
// 카드 관련 변경(ASSIGN/UNASSIGN/MOVE_CARD)은 undo 스냅샷을 남긴다.

import type { AssignmentDraft, DraftAction, DraftState, DraftTeam } from './types'
import { TEAM_COLORS } from './types'

function genTeamId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? `team-${crypto.randomUUID()}`
    : `team-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function nextColor(teams: DraftTeam[]): string {
  return TEAM_COLORS[teams.length % TEAM_COLORS.length]
}

function nextName(teams: DraftTeam[]): string {
  // 기존 팀의 이름과 배정은 유지하고 비어 있는 가장 작은 번호를 재사용한다.
  const used = teams
    .map((t) => /^팀 (\d+)$/.exec(t.name)?.[1])
    .filter(Boolean)
    .map(Number)
  let number = 1
  while (used.includes(number)) number += 1
  return `팀 ${number}`
}

function touch(draft: AssignmentDraft): AssignmentDraft {
  return { ...draft, updatedAt: new Date().toISOString() }
}

// 카드는 여러 팀이 함께 맡을 수 있다 (큰 구역을 나눠 도는 경우)
// → 대상 팀에만 추가하고, 다른 팀의 배정은 건드리지 않는다.
function addCardToTeam(teams: DraftTeam[], cardId: number, toTeamId: string): DraftTeam[] {
  return teams.map((team) =>
    team.id === toTeamId && !team.cardIds.includes(cardId)
      ? { ...team, cardIds: [...team.cardIds, cardId] }
      : team,
  )
}

// 카드를 한 팀에서만 맡게 옮긴다 (다른 팀에서는 제거)
function reassignCard(teams: DraftTeam[], cardId: number, toTeamId: string): DraftTeam[] {
  return teams.map((team) => {
    if (team.id === toTeamId) {
      return team.cardIds.includes(cardId)
        ? team
        : { ...team, cardIds: [...team.cardIds, cardId] }
    }
    // 다른 팀에서는 제거
    return team.cardIds.includes(cardId)
      ? { ...team, cardIds: team.cardIds.filter((id) => id !== cardId) }
      : team
  })
}

// 한 사람은 한 팀에만 → 다른 팀에서 제거 후 대상 팀에 추가
function reassignMember(teams: DraftTeam[], name: string, toTeamId: string): DraftTeam[] {
  return teams.map((team) => {
    if (team.id === toTeamId) {
      return team.members.includes(name) ? team : { ...team, members: [...team.members, name] }
    }
    return team.members.includes(name)
      ? { ...team, members: team.members.filter((m) => m !== name) }
      : team
  })
}

export function draftReducer(state: DraftState, action: DraftAction): DraftState {
  switch (action.type) {
    case 'LOAD':
      return {
        draft: action.draft,
        activeTeamId: action.activeTeamId ?? action.draft.teams[0]?.id ?? null,
        undo: null,
      }

    case 'SET_ACTIVE_TEAM':
      return { ...state, activeTeamId: action.teamId }

    case 'SET_CARD_SCOPE':
      return { ...state, undo: state.draft, draft: touch({ ...state.draft,
        teams: state.draft.teams.map((t) => t.id === action.teamId
          ? { ...t, cardScope: action.scope, cardIds: action.cardIds } : t),
      }) }

    case 'CREATE_TEAM': {
      const teams = state.draft.teams
      const members = action.members ?? []
      // 새 팀에 들어가는 멤버는 기존 팀에서 빼낸다
      const cleared = teams.map((t) => ({
        ...t,
        members: t.members.filter((m) => !members.includes(m)),
      }))
      const newTeam: DraftTeam = {
        id: genTeamId(),
        name: nextName(teams),
        color: nextColor(teams),
        order: 0,
        cardIds: [],
        members,
      }
      const number = Number(newTeam.name.slice(2))
      const insertionIndex = cleared.findIndex((team) => Number(/^팀 (\d+)$/.exec(team.name)?.[1]) > number)
      const ordered = [...cleared]
      ordered.splice(insertionIndex < 0 ? ordered.length : insertionIndex, 0, newTeam)
      return {
        ...state,
        draft: touch({ ...state.draft, teams: ordered.map((team, order) => ({ ...team, order })) }),
        activeTeamId: newTeam.id, // 새로 만든 팀을 활성화
      }
    }

    case 'DELETE_TEAM': {
      const teams = state.draft.teams.filter((t) => t.id !== action.teamId)
      const activeTeamId = state.activeTeamId === action.teamId
        ? (teams[0]?.id ?? null)
        : state.activeTeamId
      return { ...state, draft: touch({ ...state.draft, teams }), activeTeamId }
    }

    case 'RENAME_TEAM': {
      const name = action.name.trim()
      if (!name) return state
      const teams = state.draft.teams.map((t) =>
        t.id === action.teamId ? { ...t, name } : t,
      )
      return { ...state, draft: touch({ ...state.draft, teams }) }
    }

    case 'ADD_MEMBER': {
      const teams = reassignMember(state.draft.teams, action.name, action.teamId)
      return { ...state, draft: touch({ ...state.draft, teams }) }
    }

    case 'MOVE_MEMBER': {
      const teams = reassignMember(state.draft.teams, action.name, action.toTeamId)
      return { ...state, draft: touch({ ...state.draft, teams }) }
    }

    case 'REMOVE_MEMBER': {
      const teams = state.draft.teams.map((t) =>
        t.id === action.teamId ? { ...t, members: t.members.filter((m) => m !== action.name) } : t,
      )
      return { ...state, draft: touch({ ...state.draft, teams }) }
    }

    case 'ASSIGN_CARD': {
      // undo 스냅샷 남김. 다른 팀 배정은 유지 (같은 구역 공동 배정 허용)
      const teams = addCardToTeam(state.draft.teams, action.cardId, action.teamId)
      return { ...state, undo: state.draft, draft: touch({ ...state.draft, teams }) }
    }

    case 'UNASSIGN_CARD': {
      const teams = state.draft.teams.map((t) =>
        t.id === action.teamId ? { ...t, cardIds: t.cardIds.filter((id) => id !== action.cardId) } : t,
      )
      return { ...state, undo: state.draft, draft: touch({ ...state.draft, teams }) }
    }

    case 'MOVE_CARD': {
      const teams = reassignCard(state.draft.teams, action.cardId, action.toTeamId)
      return { ...state, undo: state.draft, draft: touch({ ...state.draft, teams }) }
    }

    case 'SANITIZE': {
      // 현재 참가자에 없는 멤버를 모든 팀에서 제거 (제미나이: 신청 취소·거절자 정제)
      const valid = new Set(action.participants)
      let changed = false
      const teams = state.draft.teams.map((t) => {
        const filtered = t.members.filter((m) => valid.has(m))
        if (filtered.length !== t.members.length) changed = true
        return filtered.length === t.members.length ? t : { ...t, members: filtered }
      })
      if (!changed) return state
      return { ...state, draft: { ...state.draft, teams } } // sanitize는 updatedAt 안 건드림(자동정제)
    }

    case 'UNDO': {
      if (!state.undo) return state
      return { ...state, draft: state.undo, undo: null }
    }

    default:
      return state
  }
}
