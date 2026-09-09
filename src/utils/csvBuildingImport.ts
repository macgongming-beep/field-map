/**
 * CSV 건물 데이터 import 관련 타입 + 순수 유틸리티 함수
 * DesktopTerritory 의 CSV 파싱 로직을 분리한 파일
 */
import type { Building, CardBoundary, TerritoryCard, UnitStatus } from '../types'
import { findCardForCoordinates, normalizeMapCoordinates, parseCoordinate } from './mapUtils'
import { compareUnitNumbers } from './unitNumber'

// ── 타입 ────────────────────────────────────────────────────────

export type CsvVisitHistory = {
  visitedAt: string   // ISO datetime string
  result: string      // UnitStatus value
  visitor: string
  timeSlot?: string
  memo?: string
}

export type CsvUnitImport = {
  number: string
  status: UnitStatus
  isChinese: boolean
  /** 이 세대가 식당인가 (업종과 별개 — 상가 중 식당만 true) */
  isRestaurant: boolean
  /** 네이버 업체ID — 다음 수집 때 이 세대를 정확히 다시 찾는 열쇠 */
  naverPlaceId?: string
  isRegularVisit: boolean
  regularVisitor?: string
  regularVisitorStartDate?: string
  memo?: string
  visitHistories: CsvVisitHistory[]
}

export type CsvBuildingImport = {
  cardId: number
  name: string
  address: string
  type: Building['type']
  lat: number
  lng: number
  warning?: string
  units: CsvUnitImport[]
}

export type CsvPreviewRow = CsvBuildingImport & {
  rowNumber: number
  cardName: string
}

export type CsvSkippedRow = {
  rowNumber: number
  reason: string
  hint: string
  address?: string
  rawRow?: string[]
}

// ── 유틸리티 함수 ────────────────────────────────────────────────

export function normalizeCsvKey(value: string) {
  return value.trim().toLowerCase().replace(/[\s_-]/g, '')
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let current = ''
  let row: string[] = []
  let inQuotes = false

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]
    const next = text[i + 1]

    if (char === '"' && inQuotes && next === '"') {
      current += '"'
      i += 1
      continue
    }
    if (char === '"') {
      inQuotes = !inQuotes
      continue
    }
    if (char === ',' && !inQuotes) {
      row.push(current.trim())
      current = ''
      continue
    }
    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') i += 1
      row.push(current.trim())
      if (row.some(Boolean)) rows.push(row)
      row = []
      current = ''
      continue
    }
    current += char
  }

  row.push(current.trim())
  if (row.some(Boolean)) rows.push(row)
  return rows
}

// splitUnitNumbers / createCsvUnits 는 여기 있었다. 지웠다.
// '101|102' 를 여러 세대로 쪼개는 것이었는데 **파서가 부른 적이 없다.**
// 시험만 붙어 있어서 그 규칙이 도는 줄 알았다 (헛된 안심).
// 실제 세대 1000개를 확인해 보니 그런 표기가 없었고, 오히려 연결하면
// '덕석과 구들장, 주인이 반대' 같은 **설명이 적힌 이름 하나**가
// 쉼표에서 쪼개져 없던 세대가 생긴다. 필요해지면 그때 다시 만든다.

export function normalizeUnitStatus(value: string): UnitStatus {
  const text = value.trim()
  if (text.includes('만남')) return '만남'
  if (text.includes('초대장') || text.includes('초대')) return '만남'   // 초대장 → 만남 (invitation_left는 별도)
  if (text.includes('부재')) return '부재'
  if (text.includes('대상외') || text.includes('한국')) return '대상외'
  // ⚠ '거절' 과 '확인필요' 가 빠져 있었다. 그냥 미방문으로 떨어지면
  //   (1) 세대의 방문금지 표시가 조용히 사라지고
  //   (2) 방문결과가 '미방문' 이 되는데 visit_histories 는 그 값을 CHECK 로
  //       막는다 → **건물 하나가 통째로 안 올라간다.**
  //   2026-09-05 원룸 자료 올릴 때 명지베스트빌(세대 112)이 이걸로 실패했다.
  if (text.includes('거절')) return '거절'
  if (text.includes('확인필요') || text.includes('확인 필요')) return '확인필요'
  // 정기방문은 result값 아님 → 만남으로 처리 (regular_visits로 별도 등록)
  if (text.includes('정기') || text.includes('재방')) return '만남'
  return '미방문'
}

export function isInvitationLeft(value: string): boolean {
  return value.trim().includes('초대장') || value.trim().includes('초대')
}

export function looksTruthy(value: string): boolean {
  return /^(true|yes|y|1|중국어|중국인|중국|정기|재방|있음|ㅇ|예)$/i.test(value.trim())
}

/**
 * 엑셀에서 온 날짜를 너그럽게 읽는다.
 *
 * 사람에게 "0 을 붙여 적으세요" 라고 시키면 언젠가 까먹고, 그러면 날짜가
 * 조용히 사라진다 (오류도 안 난다). 그래서 흔한 형태를 모두 받아 준다.
 *   2026-08-13 · 2026.8.13 · 2026/8/13 · 2026년 8월 13일
 *   46247      ← 엑셀이 날짜를 숫자로 내보낸 경우 (1899-12-30 기준 일련번호)
 */
export function parseCsvDate(value: string): string | null {
  const raw = value.trim()
  if (!raw) return null

  // 엑셀 날짜 일련번호 (예: 46247 = 2026-08-13)
  if (/^\d{5}$/.test(raw)) {
    const serial = Number(raw)
    // 1900 년 윤년 버그 때문에 엑셀의 기준일은 1899-12-30 이다
    const ms = Date.UTC(1899, 11, 30) + serial * 86400000
    const d = new Date(ms + 12 * 3600000)
    return isNaN(d.getTime()) ? null : d.toISOString()
  }

  const cleaned = raw
    .replace(/년|월/g, '-')
    .replace(/일/g, '')
    .replace(/[./\s]/g, '-')
    .replace(/-+/g, '-')
    .replace(/-$/, '')
  const m = cleaned.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (!m) return null
  const [, y, mo, day] = m
  const iso = `${y}-${mo.padStart(2, '0')}-${day.padStart(2, '0')}`
  const d = new Date(iso + 'T12:00:00+09:00')
  return isNaN(d.getTime()) ? null : d.toISOString()
}

export function normalizeTimeSlot(value: string): string {
  if (!value) return '오전'
  if (value.includes('오후') || /pm/i.test(value)) return '오후'
  if (value.includes('저녁') || value.includes('밤') || /eve/i.test(value)) return '저녁'
  return '오전'
}

export function normalizeWarning(value: string): string | undefined {
  const v = value.trim()
  if (!v) return undefined
  if (looksTruthy(v)) return '방문금지'
  return v
}


function csvCell(value: string | number): string {
  const text = String(value)
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function downloadCsvExample(): void {
  const headers = [
    '카드명', '지역', '동', '주소', '건물명', '유형', '호수', '상태',
    '구분', '방문금지', '정기방문자', '정기방문시작일', '메모',
    '방문일자', '방문결과', '방문자', '시간대', '방문메모',
  ]
  const data = [
    ['중앙구 새봄동 1', '중앙구', '새봄동', '가상도 예시시 중앙구 새봄로 45', '새봄빌라', '주택', '301', '만남',
      '중국어', '', '담당자', '2024-01-15', '정기방문 등록',
      '2024-03-10', '만남', '방문자', '오후', '친절하게 받아줌'],
    ['중앙구 새봄동 1', '중앙구', '새봄동', '가상도 예시시 중앙구 새봄로 45', '새봄빌라', '주택', '301', '만남',
      '중국어', '', '담당자', '2024-01-15', '',
      '2024-04-05', '부재', '방문자', '오전', ''],
    ['중앙구 새봄동 1', '중앙구', '새봄동', '가상도 예시시 중앙구 시장로 23', '예시식당', '상가', '1층', '부재',
      '대상외', '', '', '', '',
      '', '', '', '', ''],
    ['', '중앙구', '푸른동', '가상도 예시시 중앙구 푸른로 108-1', '예시상점', '상가', '1층', '미방문',
      '중국어', '방문거절 이력있음', '', '', '',
      '2024-02-20', '거절', '방문자', '오전', '다시 오지 말라고 함'],
  ]
  const csvContent = [headers, ...data].map((row) => row.map(csvCell).join(',')).join('\n')
  const blob = new Blob(['﻿' + csvContent], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.setAttribute('href', url)
  link.setAttribute('download', 'building_import_example.csv')
  link.style.visibility = 'hidden'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}


/** parseBuildingCsv 가 바깥에서 받아야 하는 것들. 이것만 있으면 순수해진다. */
export type ParseBuildingCsvDeps = {
  cards: TerritoryCard[]
  cardBoundaries: CardBoundary[]
  /** 카드를 못 정했을 때 떨어뜨릴 '미배정 건물' 카드 */
  unassignedCardId?: number | null
  /** 주소 → 좌표. 시험에서는 가짜를 넣는다 */
  geocodeAddress: (address: string) => Promise<{ lat: number; lng: number } | null>
  /** 지역 이름들 (처인구·기흥구…). 카드명을 짐작할 때 쓴다.
   *  전역(getRegionNames)을 직접 읽으면 시험이 순서를 타서 인자로 받는다 */
  regionNames: string[]
}

export type ParseBuildingCsvResult = {
  ok: boolean
  /** ok 가 false 일 때만 있다 */
  error?: string
  headers: string[]
  rows: CsvPreviewRow[]
  skipped: number
  skippedDetails: CsvSkippedRow[]
}

/**
 * CSV 글자를 '올릴 건물 목록' 으로 바꾼다.
 *
 * DesktopTerritory 안에 300줄로 들어 있던 것을 그대로 옮겼다.
 * 화면에 붙어 있으면 시험할 수가 없어서, 실제로 어떻게 동작하는지
 * 아무도 확인하지 못한 채였다 (전화 조사 시트 판정, 업종→상가,
 * 구분 컬럼, 방문기록으로 상태 덮어쓰기 같은 규칙이 여기 다 있다).
 *
 * 화면은 파일 읽기와 결과 표시만 한다.
 */
export async function parseBuildingCsv(
  text: string,
  deps: ParseBuildingCsvDeps,
): Promise<ParseBuildingCsvResult> {
  const { cards, cardBoundaries, unassignedCardId, geocodeAddress, regionNames } = deps
    const rows = parseCsv(text)
    if (rows.length < 2) {
      return { ok: false, error: 'CSV에 헤더와 데이터 행이 필요합니다.', headers: [], rows: [], skipped: 0, skippedDetails: [] }
    }

    const headers = rows[0]
    const normalizedHeaders = headers.map(normalizeCsvKey)
    const findValue = (row: string[], keys: string[]) => {
      const normalizedKeys = keys.map(normalizeCsvKey)
      const index = normalizedHeaders.findIndex((header) => normalizedKeys.includes(header))
      return index >= 0 ? row[index]?.trim() ?? '' : ''
    }

    // 전화 조사 시트인지 — '업체ID' 칸은 플레이스 수집기 파일에만 있다.
    // 이 파일에서 중국어 칸이 비었다는 건 '아직 전화 안 함' 이므로 올리면 안 된다.
    // (일반 CSV 는 중국어 칸 자체가 없거나 비어 있는 게 정상이라 구분이 필요하다)
    const isSurveySheet = normalizedHeaders.includes(normalizeCsvKey('업체ID'))

    const previewRows: CsvPreviewRow[] = []
    const skippedDetails: CsvSkippedRow[] = []
    let skipped = 0
    const skipRow = (rowNumber: number, reason: string, hint: string, address?: string, rawRow?: string[]) => {
      skipped += 1
      skippedDetails.push({ rowNumber, reason, hint, address, rawRow })
    }

    // buildingKey → accumulated data (group rows by building)
    type AccumUnit = {
      status: UnitStatus
      isChinese: boolean
      isRestaurant: boolean
      naverPlaceId: string
      regularVisitor: string
      regularVisitorStartDate: string
      memo: string
      visitHistories: CsvVisitHistory[]
    }
    type AccumBuilding = {
      rowNumber: number
      cardId: number
      cardName: string
      name: string
      address: string
      type: CsvBuildingImport['type']
      lat: number
      lng: number
      warning: string
      units: Map<string, AccumUnit>
    }
    const buildingAccumulator = new Map<string, AccumBuilding>()

    for (const [index, row] of rows.slice(1).entries()) {
      const rowNumber = index + 2
      const cardIdValue = findValue(row, ['cardId', 'card_id', '카드ID', '카드아이디'])
      const cardNameValue = findValue(row, ['card', 'cardName', '카드', '카드명', '구역카드'])
      const regionValue = findValue(row, ['region', '지역', '대권역', '구', '시군구'])
      const fullRegionValue = findValue(row, ['지역명', '전체지역명'])
      const areaValue = findValue(row, ['area', 'dong', '동', '법정동'])
      const cardIndexValue = findValue(row, ['cardIndex', 'cardNo', '카드번호', '카드순번', '카드'])
      const rawAddressValue = findValue(row, ['address', '주소'])
      const detailAddressValue = findValue(row, ['detailAddress', '상세주소', '건물명상세주소', '건물명/상세주소'])
      const address = rawAddressValue.startsWith('경기') || rawAddressValue.startsWith('서울') || rawAddressValue.startsWith('인천')
        ? rawAddressValue
        : [fullRegionValue, rawAddressValue].filter(Boolean).join(' ')
      const nameValue = findValue(row, ['name', 'buildingName', '건물명', '건물']) || detailAddressValue
      const typeValue = findValue(row, ['type', '유형', '건물유형'])
      // 업종(순대·치킨·공장 등)은 유형(주택/상가)과 다른 값이다.
      // 유형 칸으로 읽으면 '상가' 라는 글자가 없어 전부 주택으로 떨어진다.
      // 업종이 있으면 상가로 보고, 음식 관련이면 식당으로도 표시한다.
      const industryValue = findValue(row, ['업종', '카테고리', 'category'])
      const restaurantValue = findValue(row, ['식당', '식당여부', 'restaurant'])
      // 네이버 업체ID — 다음 수집 때 이름·주소가 바뀌어도 같은 곳으로 이어 붙이는 열쇠
      const placeIdValue = findValue(row, ['업체ID', '업체아이디', 'placeId', 'place_id', 'naverPlaceId'])
      // '상호명' 은 전화 조사 시트(플레이스 수집기)가 쓰는 이름 — 상가는 상호가 곧 세대다
      const unitsValue = findValue(row, ['unit', 'units', '호수', '세대', '호수목록', '상호명', '업소명', '가게명'])
      const statusValue = findValue(row, ['status', '상태'])
      const divisionValue = findValue(row, ['구분', 'division'])
      const chineseValue = findValue(row, ['chinese', 'isChinese', '중국어', '중국어여부', '중국인', '중국인여부'])
      const warningValue = findValue(row, ['warning', '방문금지', '경고'])
      const regularVisitorValue = findValue(row, ['regularVisitor', 'regular', '정기방문자', '재방문자', '정기방문'])
      const regularStartValue = findValue(row, ['정기방문시작일', '정기방문시작', 'regularStart', 'regularVisitorStartDate'])
      const memoValue = findValue(row, ['memo', 'note', '메모', '비고', '备注', '조사메모'])
      const latValue = findValue(row, ['lat', 'latitude', '위도'])
      const lngValue = findValue(row, ['lng', 'lon', 'longitude', '경도'])
      // 방문기록 컬럼
      const visitDateValue = findValue(row, ['방문일자', 'visitDate', 'visited_at', '방문날짜'])
      const visitResultValue = findValue(row, ['방문결과', 'visitResult', 'result'])
      const visitVisitorValue = findValue(row, ['방문자', 'visitor', 'visitVisitor'])
      const visitTimeSlotValue = findValue(row, ['시간대', 'timeSlot', 'time_slot'])
      const visitMemoValue = findValue(row, ['방문메모', 'visitMemo', 'visitNote'])

      const inferredRegion = regionNames.find((region) => regionValue === region || fullRegionValue.includes(region))
      const inferredArea = areaValue || cards.find((item) => item.area && detailAddressValue.includes(item.area))?.area
      const inferredCardName = inferredRegion && inferredArea && cardIndexValue
        ? `${inferredRegion} ${inferredArea} ${cardIndexValue}`
        : ''
      const cardById = cardIdValue
        ? cards.find((item) => item.id === Number(cardIdValue))
        : undefined
      const cardByName = cards.find((item) =>
            item.name === cardNameValue ||
            item.name === inferredCardName ||
            `${item.region} ${item.area}` === cardNameValue,
          )
      const explicitCard = cardById ?? cardByName

      // 전화 조사 시트: 중국어를 쓰지 않는 곳까지 올리면 지도가 음식점 목록이 된다.
      // '없음'·'미확인' 은 등록하지 않고 건너뛴다 (조사한 사실은 조사 대장에 남는다).
      // ⚠ 빈칸은 전화 조사 시트가 아닌 일반 CSV 일 수 있으므로 거르지 않는다.
      const surveyAnswer = chineseValue.trim()
      if ((surveyAnswer || isSurveySheet) && !looksTruthy(surveyAnswer)) {
        skipRow(
          rowNumber,
          surveyAnswer ? `중국어 ${surveyAnswer} — 등록하지 않음` : '아직 전화 안 함 — 등록하지 않음',
          surveyAnswer
            ? '전화 조사에서 중국어를 쓰지 않는 곳으로 확인된 곳입니다. 지도에 올리지 않습니다.'
            : '통화 목록의 중국어 칸이 비어 있습니다. 전화한 뒤 있음/없음을 적어 주세요.',
          address,
          row,
        )
        continue
      }

      if (!address) {
        skipRow(rowNumber, '주소 없음', '`주소` 컬럼에 지번/도로명 주소를 넣어 주세요.', undefined, row)
        continue
      }

      if (cardIdValue && !cardById) {
        skipRow(
          rowNumber,
          '카드 ID 매칭 실패',
          'CSV의 cardId/카드ID가 앱의 실제 카드 ID와 일치하는지 확인하거나, 카드 ID 칸을 비워 주소 기반 자동 배정을 사용해 주세요.',
          address,
          row
        )
        continue
      }

      let coordinates = normalizeMapCoordinates(parseCoordinate(latValue), parseCoordinate(lngValue))
      if (!coordinates) {
        const geocoded = await geocodeAddress(address)
        if (!geocoded) {
          skipRow(rowNumber, '주소 좌표 변환 실패', '주소를 더 자세히 쓰거나 위도/경도를 직접 입력해 주세요.', address, row)
          continue
        }
        coordinates = geocoded
      }
      const { lat, lng } = coordinates

      const autoCardId = explicitCard ? null : findCardForCoordinates(lat, lng, cardBoundaries)
      let card = explicitCard ?? cards.find((item) => item.id === autoCardId)

      if (!card && unassignedCardId) {
        card = cards.find((item) => item.id === unassignedCardId)
      }

      if (!card) {
        skipRow(
          rowNumber,
          '자동 카드 배정 실패',
          'CSV에 카드명을 직접 넣거나, 해당 주소가 포함되는 카드 구역선을 먼저 그려 주세요. (미배정 건물 카드도 없습니다)',
          address,
          row
        )
        continue
      }

      const buildingName = nameValue || address.split(' ').slice(-2).join(' ') || '새 건물'
      const buildingType: CsvBuildingImport['type'] =
        typeValue.includes('상가') ? '상가'
        : typeValue.includes('주택') ? '주택'
        : industryValue ? '상가'          // 업종이 있으면 사업장 — 상가로 본다
        : '주택'
      const buildingKey = `${card.id}|${address}|${buildingName}`

      // 구분 컬럼: 대상외(구: 한국인) → false, 중국어(구: 중국인) → true, 없으면 heuristic
      const status = normalizeUnitStatus(statusValue)
      const normalizedDivision = divisionValue.trim()
      let isChinese: boolean
      if (['대상외', '한국인', '한국'].includes(normalizedDivision)) {
        isChinese = false
      } else if (['중국어', '중국인', '중국'].includes(normalizedDivision)) {
        isChinese = true
      } else if (chineseValue) {
        isChinese = looksTruthy(chineseValue)
      } else {
        isChinese = Boolean(regularVisitorValue) || status === '만남' || status === '부재'
      }

      // 방문기록 파싱
      const visitedAt = visitDateValue ? parseCsvDate(visitDateValue) : null
      // ⚠ visit_histories.result 는 '미방문' 을 CHECK 로 막는다 (안 간 것은 기록이
      //   아니니까). 알 수 없는 결과가 '미방문' 으로 떨어지면 그 건물이 통째로
      //   거부되므로, 방문기록 자체를 만들지 않는다.
      const visitResult = normalizeUnitStatus(visitResultValue || statusValue)
      const visitHistory: CsvVisitHistory | null = visitedAt && visitResult !== '미방문'
        ? {
          visitedAt,
          result: visitResult as string,
          visitor: visitVisitorValue,
          timeSlot: normalizeTimeSlot(visitTimeSlotValue),
          memo: visitMemoValue || undefined,
        }
        : null

      // 건물 누산
      if (!buildingAccumulator.has(buildingKey)) {
        buildingAccumulator.set(buildingKey, {
          rowNumber,
          cardId: card.id,
          cardName: card.name,
          name: buildingName,
          address,
          type: buildingType,
          lat,
          lng,
          warning: normalizeWarning(warningValue) ?? '',
          units: new Map(),
        })
      }
      const accum = buildingAccumulator.get(buildingKey)!
      // warning: if any row sets it, keep it
      if (!accum.warning && warningValue) {
        accum.warning = normalizeWarning(warningValue) ?? ''
      }

      // 세대 누산
      const unitNumber = unitsValue.trim() || '101'
      if (!accum.units.has(unitNumber)) {
        accum.units.set(unitNumber, {
          status,
          isChinese,
          isRestaurant: looksTruthy(restaurantValue),
          naverPlaceId: placeIdValue.trim(),
          regularVisitor: regularVisitorValue,
          regularVisitorStartDate: regularStartValue ? (parseCsvDate(regularStartValue) ?? regularStartValue) : '',
          memo: memoValue,
          visitHistories: [],
        })
      }
      if (visitHistory) {
        accum.units.get(unitNumber)!.visitHistories.push(visitHistory)
      }
    }

    // buildingAccumulator → previewRows
    for (const accum of buildingAccumulator.values()) {
      const builtUnits = Array.from(accum.units.entries()).map(([number, u]) => {
        // 방문기록이 있으면 가장 최신 날짜 기준으로 상태 결정
        let finalStatus = u.status
        if (u.visitHistories.length > 0) {
          const sorted = [...u.visitHistories].sort((a, b) => b.visitedAt.localeCompare(a.visitedAt))
          const latestResult = sorted[0]!.result
          if (latestResult && latestResult !== '미방문') finalStatus = latestResult as typeof finalStatus
        }
        return {
          number,
          status: finalStatus,
          isChinese: u.isChinese,
          isRestaurant: u.isRestaurant,
          naverPlaceId: u.naverPlaceId || undefined,
          isRegularVisit: Boolean(u.regularVisitor),
          regularVisitor: u.regularVisitor || undefined,
          regularVisitorStartDate: u.regularVisitorStartDate || undefined,
          memo: u.memo || undefined,
          visitHistories: u.visitHistories,
        }
      }).sort((a, b) => compareUnitNumbers(a.number, b.number))

      previewRows.push({
        rowNumber: accum.rowNumber,
        cardId: accum.cardId,
        cardName: accum.cardName,
        name: accum.name,
        address: accum.address,
        type: accum.type,
        lat: accum.lat,
        lng: accum.lng,
        warning: accum.warning || undefined,
        units: builtUnits.length > 0 ? builtUnits : [{ number: '101', status: '미방문' as UnitStatus, isChinese: false, isRestaurant: false, naverPlaceId: undefined, isRegularVisit: false, regularVisitor: undefined, regularVisitorStartDate: undefined, memo: undefined, visitHistories: [] }],
      })
    }

    return { ok: true, headers, rows: previewRows, skipped, skippedDetails }
}

/**
 * 파일을 읽어 파싱한다. **절대 던지지 않는다.**
 *
 * 왜 이렇게 하는가: 예전에는 화면이 try/finally 로 '분석 중' 을 풀어야 했다.
 * 그 한 줄을 빠뜨리면 사용자는 영영 '분석 중' 에 갇힌다. 실제로 그랬다.
 * 던지지 않는 문을 하나만 두면 화면이 잊을 수가 없다.
 */
export async function parseBuildingCsvFile(
  file: { text: () => Promise<string> },
  deps: ParseBuildingCsvDeps,
): Promise<ParseBuildingCsvResult> {
  const fail = (error: string): ParseBuildingCsvResult =>
    ({ ok: false, error, headers: [], rows: [], skipped: 0, skippedDetails: [] })
  let text: string
  try {
    text = await file.text()
  } catch (e) {
    console.error('[parseBuildingCsvFile] 파일 읽기 실패', e)
    return fail('파일을 읽지 못했습니다. 다시 선택해 주세요.')
  }
  try {
    return await parseBuildingCsv(text, deps)
  } catch (e) {
    console.error('[parseBuildingCsvFile] 파싱 실패', e)
    return fail('CSV를 읽는 중 문제가 생겼습니다. 파일을 확인해 주세요.')
  }
}
