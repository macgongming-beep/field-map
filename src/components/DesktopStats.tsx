import React, { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Building, Role, ServiceSession, SpecialPeriod, TerritoryCard, TimeSlot, VisitHistory } from '../types'
import { toLocalDateString } from '../utils/dateUtils'

const TIME_SLOTS: TimeSlot[] = ['오전', '오후', '저녁']
type ScopeFilter = 'all' | 'regular' | number
type TrendMode = 'monthly' | 'weekly'

/* ── 색상 팔레트 (톤 통일) ──────────────────────────────────── */
const C = {
  ink: '#1e293b',
  text: '#334155',
  muted: '#64748b',
  subtle: '#94a3b8',
  line: '#e2e8f0',
  bg: '#f8fafc',
  surface: '#fff',
  // 의미 색상 — 채도 낮춘 톤
  green: '#3d8b5e',
  greenBg: '#f0f7f3',
  greenLight: '#d1e8da',
  amber: '#a16b1e',
  amberBg: '#faf6ee',
  amberLight: '#f0e4c8',
  red: '#b84040',
  redBg: '#fdf3f3',
  brand: '#475569',
  brandBg: '#f1f5f9',
}

/* ── SVG 꺾은선 차트 ──────────────────────────────────────── */
function LineChart({
  data,
  meetColor = C.green,
  totalColor = C.subtle,
}: {
  data: Array<{ label: string; total: number; meetings: number }>
  meetColor?: string
  totalColor?: string
}) {
  const W = 560, H = 90, PX = 10, PY = 8
  const maxV = Math.max(1, ...data.map(d => d.total))
  const n = data.length
  const tx = (i: number) => PX + (i / (n - 1)) * (W - PX * 2)
  const ty = (v: number) => PY + ((maxV - v) / maxV) * (H - PY * 2)
  const totalPts = data.map((d, i) => `${tx(i)},${ty(d.total)}`).join(' ')
  const meetPts  = data.map((d, i) => `${tx(i)},${ty(d.meetings)}`).join(' ')

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: H }} preserveAspectRatio="none">
      <polygon points={`${tx(0)},${H} ${totalPts} ${tx(n-1)},${H}`} fill={`${totalColor}15`} />
      <polyline points={totalPts} fill="none" stroke={totalColor} strokeWidth="1.5" strokeLinejoin="round" />
      <polygon points={`${tx(0)},${H} ${meetPts} ${tx(n-1)},${H}`} fill={`${meetColor}20`} />
      <polyline points={meetPts}  fill="none" stroke={meetColor}  strokeWidth="2" strokeLinejoin="round" />
      {data.map((d, i) => (
        <React.Fragment key={i}>
          <circle cx={tx(i)} cy={ty(d.total)}    r="3" fill={totalColor} />
          <circle cx={tx(i)} cy={ty(d.meetings)} r="2.5" fill={meetColor} />
        </React.Fragment>
      ))}
    </svg>
  )
}

/* ── 미니 진행바 ─────────────────────────────────────────── */
function MiniBar({ pct, color }: { pct: number; color: string }) {
  return (
    <div style={{ height: 4, background: C.line, borderRadius: 2, overflow: 'hidden', marginTop: 6 }}>
      <div style={{ width: `${Math.min(100, pct)}%`, height: '100%', background: color, borderRadius: 2, transition: 'width .4s' }} />
    </div>
  )
}

/* ── 스타일 상수 ─────────────────────────────────────────── */
const cardStyle: React.CSSProperties = {
  background: C.surface,
  borderRadius: 10,
  padding: '22px 24px',
  marginBottom: 14,
  border: `1px solid ${C.line}`,
}
const titleStyle: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 700,
  color: C.ink,
  margin: '0 0 16px',
  letterSpacing: '-0.01em',
}
const statBoxStyle = (bg = C.bg): React.CSSProperties => ({
  padding: '14px 16px',
  background: bg,
  borderRadius: 8,
})
const labelStyle: React.CSSProperties = {
  fontSize: 11,
  color: C.muted,
  fontWeight: 600,
  marginBottom: 4,
}
const bigNumStyle = (color = C.ink): React.CSSProperties => ({
  fontSize: 24,
  fontWeight: 800,
  color,
  fontVariantNumeric: 'tabular-nums',
})
const smallMeta: React.CSSProperties = {
  fontSize: 11,
  color: C.subtle,
  marginTop: 3,
}

export function DesktopStats({
  cards,
  buildings,
  visitHistories,
  serviceSessions,
  specialPeriods,
  actualRole,
}: {
  cards: TerritoryCard[]
  buildings: Building[]
  visitHistories: VisitHistory[]
  serviceSessions: ServiceSession[]
  specialPeriods: SpecialPeriod[]
  actualRole: Role
}) {
  const navigate = useNavigate()
  const isDeveloper = actualRole === 'developer'
  const [scope, setScope]               = useState<ScopeFilter>('all')
  const [trendMode, setTrendMode]       = useState<TrendMode>('monthly')
  const [cardTableOpen, setCardTableOpen]       = useState(false)
  const [selectedRegion, setSelectedRegion]     = useState<string | null>(null)
  const [selectedArea, setSelectedArea]         = useState<string | null>(null)

  // ── 필터 ──
  const filteredHistories = useMemo(() => {
    if (scope === 'all') return visitHistories
    if (scope === 'regular') return visitHistories.filter(h => !h.specialPeriodId)
    return visitHistories.filter(h => h.specialPeriodId === scope)
  }, [visitHistories, scope])

  // ── 1. 전체 요약 ──
  const summary = useMemo(() => {
    const total     = filteredHistories.length
    const meetings  = filteredHistories.filter(h => h.result === '만남').length
    const absences  = filteredHistories.filter(h => h.result === '부재').length
    const koreans   = filteredHistories.filter(h => h.result === '대상외').length
    const invitations = filteredHistories.filter(h => h.invitationLeft).length
    const meetingRate = total > 0 ? (meetings / total) * 100 : 0
    return { total, meetings, absences, koreans, invitations, meetingRate }
  }, [filteredHistories])

  // ── 2. 이번달 vs 지난달 ──
  const monthComparison = useMemo(() => {
    const now = new Date()
    const thisKey  = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    const prevDate = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const prevKey  = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`
    const rate = (arr: VisitHistory[]) => arr.length > 0 ? arr.filter(h => h.result === '만남').length / arr.length * 100 : 0
    const thisH = filteredHistories.filter(h => h.visitedAt.startsWith(thisKey))
    const prevH = filteredHistories.filter(h => h.visitedAt.startsWith(prevKey))
    return {
      this: { label: `${now.getMonth() + 1}월`, total: thisH.length, meetings: thisH.filter(h => h.result === '만남').length, rate: rate(thisH) },
      prev: { label: `${prevDate.getMonth() + 1}월`, total: prevH.length, meetings: prevH.filter(h => h.result === '만남').length, rate: rate(prevH) },
    }
  }, [filteredHistories])

  // ── 3. 중국인 세대 통계 ──
  const chineseStats = useMemo(() => {
    const ids = new Set<number>()
    for (const b of buildings) for (const u of b.units) if (u.isChinese) ids.add(u.id)
    const cH = filteredHistories.filter(h => ids.has(h.unitId))
    const total    = cH.length
    const meetings = cH.filter(h => h.result === '만남').length
    const absences = cH.filter(h => h.result === '부재').length
    const rate = total > 0 ? meetings / total * 100 : 0
    const slots = TIME_SLOTS.map(slot => {
      const sh = cH.filter(h => h.timeSlot === slot)
      const sm = sh.filter(h => h.result === '만남').length
      return { slot, total: sh.length, meetings: sm, rate: sh.length > 0 ? sm / sh.length * 100 : 0 }
    })
    return { totalUnits: ids.size, total, meetings, absences, rate, slots }
  }, [buildings, filteredHistories])

  // ── 4. 시간대별 통계 ──
  const slotStats = useMemo(() => TIME_SLOTS.map(slot => {
    const sh = filteredHistories.filter(h => h.timeSlot === slot)
    const meetings = sh.filter(h => h.result === '만남').length
    const absences = sh.filter(h => h.result === '부재').length
    return { slot, total: sh.length, meetings, absences, meetingRate: sh.length > 0 ? meetings / sh.length * 100 : 0, absenceRate: sh.length > 0 ? absences / sh.length * 100 : 0 }
  }), [filteredHistories])

  // ── 5. 결과 분포 ──
  const resultDistribution = useMemo(() => (
    ['만남', '부재', '대상외'] as const
  ).map(result => {
    const count = filteredHistories.filter(h => h.result === result).length
    const pct = filteredHistories.length > 0 ? count / filteredHistories.length * 100 : 0
    return { result, count, pct }
  }), [filteredHistories])

  // ── 7. 월별 추이 ──
  const monthlyTrend = useMemo(() => {
    const now = new Date()
    return Array.from({ length: 12 }, (_, idx) => {
      const i = 11 - idx
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      const mh = filteredHistories.filter(h => h.visitedAt.startsWith(key))
      return { label: `${d.getMonth() + 1}월`, total: mh.length, meetings: mh.filter(h => h.result === '만남').length }
    })
  }, [filteredHistories])

  // ── 8. 주간 추이 ──
  const weeklyTrend = useMemo(() => {
    const today = new Date()
    return Array.from({ length: 8 }, (_, idx) => {
      const w = 7 - idx
      const endDate = new Date(today); endDate.setDate(today.getDate() - w * 7)
      const startDate = new Date(endDate); startDate.setDate(endDate.getDate() - 6)
      const start = toLocalDateString(startDate)
      const end   = toLocalDateString(endDate)
      const wh = filteredHistories.filter(h => h.visitedAt >= start && h.visitedAt <= end)
      return { label: `${startDate.getMonth() + 1}/${startDate.getDate()}`, total: wh.length, meetings: wh.filter(h => h.result === '만남').length }
    })
  }, [filteredHistories])

  // ── 9. 카드별 통계 ──
  const cardStats = useMemo(() => {
    const byCard = new Map<number, Set<number>>()
    for (const b of buildings) {
      if (!byCard.has(b.cardId)) byCard.set(b.cardId, new Set())
      for (const u of b.units) byCard.get(b.cardId)!.add(u.id)
    }
    return cards.map(card => {
      const ids = byCard.get(card.id) ?? new Set()
      const ch  = filteredHistories.filter(h => ids.has(h.unitId))
      const visited  = new Set(ch.map(h => h.unitId)).size
      const meetings = ch.filter(h => h.result === '만남').length
      const absences = ch.filter(h => h.result === '부재').length
      const totalUnits = ids.size
      const visitRate   = totalUnits > 0 ? visited / totalUnits * 100 : 0
      const meetingRate = ch.length > 0 ? meetings / ch.length * 100 : 0
      return { cardId: card.id, name: card.name, region: card.region, area: card.area, totalUnits, visited, visitRate, meetings, absences, meetingRate, totalVisits: ch.length }
    }).sort((a, b) => b.visitRate - a.visitRate)
  }, [cards, buildings, filteredHistories])

  const allRegions = useMemo(() => [...new Set(cardStats.map(c => c.region))].filter(Boolean).sort(), [cardStats])
  const areasForRegion = useMemo(() =>
    selectedRegion ? [...new Set(cardStats.filter(c => c.region === selectedRegion).map(c => c.area))].filter(Boolean).sort() : [],
    [cardStats, selectedRegion]
  )
  const filteredCardStats = useMemo(() => cardStats.filter(c => {
    if (selectedRegion && c.region !== selectedRegion) return false
    if (selectedArea && c.area !== selectedArea) return false
    return true
  }), [cardStats, selectedRegion, selectedArea])

  // ── 10. 요일별 통계 ──
  const dayOfWeekStats = useMemo(() => {
    const DAY_LABELS = ['일', '월', '화', '수', '목', '금', '토']
    const IS_WEEKEND  = [true, false, false, false, false, false, true]
    const map = Array.from({ length: 7 }, () => ({ total: 0, meetings: 0, absences: 0 }))
    for (const h of filteredHistories) {
      const dow = new Date(h.visitedAt).getDay()
      map[dow].total++
      if (h.result === '만남') map[dow].meetings++
      if (h.result === '부재') map[dow].absences++
    }
    const ordered = [1, 2, 3, 4, 5, 6, 0].map((dow) => ({
      label: DAY_LABELS[dow],
      isWeekend: IS_WEEKEND[dow],
      ...map[dow],
      meetingRate: map[dow].total > 0 ? map[dow].meetings / map[dow].total * 100 : 0,
      absenceRate: map[dow].total > 0 ? map[dow].absences / map[dow].total * 100 : 0,
    }))
    const weekdays = ordered.filter((d) => !d.isWeekend)
    const weekends = ordered.filter((d) => d.isWeekend)
    const wdTotal = weekdays.reduce((s, d) => s + d.total, 0)
    const wdMeetings = weekdays.reduce((s, d) => s + d.meetings, 0)
    const weTotal = weekends.reduce((s, d) => s + d.total, 0)
    const weMeetings = weekends.reduce((s, d) => s + d.meetings, 0)
    return {
      days: ordered,
      weekday: { total: wdTotal, meetings: wdMeetings, rate: wdTotal > 0 ? wdMeetings / wdTotal * 100 : 0 },
      weekend: { total: weTotal, meetings: weMeetings, rate: weTotal > 0 ? weMeetings / weTotal * 100 : 0 },
    }
  }, [filteredHistories])

  // ── 10-b. 요일×시간대 히트맵 ──
  const daySlotMatrix = useMemo(() => {
    const map: Record<number, Record<string, { total: number; absences: number; meetings: number }>> = {}
    for (let d = 0; d < 7; d++) {
      map[d] = {}
      for (const slot of TIME_SLOTS) map[d][slot] = { total: 0, absences: 0, meetings: 0 }
    }
    for (const h of filteredHistories) {
      if (!h.timeSlot) continue
      const dow = new Date(h.visitedAt).getDay()
      const cell = map[dow][h.timeSlot]
      if (!cell) continue
      cell.total++
      if (h.result === '부재') cell.absences++
      if (h.result === '만남') cell.meetings++
    }
    const DAY_LABELS = ['일', '월', '화', '수', '목', '금', '토']
    const IS_WEEKEND  = [true, false, false, false, false, false, true]
    const days = [1, 2, 3, 4, 5, 6, 0].map((dow) => ({
      label: DAY_LABELS[dow],
      isWeekend: IS_WEEKEND[dow],
      slots: TIME_SLOTS.map((slot) => {
        const c = map[dow][slot]
        return {
          slot,
          total: c.total,
          absences: c.absences,
          meetings: c.meetings,
          absenceRate: c.total > 0 ? c.absences / c.total * 100 : null,
          meetingRate: c.total > 0 ? c.meetings / c.total * 100 : null,
        }
      }),
    }))
    const allRates = days.flatMap((d) => d.slots.map((s) => s.absenceRate ?? 0))
    const maxAbsence = Math.max(1, ...allRates)
    return { days, maxAbsence }
  }, [filteredHistories])

  // ── 11. 미방문 세대 ──
  const unvisitedStats = useMemo(() => {
    const allIds = new Set<number>()
    const chineseIds = new Set<number>()
    for (const b of buildings) {
      for (const u of b.units) {
        allIds.add(u.id)
        if (u.isChinese) chineseIds.add(u.id)
      }
    }
    const visitedIds = new Set(visitHistories.map((h) => h.unitId).filter((id) => allIds.has(id)))
    const total      = allIds.size
    const visited    = visitedIds.size
    const unvisited  = total - visited
    const chVisited  = [...chineseIds].filter((id) => visitedIds.has(id)).length
    const chUnvisited = chineseIds.size - chVisited
    return {
      total, visited, unvisited,
      visitedRate: total > 0 ? visited / total * 100 : 0,
      unvisitedRate: total > 0 ? unvisited / total * 100 : 0,
      chTotal: chineseIds.size, chVisited, chUnvisited,
      chVisitedRate: chineseIds.size > 0 ? chVisited / chineseIds.size * 100 : 0,
    }
  }, [buildings, visitHistories])

  // ── 11-b. 식당봉사 통계 ──
  const restaurantStats = useMemo(() => {
    const rh = visitHistories.filter((h) => h.visitType === 'restaurant')
    const total = rh.length

    // 봉사자별
    const byVisitor = new Map<string, number>()
    for (const h of rh) byVisitor.set(h.visitor, (byVisitor.get(h.visitor) ?? 0) + 1)
    const topVisitors = Array.from(byVisitor.entries())
      .map(([visitor, count]) => ({ visitor, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10)

    // 식당별 (unit_id → building name)
    const unitToBuilding = new Map<number, string>()
    for (const b of buildings) {
      if (!b.isRestaurant) continue
      for (const u of b.units) unitToBuilding.set(u.id, b.name || b.address)
    }
    const byRestaurant = new Map<string, number>()
    for (const h of rh) {
      const name = unitToBuilding.get(h.unitId) ?? '알 수 없음'
      byRestaurant.set(name, (byRestaurant.get(name) ?? 0) + 1)
    }
    const topRestaurants = Array.from(byRestaurant.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10)

    // 월별
    const now = new Date()
    const monthly = Array.from({ length: 6 }, (_, idx) => {
      const i = 5 - idx
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      return { label: `${d.getMonth() + 1}월`, count: rh.filter((h) => h.visitedAt.startsWith(key)).length }
    })

    // 고유 식당 수
    const uniqueRestaurants = new Set(rh.map((h) => h.unitId)).size

    return { total, topVisitors, topRestaurants, monthly, uniqueRestaurants }
  }, [visitHistories, buildings])

  // ── 12. 봉사자별 (개발자 전용) ──
  const visitorStats = useMemo(() => {
    if (!isDeveloper) return []
    const map = new Map<string, { total: number; meetings: number; absences: number; invitations: number }>()
    for (const h of filteredHistories) {
      if (!map.has(h.visitor)) map.set(h.visitor, { total: 0, meetings: 0, absences: 0, invitations: 0 })
      const s = map.get(h.visitor)!
      s.total++
      if (h.result === '만남') s.meetings++
      if (h.result === '부재') s.absences++
      if (h.invitationLeft) s.invitations++
    }
    return Array.from(map.entries())
      .map(([visitor, s]) => ({ visitor, ...s, meetingRate: s.total > 0 ? s.meetings / s.total * 100 : 0 }))
      .sort((a, b) => b.total - a.total)
  }, [filteredHistories, isDeveloper])

  const sessionTimeStats = useMemo(() => {
    if (!isDeveloper) return []
    const map = new Map<string, { sessions: number; minutes: number }>()
    for (const s of serviceSessions) {
      if (!s.endedAt || !s.startedAt) continue
      const dur = (new Date(s.endedAt).getTime() - new Date(s.startedAt).getTime()) / 60000
      if (!map.has(s.userName)) map.set(s.userName, { sessions: 0, minutes: 0 })
      const x = map.get(s.userName)!; x.sessions++; x.minutes += dur
    }
    return Array.from(map.entries())
      .map(([visitor, s]) => ({ visitor, sessions: s.sessions, hours: Math.round(s.minutes / 60 * 10) / 10 }))
      .sort((a, b) => b.hours - a.hours)
  }, [serviceSessions, isDeveloper])

  const trendData = trendMode === 'monthly' ? monthlyTrend : weeklyTrend
  const diff = monthComparison.this.rate - monthComparison.prev.rate
  const diffColor = diff > 0 ? C.green : diff < 0 ? C.red : C.muted

  /* ── 공통 칩 버튼 ─────────────────────────────────────────── */
  const chipBtn = (active: boolean, accent = C.ink): React.CSSProperties => ({
    padding: '5px 13px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer',
    border: `1px solid ${active ? accent : C.line}`,
    background: active ? `${accent}0d` : C.surface,
    color: active ? accent : C.muted,
    transition: 'all .15s',
  })

  /* ── 테이블 공통 스타일 ─────────────────────────────────────── */
  const thStyle = (align: 'left' | 'right' = 'right'): React.CSSProperties => ({
    padding: '10px 8px', fontSize: 11, color: C.muted, fontWeight: 600, textAlign: align,
    borderBottom: `1.5px solid ${C.line}`, letterSpacing: '0.02em',
  })
  const tdStyle = (align: 'left' | 'right' = 'right'): React.CSSProperties => ({
    padding: '9px 8px', textAlign: align, fontSize: 13, color: C.text,
  })

  /* ── 결과별 색상 (절제된 팔레트) ───────────────────────────── */
  const resultColor = (r: string) =>
    r === '만남' ? C.green : r === '부재' ? C.amber : C.brand

  return (
    <section style={{ display: 'flex', flexDirection: 'column', padding: '32px', width: '100%', maxWidth: 1060, margin: '0 auto' }}>
      <header className="page-header">
        <div className="page-header-text">
          <h1 className="page-header-title">통계</h1>
        </div>
        {(actualRole === 'admin' || actualRole === 'developer') && (
          <button type="button" className="secondary-button" onClick={() => navigate('/stats/chinese-report')}>
            구역 관리 보고서
          </button>
        )}
      </header>

      {/* ── 분석 범위 ── */}
      <div style={cardStyle}>
        <h2 style={titleStyle}>분석 범위</h2>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {[
            { key: 'all' as ScopeFilter, label: '전체' },
            { key: 'regular' as ScopeFilter, label: '봉사' },
            ...specialPeriods.map(p => ({ key: p.id as ScopeFilter, label: p.label })),
          ].map(({ key, label }) => (
            <button key={String(key)} onClick={() => setScope(key)} type="button" style={chipBtn(scope === key)}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ── 전체 요약 ── */}
      <div style={cardStyle}>
        <h2 style={titleStyle}>전체 요약</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 8 }}>
          {[
            { label: '총 방문', value: summary.total, color: C.ink },
            { label: '만남',   value: summary.meetings, color: C.green, pct: summary.meetingRate },
            { label: '부재',   value: summary.absences, color: C.amber, pct: summary.total > 0 ? summary.absences / summary.total * 100 : 0 },
            { label: '대상외', value: summary.koreans,  color: C.brand, pct: summary.total > 0 ? summary.koreans / summary.total * 100 : 0 },
            { label: '만남률', value: `${summary.meetingRate.toFixed(1)}%`, color: C.green, pct: summary.meetingRate },
            ...(scope !== 'regular' && scope !== 'all' ? [{ label: '초대장', value: summary.invitations, color: C.amber, pct: summary.total > 0 ? summary.invitations / summary.total * 100 : 0 }] : []),
          ].map(s => (
            <div key={s.label} style={statBoxStyle()}>
              <div style={labelStyle}>{s.label}</div>
              <div style={bigNumStyle(s.color)}>{s.value}</div>
              {'pct' in s && s.pct != null && <MiniBar pct={s.pct as number} color={s.color} />}
            </div>
          ))}
        </div>
      </div>

      {/* ── 이번달 vs 지난달 ── */}
      <div style={cardStyle}>
        <h2 style={titleStyle}>월간 비교</h2>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 16, alignItems: 'center' }}>
          <div style={statBoxStyle()}>
            <div style={labelStyle}>{monthComparison.prev.label}</div>
            <div style={bigNumStyle(C.text)}>{monthComparison.prev.rate.toFixed(1)}<span style={{ fontSize: 13, fontWeight: 600, color: C.muted }}>%</span></div>
            <div style={smallMeta}>만남 {monthComparison.prev.meetings} / 방문 {monthComparison.prev.total}</div>
            <MiniBar pct={monthComparison.prev.rate} color={C.subtle} />
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 18, color: diffColor, fontWeight: 600 }}>{diff > 0 ? '↑' : diff < 0 ? '↓' : '→'}</div>
            <div style={{ fontSize: 11, fontWeight: 700, color: diffColor }}>{diff === 0 ? '동일' : `${Math.abs(diff).toFixed(1)}%p`}</div>
          </div>
          <div style={statBoxStyle(C.greenBg)}>
            <div style={{ ...labelStyle, color: C.green }}>{monthComparison.this.label} (이번달)</div>
            <div style={bigNumStyle(C.green)}>{monthComparison.this.rate.toFixed(1)}<span style={{ fontSize: 13, fontWeight: 600, color: C.green }}>%</span></div>
            <div style={smallMeta}>만남 {monthComparison.this.meetings} / 방문 {monthComparison.this.total}</div>
            <MiniBar pct={monthComparison.this.rate} color={C.green} />
          </div>
        </div>
      </div>

      {/* ── 미방문 세대 현황 ── */}
      <div style={cardStyle}>
        <h2 style={titleStyle}>미방문 세대 현황</h2>
        <div style={{ display: 'grid', gridTemplateColumns: unvisitedStats.chTotal > 0 ? '1fr 1fr' : '1fr', gap: 10 }}>
          <div style={statBoxStyle()}>
            <div style={labelStyle}>전체 세대</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
              <span style={bigNumStyle(C.red)}>{unvisitedStats.unvisited.toLocaleString()}</span>
              <span style={{ fontSize: 13, color: C.subtle }}>/ {unvisitedStats.total.toLocaleString()}</span>
            </div>
            <div style={smallMeta}>미방문 {unvisitedStats.unvisitedRate.toFixed(1)}% · 방문완료 {unvisitedStats.visitedRate.toFixed(1)}%</div>
            <div style={{ marginTop: 8, height: 5, background: C.line, borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ width: `${unvisitedStats.visitedRate}%`, height: '100%', background: C.green, borderRadius: 3, transition: 'width .4s' }} />
            </div>
          </div>
          {unvisitedStats.chTotal > 0 && (
            <div style={statBoxStyle(C.amberBg)}>
              <div style={{ ...labelStyle, color: C.amber }}>중국인 세대</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                <span style={bigNumStyle(C.amber)}>{unvisitedStats.chUnvisited.toLocaleString()}</span>
                <span style={{ fontSize: 13, color: C.amber }}>/ {unvisitedStats.chTotal}</span>
              </div>
              <div style={{ ...smallMeta, color: C.amber }}>미방문 {unvisitedStats.chTotal > 0 ? ((unvisitedStats.chUnvisited / unvisitedStats.chTotal) * 100).toFixed(1) : 0}%</div>
              <div style={{ marginTop: 8, height: 5, background: C.amberLight, borderRadius: 3, overflow: 'hidden' }}>
                <div style={{ width: `${unvisitedStats.chVisitedRate}%`, height: '100%', background: C.amber, borderRadius: 3, transition: 'width .4s' }} />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── 결과 분포 ── */}
      <div style={cardStyle}>
        <h2 style={titleStyle}>결과 분포</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {resultDistribution.map(r => (
            <div key={r.result} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ width: 48, fontSize: 12, fontWeight: 600, color: C.text }}>{r.result}</div>
              <div style={{ flex: 1, height: 14, background: C.bg, borderRadius: 7, overflow: 'hidden' }}>
                <div style={{
                  width: `${r.pct}%`, height: '100%', transition: 'width .3s', borderRadius: 7,
                  background: resultColor(r.result),
                  opacity: 0.7,
                }} />
              </div>
              <div style={{ width: 90, fontSize: 12, textAlign: 'right', color: C.text }}>
                <strong>{r.count}건</strong> <span style={{ color: C.subtle }}>({r.pct.toFixed(1)}%)</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── 시간대별 분석 ── */}
      <div style={cardStyle}>
        <h2 style={titleStyle}>시간대별 분석</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
          {slotStats.map(s => {
            const best = slotStats.reduce((a, b) => a.meetingRate > b.meetingRate ? a : b)
            const isBest = s.slot === best.slot && s.total > 0
            return (
              <div key={s.slot} style={{
                ...statBoxStyle(isBest ? C.greenBg : C.bg),
                border: isBest ? `1px solid ${C.greenLight}` : 'none',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{s.slot}</div>
                  {isBest && <span style={{ fontSize: 10, fontWeight: 600, color: C.green, background: C.greenLight, padding: '2px 7px', borderRadius: 4 }}>최고</span>}
                </div>
                <div style={{ marginBottom: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: C.green, fontWeight: 600, marginBottom: 3 }}>
                    <span>만남률</span><span>{s.meetingRate.toFixed(1)}% <span style={{ fontWeight: 400, color: C.subtle }}>({s.meetings}건)</span></span>
                  </div>
                  <MiniBar pct={s.meetingRate} color={C.green} />
                </div>
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: C.amber, fontWeight: 600, marginBottom: 3 }}>
                    <span>부재율</span><span>{s.absenceRate.toFixed(1)}% <span style={{ fontWeight: 400, color: C.subtle }}>({s.absences}건)</span></span>
                  </div>
                  <MiniBar pct={s.absenceRate} color={C.amber} />
                </div>
                <div style={{ marginTop: 8, fontSize: 10, color: C.subtle }}>총 {s.total}회</div>
              </div>
            )
          })}
        </div>
      </div>

      {/* ── 요일별 만남률 ── */}
      <div style={cardStyle}>
        <h2 style={titleStyle}>요일별 만남률</h2>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
          {[
            { label: '평일 평균', ...dayOfWeekStats.weekday },
            { label: '주말 평균', ...dayOfWeekStats.weekend },
          ].map(g => (
            <div key={g.label} style={statBoxStyle()}>
              <div style={labelStyle}>{g.label}</div>
              <div style={bigNumStyle(C.ink)}>{g.rate.toFixed(1)}<span style={{ fontSize: 13, color: C.muted }}>%</span></div>
              <div style={smallMeta}>만남 {g.meetings} / {g.total}회</div>
            </div>
          ))}
        </div>
        {/* 요일 바 차트 */}
        <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end', height: 100 }}>
          {dayOfWeekStats.days.map((d) => {
            const maxRate = Math.max(1, ...dayOfWeekStats.days.map(x => x.meetingRate))
            const barH = d.total > 0 ? Math.max(8, (d.meetingRate / maxRate) * 80) : 4
            return (
              <div key={d.label} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: d.meetingRate >= maxRate * 0.8 ? C.green : C.subtle }}>
                  {d.total > 0 ? `${d.meetingRate.toFixed(0)}%` : '-'}
                </div>
                <div style={{
                  width: '100%', borderRadius: '3px 3px 0 0',
                  height: barH,
                  background: d.isWeekend ? (C.muted) : (d.meetingRate >= maxRate * 0.8 ? C.green : C.subtle),
                  opacity: d.isWeekend ? 0.4 : 0.6,
                  transition: 'height .3s',
                }} />
                <div style={{ fontSize: 12, fontWeight: 600, color: d.isWeekend ? C.muted : C.text }}>{d.label}</div>
                <div style={{ fontSize: 9, color: C.subtle }}>{d.total > 0 ? `${d.total}회` : ''}</div>
              </div>
            )
          })}
        </div>

        {/* 요일×시간대 히트맵 */}
        <div style={{ marginTop: 20, borderTop: `1px solid ${C.line}`, paddingTop: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: C.text, marginBottom: 10 }}>
            시간대별 부재율 <span style={{ fontSize: 11, fontWeight: 400, color: C.subtle }}>— 진할수록 부재 비율 높음</span>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 3, fontSize: 12 }}>
              <thead>
                <tr>
                  <th style={{ width: 44, textAlign: 'left', fontSize: 11, color: C.subtle, fontWeight: 600, paddingBottom: 4 }} />
                  {daySlotMatrix.days.map((d) => (
                    <th key={d.label} style={{ textAlign: 'center', fontSize: 11, fontWeight: 600, color: d.isWeekend ? C.muted : C.text, paddingBottom: 4 }}>
                      {d.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {TIME_SLOTS.map((slot) => (
                  <tr key={slot}>
                    <td style={{ fontSize: 11, color: C.muted, fontWeight: 600, paddingRight: 6, whiteSpace: 'nowrap' }}>{slot}</td>
                    {daySlotMatrix.days.map((d) => {
                      const cell = d.slots.find((s) => s.slot === slot)!
                      const rate = cell.absenceRate
                      const intensity = rate !== null ? rate / daySlotMatrix.maxAbsence : 0
                      const bg = rate === null
                        ? C.bg
                        : rate === 0
                          ? C.greenBg
                          : `rgba(180,64,64,${Math.max(0.06, intensity * 0.5)})`
                      const textColor = rate === null ? C.subtle : intensity > 0.7 ? '#fff' : C.ink
                      return (
                        <td key={slot + d.label} style={{ textAlign: 'center', padding: '7px 4px', borderRadius: 5, background: bg, transition: 'background .2s' }}>
                          <div style={{ fontSize: 12, fontWeight: 600, color: textColor }}>
                            {rate === null ? '–' : `${rate.toFixed(0)}%`}
                          </div>
                          {cell.total > 0 && (
                            <div style={{ fontSize: 9, color: intensity > 0.7 ? 'rgba(255,255,255,0.6)' : C.subtle, marginTop: 1 }}>
                              {cell.absences}/{cell.total}
                            </div>
                          )}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* ── 중국인 세대 분석 ── */}
      {chineseStats.totalUnits > 0 && (
        <div style={cardStyle}>
          <h2 style={titleStyle}>중국인 세대 분석</h2>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <div style={statBoxStyle(C.amberBg)}>
              <div style={{ ...labelStyle, color: C.amber }}>만남률</div>
              <div style={bigNumStyle(C.amber)}>{chineseStats.rate.toFixed(1)}<span style={{ fontSize: 13 }}>%</span></div>
              <div style={{ ...smallMeta, color: C.amber }}>만남 {chineseStats.meetings} / 방문 {chineseStats.total} · {chineseStats.totalUnits}세대</div>
              <MiniBar pct={chineseStats.rate} color={C.amber} />
            </div>
            <div>
              <div style={{ ...labelStyle, marginBottom: 8 }}>시간대별 만남률</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                {chineseStats.slots.map(sl => (
                  <div key={sl.slot} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 32, fontSize: 12, fontWeight: 600, color: C.text }}>{sl.slot}</div>
                    <div style={{ flex: 1, height: 10, background: C.bg, borderRadius: 5, overflow: 'hidden' }}>
                      <div style={{ width: `${sl.rate}%`, height: '100%', background: C.amber, opacity: 0.7, transition: 'width .3s' }} />
                    </div>
                    <div style={{ width: 56, fontSize: 11, textAlign: 'right', fontWeight: 600, color: C.amber }}>
                      {sl.rate.toFixed(1)}% <span style={{ fontSize: 10, color: C.subtle, fontWeight: 400 }}>({sl.total})</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── 방문 추이 ── */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <h2 style={{ ...titleStyle, margin: 0 }}>방문 추이</h2>
          <div style={{ display: 'flex', gap: 4 }}>
            {(['monthly', 'weekly'] as TrendMode[]).map(m => (
              <button key={m} onClick={() => setTrendMode(m)} type="button" style={chipBtn(trendMode === m)}>
                {m === 'monthly' ? '월별' : '주별'}
              </button>
            ))}
          </div>
        </div>
        <LineChart data={trendData} />
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, padding: '0 8px' }}>
          {trendData.map((d, i) => (
            <div key={i} style={{ fontSize: 10, color: C.subtle, flex: 1, textAlign: 'center' }}>{d.label}</div>
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'center', gap: 14, marginTop: 10, fontSize: 11, color: C.muted }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ display: 'inline-block', width: 10, height: 2, background: C.green, borderRadius: 1 }} />만남</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ display: 'inline-block', width: 10, height: 2, background: C.subtle, borderRadius: 1 }} />총 방문</span>
        </div>
      </div>

      {/* ── 카드별 상세 ── */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: cardTableOpen ? 14 : 0 }}>
          <h2 style={{ ...titleStyle, margin: 0 }}>카드별 상세</h2>
          <button
            onClick={() => setCardTableOpen(v => !v)}
            style={{ fontSize: 12, color: C.muted, background: C.bg, border: `1px solid ${C.line}`, borderRadius: 5, padding: '4px 10px', cursor: 'pointer', fontWeight: 600 }}
          >
            {cardTableOpen ? '닫기 ▲' : '열기 ▼'}
          </button>
        </div>

        {cardTableOpen && (
          <>
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 8 }}>
              <button onClick={() => { setSelectedRegion(null); setSelectedArea(null) }} style={chipBtn(selectedRegion === null)} type="button">전체</button>
              {allRegions.map(r => (
                <button key={r} onClick={() => { setSelectedRegion(r); setSelectedArea(null) }} style={chipBtn(selectedRegion === r)} type="button">{r}</button>
              ))}
            </div>

            {selectedRegion && areasForRegion.length > 0 && (
              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 10, paddingLeft: 8, borderLeft: `2px solid ${C.line}` }}>
                <button onClick={() => setSelectedArea(null)} style={chipBtn(selectedArea === null)} type="button">전체</button>
                {areasForRegion.map(a => (
                  <button key={a} onClick={() => setSelectedArea(a)} style={chipBtn(selectedArea === a)} type="button">{a}</button>
                ))}
              </div>
            )}

            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr>
                    {['카드', '방문률', '방문/세대', '만남률', '만남/총방문'].map(h => (
                      <th key={h} style={thStyle(h === '카드' ? 'left' : 'right')}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredCardStats.map(c => (
                    <tr key={c.cardId} style={{ borderBottom: `1px solid ${C.bg}` }}>
                      <td style={tdStyle('left')}>
                        <div style={{ fontWeight: 600, color: C.ink }}>{c.name}</div>
                        {(c.region || c.area) && (
                          <div style={{ fontSize: 10, color: C.subtle, marginTop: 1 }}>{[c.region, c.area].filter(Boolean).join(' · ')}</div>
                        )}
                      </td>
                      <td style={tdStyle()}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }}>
                          <div style={{ width: 48, height: 4, background: C.bg, borderRadius: 2, overflow: 'hidden' }}>
                            <div style={{ width: `${c.visitRate}%`, height: '100%', background: c.visitRate >= 80 ? C.green : C.subtle }} />
                          </div>
                          <strong style={{ minWidth: 36, color: C.ink }}>{c.visitRate.toFixed(0)}%</strong>
                        </div>
                      </td>
                      <td style={tdStyle()}>{c.visited} / {c.totalUnits}</td>
                      <td style={{ ...tdStyle(), fontWeight: 600, color: c.meetingRate >= 30 ? C.green : C.subtle }}>{c.meetingRate.toFixed(1)}%</td>
                      <td style={tdStyle()}>{c.meetings} / {c.totalVisits}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filteredCardStats.length === 0 && (
                <p style={{ fontSize: 12, color: C.subtle, textAlign: 'center', padding: '20px 0' }}>해당 구역의 카드가 없습니다</p>
              )}
            </div>
          </>
        )}
      </div>

      {/* ── 식당봉사 통계 ── */}
      {restaurantStats.total > 0 && (
        <div style={cardStyle}>
          <h2 style={titleStyle}>🍜 식당봉사</h2>
          {/* 요약 */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 20 }}>
            {[
              { label: '총 방문', value: restaurantStats.total.toLocaleString(), color: C.ink },
              { label: '방문 식당 수', value: `${restaurantStats.uniqueRestaurants}곳`, color: C.ink },
              { label: '이번 달', value: `${restaurantStats.monthly[restaurantStats.monthly.length - 1].count}건`, color: C.ink },
            ].map(({ label, value, color }) => (
              <div key={label} style={{ background: C.bg, borderRadius: 10, padding: '14px 16px', border: `1px solid ${C.line}` }}>
                <div style={{ fontSize: 11, color: C.muted, fontWeight: 600, marginBottom: 6 }}>{label}</div>
                <div style={{ fontSize: 22, fontWeight: 800, color }}>{value}</div>
              </div>
            ))}
          </div>

          {/* 월별 추이 */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.muted, marginBottom: 10 }}>최근 6개월</div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end', height: 60 }}>
              {restaurantStats.monthly.map(({ label, count }) => {
                const maxCount = Math.max(1, ...restaurantStats.monthly.map((m) => m.count))
                const h = Math.max(4, (count / maxCount) * 52)
                return (
                  <div key={label} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                    <div style={{ fontSize: 10, color: C.muted }}>{count > 0 ? count : ''}</div>
                    <div style={{ width: '100%', height: h, background: C.ink, borderRadius: 3, opacity: count === 0 ? 0.15 : 1 }} />
                    <div style={{ fontSize: 10, color: C.muted }}>{label}</div>
                  </div>
                )
              })}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            {/* 자주 간 식당 */}
            {restaurantStats.topRestaurants.length > 0 && (
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: C.muted, marginBottom: 8 }}>자주 방문한 식당</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {restaurantStats.topRestaurants.slice(0, 5).map(({ name, count }) => (
                    <div key={name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: `1px solid ${C.line}` }}>
                      <span style={{ fontSize: 13, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '75%' }}>{name}</span>
                      <span style={{ fontSize: 12, fontWeight: 700, color: C.ink }}>{count}회</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {/* 봉사자별 */}
            {restaurantStats.topVisitors.length > 0 && (
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: C.muted, marginBottom: 8 }}>봉사자별 식당봉사</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {restaurantStats.topVisitors.slice(0, 5).map(({ visitor, count }) => (
                    <div key={visitor} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: `1px solid ${C.line}` }}>
                      <span style={{ fontSize: 13, color: C.text }}>{visitor}</span>
                      <span style={{ fontSize: 12, fontWeight: 700, color: C.ink }}>{count}건</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── 봉사자별 (개발자 전용) ── */}
      {isDeveloper && visitorStats.length > 0 && (
        <div style={cardStyle}>
          <h2 style={titleStyle}>봉사자별 활동량</h2>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr>
                  {['봉사자','방문','만남','부재','만남률','초대장'].map(h => (
                    <th key={h} style={thStyle(h === '봉사자' ? 'left' : 'right')}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visitorStats.map(v => (
                  <tr key={v.visitor} style={{ borderBottom: `1px solid ${C.bg}` }}>
                    <td style={{ ...tdStyle('left'), fontWeight: 600, color: C.ink }}>{v.visitor}</td>
                    <td style={tdStyle()}><strong>{v.total}</strong></td>
                    <td style={{ ...tdStyle(), color: C.green }}>{v.meetings}</td>
                    <td style={{ ...tdStyle(), color: C.amber }}>{v.absences}</td>
                    <td style={{ ...tdStyle(), fontWeight: 600, color: v.meetingRate >= 30 ? C.green : C.subtle }}>{v.meetingRate.toFixed(1)}%</td>
                    <td style={{ ...tdStyle(), color: C.amber }}>{v.invitations}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {isDeveloper && sessionTimeStats.length > 0 && (
        <div style={cardStyle}>
          <h2 style={titleStyle}>봉사자별 누적 시간</h2>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr>
                  {['봉사자','세션','누적 시간'].map(h => (
                    <th key={h} style={thStyle(h === '봉사자' ? 'left' : 'right')}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sessionTimeStats.map(s => (
                  <tr key={s.visitor} style={{ borderBottom: `1px solid ${C.bg}` }}>
                    <td style={{ ...tdStyle('left'), fontWeight: 600, color: C.ink }}>{s.visitor}</td>
                    <td style={tdStyle()}>{s.sessions}회</td>
                    <td style={{ ...tdStyle(), fontWeight: 600, color: C.ink }}>{s.hours}시간</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  )
}
