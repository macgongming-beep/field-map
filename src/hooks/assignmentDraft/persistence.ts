// 인도자 배정 draft — 서버 복원 + localStorage 영속 + 충돌 감지
// 설계: docs/leader-assignment-redesign.md v3
//
// 핵심:
//  - 서버 shared 배정에서 draft 재구성 (DB는 cardIds만 → 팀 이름/색/순서는 재생성, 보존 안 됨)
//  - 진입 시 localStorage draft vs 서버 비교 → 충돌이면 호출부가 사용자에게 선택지 제시
//  - 공유 성공 후에만 localStorage 정리 (제미나이: 실패 보호)

import type { AssignmentDraft, DraftTeam } from './types'
import { TEAM_COLORS } from './types'
import type { CalendarEvent } from '../../types'

function storageKey(eventId: number, userName: string): string {
  return `mobileLeaderAssignmentDraft:${eventId}:${userName}`
}

// ── 서버(이벤트 cardAssignments)에서 draft 재구성 ──────────────
// ⚠ DB는 사용자별 cardIds만 저장. 팀의 이름/색/순서는 보존되지 않으므로
//   "같은 cardIds 가진 사람끼리 묶기"로 팀을 재생성하고 메타는 새로 부여한다.
export function buildDraftFromServer(event: CalendarEvent): AssignmentDraft {
  const grouped = new Map<string, { cardIds: number[]; members: string[]; teamKey?: string | null; cardScope?: DraftTeam['cardScope'] }>()
  event.cardAssignments.forEach((assignment) => {
    const cardIds = assignment.assignedCardIds && assignment.assignedCardIds.length > 0
      ? assignment.assignedCardIds
      : assignment.assignedCardId != null
        ? [assignment.assignedCardId]
        : []
    // teamKey 가 저장돼 있으면 그걸로 팀을 나눈다.
    // (없던 시절 데이터는 예전처럼 "같은 카드 구성 = 같은 팀"으로 폴백 —
    //  다만 그 경우 서로 다른 팀이 같은 구역만 맡았다면 한 팀으로 합쳐진다)
    const key = assignment.teamKey
      ? `team:${assignment.teamKey}`
      : cardIds.slice().sort((a, b) => a - b).join(',') || `member:${assignment.userName}`
    const current = grouped.get(key) ?? { cardIds, members: [], teamKey: assignment.teamKey, cardScope: assignment.cardScope ?? '전체' }
    current.members.push(assignment.userName)
    grouped.set(key, current)
  })

  const teams: DraftTeam[] = Array.from(grouped.values()).map((group, index) => ({
    id: group.teamKey || `team-server-${index}-${group.cardIds.join('-')}`,
    name: `팀 ${index + 1}`,
    color: TEAM_COLORS[index % TEAM_COLORS.length],
    order: index,
    cardIds: group.cardIds,
    cardScope: group.cardScope,
    informalAssetIds: group.teamKey ? event.assignmentTeamInformal?.[group.teamKey] ?? [] : [],
    members: group.members,
  }))

  return {
    mode: 'card',
    status: event.assignmentStatus === 'shared' ? 'shared' : 'draft',
    updatedAt: event.assignmentSharedAt ?? null,
    teams,
  }
}

// 빈 draft (신규 배정)
export function buildEmptyDraft(): AssignmentDraft {
  return { mode: 'card', status: 'draft', updatedAt: null, teams: [] }
}

// draft → 서버 bulk 배정 형식 (각 멤버가 자기 팀의 cardIds를 받음)
export function draftToAssignments(
  draft: AssignmentDraft,
): Array<{ userName: string; cardIds: number[]; teamKey: string; cardScope?: DraftTeam['cardScope']; informalAssetIds?: number[] }> {
  const out: Array<{ userName: string; cardIds: number[]; teamKey: string; cardScope?: DraftTeam['cardScope']; informalAssetIds?: number[] }> = []
  draft.teams.forEach((team) => {
    team.members.forEach((userName) => {
      // teamKey 를 함께 저장해야 복원 시 팀이 그대로 나뉜다
      // (같은 구역을 맡은 다른 팀과 합쳐지지 않도록)
      out.push({ userName, cardIds: team.cardIds, teamKey: team.id,
        ...(import.meta.env.VITE_DEMO_MODE === 'true' ? { cardScope: team.cardScope ?? '전체', informalAssetIds: team.informalAssetIds ?? [] } : {}),
      })
    })
  })
  return out
}

// ── localStorage ──────────────────────────────────────────────
// draft 구조 최소 검증 (깨진/옛 포맷 방지)
function isValidDraft(d: unknown): d is AssignmentDraft {
  if (!d || typeof d !== 'object') return false
  const draft = d as Partial<AssignmentDraft>
  if (!Array.isArray(draft.teams)) return false
  return draft.teams.every((t) =>
    t && typeof t === 'object' && Array.isArray(t.cardIds) && Array.isArray(t.members),
  )
}

export function loadLocalDraft(eventId: number, userName: string): AssignmentDraft | null {
  try {
    const raw = localStorage.getItem(storageKey(eventId, userName))
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!isValidDraft(parsed)) {
      // 깨진 draft → 버림 (조용히 잘못된 데이터 쓰지 않게)
      localStorage.removeItem(storageKey(eventId, userName))
      return null
    }
    return parsed
  } catch {
    return null
  }
}

// 저장 성공 여부 반환 (실패 시 호출부가 토스트 등 처리)
export function saveLocalDraft(eventId: number, userName: string, draft: AssignmentDraft): boolean {
  try {
    localStorage.setItem(storageKey(eventId, userName), JSON.stringify(draft))
    return true
  } catch {
    return false  // 용량 초과 등
  }
}

// 공유 성공 후에만 호출 (제미나이: API resolve 직후 정리)
export function clearLocalDraft(eventId: number, userName: string): void {
  try {
    localStorage.removeItem(storageKey(eventId, userName))
  } catch {
    /* ignore */
  }
}

// ── 진입 시 draft 결정 + 충돌 감지 ────────────────────────────
export type DraftEntryResult =
  | { kind: 'fresh'; draft: AssignmentDraft }            // 로컬 없음 → 서버/빈 draft
  | { kind: 'local'; draft: AssignmentDraft }            // 로컬만 있음 → 그대로
  | { kind: 'conflict'; local: AssignmentDraft; server: AssignmentDraft } // 둘 다 → 사용자 선택

// 충돌 판단: 로컬 draft가 있고, 서버가 그 이후 공유되었으면(서버가 더 최신) 선택 필요
export function resolveDraftEntry(event: CalendarEvent, userName: string): DraftEntryResult {
  const local = loadLocalDraft(event.id, userName)
  const serverShared = event.assignmentStatus === 'shared'

  if (!local) {
    // 로컬 없음 → 서버 공유본 있으면 그걸로, 아니면 빈 draft
    return { kind: 'fresh', draft: serverShared ? buildDraftFromServer(event) : buildEmptyDraft() }
  }

  if (!serverShared) {
    // 서버 공유본 없음 → 로컬 이어서
    return { kind: 'local', draft: local }
  }

  // 둘 다 존재 → 시각 비교
  const localTime = local.updatedAt ? new Date(local.updatedAt).getTime() : 0
  const serverTime = event.assignmentSharedAt ? new Date(event.assignmentSharedAt).getTime() : 0

  if (serverTime > localTime) {
    // 서버가 더 최신 → 충돌, 사용자 선택 (서버 사용 / 로컬 이어서 / 로컬 삭제)
    return { kind: 'conflict', local, server: buildDraftFromServer(event) }
  }
  // 로컬이 더 최신 → 로컬 이어서
  return { kind: 'local', draft: local }
}
