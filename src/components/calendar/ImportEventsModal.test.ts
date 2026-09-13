import { describe, expect, test } from 'vitest'
import { parsePastedEvents } from '../../utils/eventImport'

describe('일정 붙여넣기 전시대 계약', () => {
  test('옛 8열 형식은 전시대 모집을 켜지 않는다', () => {
    const [event] = parsePastedEvents('2026-09-20\t10:00\t12:00\t봉사\t회관\t인도자\tO\t3')

    expect(event.allowApplications).toBe(true)
    expect(event.allowCartApplications).toBe(false)
    expect(event.cartCapacity).toBeNull()
  })

  test('새 11열 형식은 전시대 모집과 정원을 읽고 신청자 수 열은 무시한다', () => {
    const [event] = parsePastedEvents('2026-09-20\t10:00\t12:00\t봉사\t회관\t인도자\tO\t3\tO\t6\t4')

    expect(event.allowCartApplications).toBe(true)
    expect(event.cartCapacity).toBe(6)
  })

  test('내보내기 헤더를 붙여도 일정으로 잘못 가져오지 않는다', () => {
    expect(parsePastedEvents('날짜\t시작시간\t종료시간\t제목\t장소\t인도자\t참여가능여부\t참석자(명수)')).toEqual([])
  })
})
