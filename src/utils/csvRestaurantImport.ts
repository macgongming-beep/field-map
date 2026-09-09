/**
 * 식당 CSV 일괄등록 유틸리티
 *
 * 엑셀에서 내보낸 CSV (시구,동,상세주소,식당명) 를 파싱하고,
 * 기존 buildings 목록과 주소 기반으로 매칭한다.
 */
import type { Building } from '../types'

export type CsvRow = {
  sigu: string    // 시구 (예: 가상도 예시시 중앙구)
  dong: string    // 동
  address: string // 상세주소 (예: 경안천로256번길 73)
  name: string    // 식당명
}

export type MatchResult = {
  row: CsvRow
  matched: Building | null
  alreadyRestaurant: boolean
  /** CSV 식당명이 현재 건물명과 다를 때 true → 이름도 같이 업데이트 */
  nameWillUpdate: boolean
}

// ── CSV 파서 (따옴표 처리 포함) ───────────────────────────────
function parseCsvLine(line: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim())
      current = ''
    } else {
      current += ch
    }
  }
  result.push(current.trim())
  return result
}

export function parseCsvRestaurants(csvText: string): CsvRow[] {
  const lines = csvText.split(/\r?\n/).filter((l) => l.trim())
  if (lines.length === 0) return []

  // 헤더 감지
  const firstCols = parseCsvLine(lines[0]).map((s) => s.toLowerCase().trim())
  const hasHeader = firstCols.some((h) =>
    ['시구', '동', '상세주소', '식당명', 'address', 'name', '지역', '구역'].includes(h),
  )
  const dataLines = hasHeader ? lines.slice(1) : lines

  return dataLines
    .map((line) => {
      const cols = parseCsvLine(line)
      return {
        sigu: (cols[0] ?? '').trim(),
        dong: (cols[1] ?? '').trim(),
        address: (cols[2] ?? '').trim(),
        name: (cols[3] ?? '').trim(),
      }
    })
    .filter((r) => r.address.length > 0)
}

// ── 주소 정규화 + 매칭 ─────────────────────────────────────────
function normAddr(s: string): string {
  return s.replace(/\s+/g, '').toLowerCase()
}

export function matchRestaurantsToBuildings(rows: CsvRow[], buildings: Building[]): MatchResult[] {
  return rows.map((row) => {
    const full = normAddr(`${row.sigu} ${row.address}`)
    const short = normAddr(row.address)

    let best: Building | null = null
    let bestScore = 0

    for (const b of buildings) {
      const bAddr = normAddr(b.address)
      let score = 0

      // 완전 일치 (최우선)
      if (bAddr === full || bAddr === short) {
        score = 4
      }
      // 건물 주소가 CSV 전체 주소를 포함하거나 반대
      else if (full.length > 4 && (bAddr.includes(full) || full.includes(bAddr))) {
        score = 3
      }
      // 단독 상세주소로 포함 여부 (최소 5자 이상)
      else if (short.length > 4) {
        if (bAddr.includes(short)) {
          score = 2
        } else if (short.includes(bAddr) && bAddr.length > 6) {
          score = 1
        }
      }

      if (score > bestScore) {
        bestScore = score
        best = b
      }
    }

    const finalMatch = bestScore > 0 ? best : null
    const nameWillUpdate = !!(
      finalMatch &&
      row.name &&
      row.name !== finalMatch.name
    )
    return {
      row,
      matched: finalMatch,
      alreadyRestaurant: !!(finalMatch?.isRestaurant),
      nameWillUpdate,
    }
  })
}

// ── 샘플 CSV 콘텐츠 ──────────────────────────────────────────────
export const SAMPLE_CSV_CONTENT =
  '시구,동,상세주소,식당명\n' +
  '가상도 예시시 중앙구,새봄동,새봄로 73,예시반점\n' +
  '가상도 예시시 중앙구,새봄동,새봄로 45,샘플식당\n' +
  '가상도 예시시 중앙구,푸른동,푸른길 5,중앙반점\n'
