import { describe, test, expect } from 'vitest'
import { willNotifyOnEventChange, isNotifiableDate, countEventNotifyTargets, countEventNotifyTargetsMany } from './eventNotify'

const base = { date: '2026-09-01', time: '10:00', place: '신갈', mapLink: '', leader: '가, 나', title: '传道' }

describe('willNotifyOnEventChange', () => {
  test('아무것도 안 바뀌면 안 나간다', () => {
    expect(willNotifyOnEventChange(base, { ...base })).toBe(false)
  })

  test('메모만 바뀌는 건 애초에 안 본다 — 안 나간다', () => {
    // 메모는 인자에 없다. 트리거도 메모를 안 본다.
    expect(willNotifyOnEventChange(base, { ...base })).toBe(false)
  })

  for (const [key, next] of [
    ['date', '2026-09-02'], ['time', '11:00'], ['place', '기흥'],
    ['mapLink', 'http://x'], ['leader', '가, 다'], ['title', '집회'],
  ] as const) {
    test(`${key} 가 바뀌면 나간다`, () => {
      expect(willNotifyOnEventChange(base, { ...base, [key]: next })).toBe(true)
    })
  }

  test('앞뒤 공백만 다른 건 안 바뀐 것으로 본다', () => {
    expect(willNotifyOnEventChange(base, { ...base, place: '  신갈  ' })).toBe(false)
  })

  test('빈 문자열과 null 은 같다', () => {
    expect(willNotifyOnEventChange({ ...base, mapLink: null }, { ...base, mapLink: '' })).toBe(false)
  })
})

describe('isNotifiableDate', () => {
  test('오늘은 알린다', () => {
    expect(isNotifiableDate('2026-08-27', '2026-08-27')).toBe(true)
  })
  test('앞날은 알린다', () => {
    expect(isNotifiableDate('2026-08-28', '2026-08-27')).toBe(true)
  })
  test('지난 일정은 안 알린다', () => {
    expect(isNotifiableDate('2026-08-26', '2026-08-27')).toBe(false)
  })
})

describe('countEventNotifyTargetsMany — 회차마다 사람이 다르다', () => {
  test('여러 일정의 합집합을 센다', () => {
    const evs = [
      { participants: ['가', '나'], leader: '인도자1' },
      { participants: ['나', '다'], leader: '인도자1, 인도자2' },
    ]
    // 가, 나, 다, 인도자1, 인도자2 = 5
    expect(countEventNotifyTargetsMany(evs)).toBe(5)
  })

  test('첫 일정에 아무도 없어도 뒤 회차 사람을 센다', () => {
    // 이걸 놓치면 "받을 사람 0명" 으로 보고 묻지도 않은 채 조용히 고쳐진다
    const evs = [
      { participants: [], leader: '' },
      { participants: ['가', '나'], leader: '인도자1' },
    ]
    expect(countEventNotifyTargetsMany(evs)).toBe(3)
  })

  test('빈 목록은 0', () => {
    expect(countEventNotifyTargetsMany([])).toBe(0)
  })

  test('인도자 목록의 공백을 다듬는다', () => {
    expect(countEventNotifyTargetsMany([{ leader: ' 가 ,, 나 ' }])).toBe(2)
  })

  test('실제 일정 모델의 일반·전시대 신청자를 함께 세고 중복은 한 번만 센다', () => {
    expect(countEventNotifyTargets({
      applicants: ['일반신청자', '공동인도자'],
      cartApplicants: [
        { name: '전시대신청자' },
        { name: '공동인도자' },
      ],
      leaders: ['공동인도자'],
    })).toBe(3)
  })

  test('반복 일정의 전시대 신청자도 회차 전체 합집합에 포함한다', () => {
    expect(countEventNotifyTargetsMany([
      { applicants: ['일반신청자'], cartApplicants: [] },
      { applicants: [], cartApplicants: [{ name: '전시대신청자' }] },
    ])).toBe(2)
  })

  test('편집한 본인과 계정 없는 게스트는 예상 수신자에서 제외한다', () => {
    expect(countEventNotifyTargets({
      applicants: ['편집자', '일반신청자', '계정없는손님'],
      guests: ['계정없는손님'],
      cartApplicants: [{ name: '전시대신청자' }],
      leaders: ['편집자'],
    }, { exclude: '편집자' })).toBe(2)
  })
})
