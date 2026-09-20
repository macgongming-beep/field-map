import type { AppLanguage } from '../i18n'
import type { Building, ReturnVisit, ReturnVisitLog, Unit } from '../types'
import { buildingAddressKey } from './shortAddress'
import { canonicalUnitNumber } from './unitNumber'

export function normalizeVisitorName(value: string | null | undefined) {
  return (value ?? '').trim().replace(/\s+/g, '')
}

export function getUserReturnVisits(returnVisits: ReturnVisit[], currentVisitor: string) {
  const current = normalizeVisitorName(currentVisitor)
  return returnVisits.filter(
    (visit) => {
      const assigned = normalizeVisitorName(visit.assignedUserName)
      // 만든 사람이 다른 봉사자에게 배정한 항목까지 자기 목록에 섞이면 정기방문
      // 전용 화면에 타인의 항목이 보인다. SELECT 보안 경계가 아니라 화면 범위이며,
      // 미배정 옛 자료만 생성자를 fallback으로 쓴다.
      return assigned === current || (!assigned && normalizeVisitorName(visit.createdBy) === current)
    },
  )
}

function normalizeReturnVisitAddress(value: string | null | undefined) {
  return buildingAddressKey(value ?? '')
}

/**
 * 정기방문의 연결 정보가 오래됐어도 현재 건물을 최대한 안전하게 복구한다.
 * 주소 fallback은 정확히 같은 주소 하나만 있을 때만 사용해 엉뚱한 핀을 열지 않는다.
 */
export function findReturnVisitBuilding(returnVisit: ReturnVisit, buildings: Building[]) {
  if (returnVisit.buildingId != null) {
    const linked = buildings.find((building) => building.id === returnVisit.buildingId)
    if (linked) return linked
  }

  if (returnVisit.unitId != null) {
    const byUnit = buildings.find((building) => building.units.some((unit) => unit.id === returnVisit.unitId))
    if (byUnit) return byUnit
  }

  const address = normalizeReturnVisitAddress(returnVisit.address)
  if (!address) return null
  const matches = buildings.filter((building) => normalizeReturnVisitAddress(building.address) === address)
  return matches.length === 1 ? matches[0] : null
}

export function findReturnVisitUnit(returnVisit: ReturnVisit, building: Building): Unit | null {
  if (returnVisit.unitId != null) {
    const linked = building.units.find((unit) => unit.id === returnVisit.unitId)
    if (linked) return linked
  }

  const unitNumber = canonicalUnitNumber(returnVisit.unitNumber)
  if (!unitNumber) return null
  const matches = building.units.filter((unit) => canonicalUnitNumber(unit.number) === unitNumber)
  return matches.length === 1 ? matches[0] : null
}

export function getLatestReturnVisitDate(returnVisits: ReturnVisit[], returnVisitLogs: ReturnVisitLog[]) {
  const returnVisitIds = new Set(returnVisits.map((visit) => visit.id))
  const dates = [
    ...returnVisits.map((visit) => visit.lastVisitedAt).filter((value): value is string => !!value),
    ...returnVisitLogs
      .filter((log) => returnVisitIds.has(log.returnVisitId))
      .map((log) => log.visitedAt)
      .filter((value): value is string => !!value),
  ]

  return dates.sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] ?? null
}

export function formatRelativeVisitDate(value: string | null | undefined, language: AppLanguage = 'ko') {
  if (!value) {
    if (language === 'zh') return '还没有'
    if (language === 'en') return 'No visits yet'
    return '아직 없음'
  }

  const visited = new Date(value)
  if (Number.isNaN(visited.getTime())) {
    if (language === 'zh') return '还没有'
    if (language === 'en') return 'No visits yet'
    return '아직 없음'
  }

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  visited.setHours(0, 0, 0, 0)
  const diffDays = Math.max(0, Math.floor((today.getTime() - visited.getTime()) / 86_400_000))

  if (diffDays === 0) {
    if (language === 'zh') return '今天'
    if (language === 'en') return 'Today'
    return '오늘'
  }
  if (diffDays === 1) {
    if (language === 'zh') return '昨天'
    if (language === 'en') return 'Yesterday'
    return '어제'
  }
  if (diffDays < 7) {
    if (language === 'zh') return `${diffDays}天前`
    if (language === 'en') return `${diffDays}d ago`
    return `${diffDays}일 전`
  }
  if (diffDays < 30) {
    const weeks = Math.max(1, Math.floor(diffDays / 7))
    if (language === 'zh') return `${weeks}周前`
    if (language === 'en') return `${weeks}w ago`
    return `${weeks}주 전`
  }

  const months = Math.max(1, Math.floor(diffDays / 30))
  if (language === 'zh') return `${months}个月前`
  if (language === 'en') return `${months}mo ago`
  return `${months}개월 전`
}
