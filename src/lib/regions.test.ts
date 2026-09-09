import { describe, it, expect, beforeEach } from 'vitest'
import {
  setRegions,
  setRegionsFromDatabase,
  getRegions,
  getRegionNames,
  getRegionCity,
  stripRegionPrefix,
  getAddressStripWords,
  getAddressStripPattern,
  type TerritoryRegionInfo,
} from './regions'

const YONGIN: TerritoryRegionInfo[] = [
  { id: 1, name: '처인구', city: '용인시', sortOrder: 1, nameZh: '处仁区', nameEn: 'Cheoin-gu' },
  { id: 2, name: '기흥구', city: '용인시', sortOrder: 2, nameZh: '器兴区', nameEn: 'Giheung-gu' },
  { id: 3, name: '영통구', city: '수원시', sortOrder: 4, nameZh: '灵通区', nameEn: 'Yeongton-gu' },
  { id: 4, name: '화성시', city: '', sortOrder: 5, nameZh: '华城市', nameEn: 'Hwaseong-si' },
]

beforeEach(() => setRegions(YONGIN))

describe('목록 불러오기', () => {
  it('정한 순서대로 돌려준다 (가나다순이 아니다)', () => {
    expect(getRegionNames()).toEqual(['처인구', '기흥구', '영통구', '화성시'])
  })

  it('빈 목록으로는 덮지 않는다 — 불러오기 실패와 구분되지 않는다', () => {
    setRegions([])
    expect(getRegions().length).toBe(4)
  })

  it('DB 조회가 성공한 빈 목록은 새 회중의 실제 상태로 반영한다', () => {
    setRegionsFromDatabase([])
    expect(getRegions()).toEqual([])
  })

  it('DB 에서 순서가 뒤섞여 와도 정렬해서 쓴다', () => {
    setRegions([...YONGIN].reverse())
    expect(getRegionNames()).toEqual(['처인구', '기흥구', '영통구', '화성시'])
  })
})

describe('상위 시', () => {
  it('구가 속한 시를 돌려준다 — 영통구는 용인시가 아니라 수원시다', () => {
    expect(getRegionCity('수지구')).toBe('')      // 이 목록엔 없음
    expect(getRegionCity('기흥구')).toBe('용인시')
    expect(getRegionCity('영통구')).toBe('수원시')
  })

  it('시 자체인 지역은 비어 있다', () => {
    expect(getRegionCity('화성시')).toBe('')
  })
})

describe('카드 이름에서 지역 떼기', () => {
  it("'처인구 백암면 1' → '백암면 1'", () => {
    expect(stripRegionPrefix('처인구 백암면 1')).toBe('백암면 1')
  })

  it('목록에 없는 지역이면 그대로 둔다', () => {
    expect(stripRegionPrefix('강남구 역삼동 1')).toBe('강남구 역삼동 1')
  })

  it('앞에 붙지 않은 지역명은 건드리지 않는다', () => {
    expect(stripRegionPrefix('백암면 처인구점 1')).toBe('백암면 처인구점 1')
  })

  it('빈 값은 빈 값', () => {
    expect(stripRegionPrefix('')).toBe('')
  })
})

describe('주소 정규화 재료', () => {
  it('지역명과 상위 시를 모두 모은다', () => {
    const words = getAddressStripWords()
    expect(words).toContain('처인구')
    expect(words).toContain('용인시')
    expect(words).toContain('수원시')
    expect(words).not.toContain('')
  })

  it('시가 같은 구가 여럿이어도 시는 한 번만', () => {
    expect(getAddressStripWords().filter((w) => w === '용인시')).toHaveLength(1)
  })

  it('실제 주소에서 시·구가 지워진다', () => {
    const out = '경기 용인시 처인구 백암면 백암로 175'.replace(getAddressStripPattern(), ' ')
    expect(out).not.toContain('용인시')
    expect(out).not.toContain('처인구')
    expect(out).toContain('백암로 175')
  })

  it('지역이 새로 생기면 주소 정규화도 함께 따라온다', () => {
    // 예전에는 여기가 따로 적혀 있어서, 지역을 늘려도 주소 정규화만 옛날 목록이었다
    setRegions([{ id: 9, name: '남동구', city: '인천시', sortOrder: 1, nameZh: '', nameEn: '' }])
    const out = '인천시 남동구 구월로 10'.replace(getAddressStripPattern(), ' ')
    expect(out.trim()).toBe('구월로 10')
  })
})
