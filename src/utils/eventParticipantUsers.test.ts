import { describe, expect, test } from 'vitest'
import {
  eventParticipantNameKey,
  matchesRegisteredUserName,
  normalizeEventParticipantName,
  selectableEventParticipants,
  type EventParticipantUser,
} from './eventParticipantUsers'

const users: EventParticipantUser[] = [
  { id: 1, name: '활성 사용자', approvalStatus: 'approved', isActive: true },
  { id: 2, name: '비활성 사용자', approvalStatus: 'approved', isActive: false },
  { id: 3, name: '승인 대기', approvalStatus: 'pending', isActive: true },
  { id: 4, name: '차단 사용자', approvalStatus: 'blocked', isActive: true },
  { id: 5, name: '옛 자료 사용자' },
]

describe('일정 참가자 후보', () => {
  test('활성·승인 사용자와 옛 스키마 사용자만 후보로 둔다', () => {
    expect(selectableEventParticipants(users).map((user) => user.name)).toEqual([
      '활성 사용자',
      '옛 자료 사용자',
    ])
  })

  test('비활성 계정도 게스트와 이름이 겹치는지 판정할 때는 보존한다', () => {
    expect(matchesRegisteredUserName(users, '  비활성   사용자 ')).toBe(true)
    expect(matchesRegisteredUserName(users, '새 손님')).toBe(false)
  })

  test('저장 이름은 공백만 정리하고, 중복 비교는 대소문자도 구분하지 않는다', () => {
    expect(normalizeEventParticipantName('  Wang   Xiao Ming ')).toBe('Wang Xiao Ming')
    expect(eventParticipantNameKey(' wang xiao ming ')).toBe(eventParticipantNameKey('Wang  Xiao Ming'))
  })
})
