export type EventParticipantUser = {
  id: number
  name: string
  role?: string
  approvalStatus?: 'pending' | 'approved' | 'blocked'
  isActive?: boolean
}

export function normalizeEventParticipantName(name: string): string {
  return name.trim().replace(/\s+/g, ' ')
}

export function eventParticipantNameKey(name: string): string {
  return normalizeEventParticipantName(name).toLocaleLowerCase()
}

/** 옛 스키마의 사용자 목록은 승인 상태가 없을 수 있어 undefined만 승인으로 간주한다. */
export function isSelectableEventParticipant(user: EventParticipantUser): boolean {
  return user.isActive !== false
    && user.approvalStatus !== 'pending'
    && user.approvalStatus !== 'blocked'
}

export function selectableEventParticipants(users: EventParticipantUser[]): EventParticipantUser[] {
  return users.filter(isSelectableEventParticipant)
}

export function matchesRegisteredUserName(users: EventParticipantUser[], name: string): boolean {
  const key = eventParticipantNameKey(name)
  if (!key) return false
  return users.some((user) => eventParticipantNameKey(user.name) === key)
}
