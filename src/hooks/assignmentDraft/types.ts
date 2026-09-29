// 인도자 배정 draft — 단일 source of truth 타입
// 설계: docs/leader-assignment-redesign.md v3
//
// 원칙:
//  - draft.teams[] 가 유일한 진실. 지도/목록 UI는 여기서 파생만.
//  - 데모는 비공식도 팀 초안에 담아 함께 공유한다. 식당은 기존 개인 즉시저장이다.
//  - 팀 이름/색/순서는 서버에 저장 안 됨(DB는 cardIds만) → 서버 복원 시 재생성될 수 있음.

export type AssignmentMode = 'card'
export type AssignmentStatus = 'draft' | 'confirmed' | 'shared'

export type DraftTeam = {
  id: string
  name: string
  color: string
  order: number
  cardIds: number[]   // 이 팀에 배정된 구역 카드 (비공식/식당 제외)
  cardScope?: '전체' | '주택' | '상가'
  informalAssetIds?: number[]
  members: string[]   // 이 팀에 속한 참가자 이름
}

export type AssignmentDraft = {
  mode: AssignmentMode
  status: AssignmentStatus
  updatedAt: string | null
  teams: DraftTeam[]
}

// reducer가 다루는 전체 상태 (draft = 영속, 나머지 = 휘발성 UI 상태)
export type DraftState = {
  draft: AssignmentDraft
  activeTeamId: string | null      // 화면2 활성팀 (색칠/체크 대상)
  undo: AssignmentDraft | null     // 직전 1회 되돌리기 스냅샷 (코덱스 Undo)
}

export const TEAM_COLORS = ['blue', 'green', 'orange', 'purple', 'slate', 'rose', 'teal', 'amber', 'indigo', 'lime', 'coral', 'cyan', 'brown', 'emerald', 'pink', 'stone'] as const

// reducer action — 모든 배정 변경은 이 액션들을 통해서만
export type DraftAction =
  // 초기화 / 로드
  | { type: 'LOAD'; draft: AssignmentDraft; activeTeamId?: string | null }
  // 팀
  | { type: 'CREATE_TEAM'; members?: string[] }      // 선택한 멤버로 새 팀 ("묶기")
  | { type: 'DELETE_TEAM'; teamId: string }
  | { type: 'RENAME_TEAM'; teamId: string; name: string }
  | { type: 'SET_ACTIVE_TEAM'; teamId: string | null }
  | { type: 'SET_CARD_SCOPE'; teamId: string; scope: '전체' | '주택' | '상가'; cardIds: number[] }
  | { type: 'TOGGLE_TEAM_INFORMAL'; teamId: string; assetId: number }
  // 멤버
  | { type: 'ADD_MEMBER'; teamId: string; name: string }
  | { type: 'REMOVE_MEMBER'; teamId: string; name: string }
  | { type: 'MOVE_MEMBER'; name: string; toTeamId: string }   // 다른 팀으로 이동
  // 구역 카드 (undo 대상)
  | { type: 'ASSIGN_CARD'; teamId: string; cardId: number }    // 활성팀에 카드 추가
  | { type: 'UNASSIGN_CARD'; teamId: string; cardId: number }
  | { type: 'MOVE_CARD'; cardId: number; toTeamId: string }    // 다른 팀 카드 → 활성팀 이동
  // 정제 / 되돌리기
  | { type: 'SANITIZE'; participants: string[] }   // 현재 참가자에 없는 멤버 제거
  | { type: 'UNDO' }
