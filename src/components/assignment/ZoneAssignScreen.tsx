import { teamServiceEnabled } from '../../config/teamService'
// 화면2 — 구역 배분 (sticky 팀바 + 목록/지도 토글)
// 설계: docs/leader-assignment-redesign.md v3 §3.3
//
// Phase 2: 목록 뷰 구현. 지도 뷰는 Phase 3 (stub).
// 활성팀에 카드 배정/해제. 다른 팀 카드 탭 = 활성팀으로 이동 + undo.
// 모든 상태는 draft 단일 reducer에서 파생.

import { useMemo, useState } from 'react'
import { getRegionNames, stripRegionPrefix } from '../../lib/regions'
import type { Dispatch } from 'react'
import type { Building, CardBoundary, EventInformalAssignment, EventRestaurantAssignment, InformalAsset, InformalGroup, TerritoryCard, VisitHistory } from '../../types'
import { assignableInformalAssets } from '../../utils/informalAssets'
import { getRestaurantUnits } from '../../utils/restaurants'
import { t, currentLang } from '../../i18n'
import { showToast } from '../../lib/toast'
import type { DraftAction, DraftTeam } from '../../hooks/assignmentDraft'
import { teamHex } from './teamColors'
import { sortTerritoryCardsByOperationalPriority } from '../../utils/cardSearch'
import { MapCanvas } from '../MapCanvas'
import { InformalKindIcon } from '../InformalKindIcon'
import { getBuildingStatus } from '../../utils/mapUtils'
import { msg } from '../../lib/msg'
import { buildingHasUsage, scopeBuildingToUsage, unitsForUsage } from '../../utils/unitUsage'
import { scopeServiceBuildings } from '../../utils/cardServiceScope'

type BuildingTypeFilter = '전체' | '주택' | '상가'

type Props = {
  teams: DraftTeam[]
  activeTeamId: string | null
  cards: TerritoryCard[]           // 인도자 담당 카드 (배정 대상)
  buildings: Building[]
  visitHistories?: VisitHistory[]
  cardBoundaries: CardBoundary[]
  canEdit: boolean
  dispatch: Dispatch<DraftAction>
  eventId: number
  currentVisitor: string
  allCards?: TerritoryCard[]        // 전체 카드 (식당 구 그룹용)
  informalAssets?: InformalAsset[]
  informalGroups?: InformalGroup[]
  eventInformalAssignments?: EventInformalAssignment[]
  eventRestaurantAssignments?: EventRestaurantAssignment[]
  onAssignInformalToUser?: (input: { eventId: number; userName: string; assetId: number; assignedBy: string }) => Promise<boolean>
  onRemoveInformalAssignment?: (assignmentId: number) => Promise<void>
  onAssignRestaurantToUser?: (input: { eventId: number; userName: string; buildingId: number; unitId?: number | null; assignedBy: string }) => Promise<boolean>
  onRemoveRestaurantAssignment?: (assignmentId: number) => Promise<void>
  onBack: () => void
}

type ViewMode = 'list' | 'map'




export function ZoneAssignScreen({ teams, activeTeamId, cards, buildings, visitHistories = [], cardBoundaries, canEdit, dispatch, eventId, currentVisitor, allCards = [], informalAssets = [], informalGroups = [], eventInformalAssignments = [], eventRestaurantAssignments = [], onAssignInformalToUser, onRemoveInformalAssignment, onAssignRestaurantToUser, onRemoveRestaurantAssignment, onBack }: Props) {
  const [view, setView] = useState<ViewMode>('map')
  const [mainTab, setMainTab] = useState<'카드' | '비공식' | '식당'>('카드')
  const isMapView = mainTab === '카드' && view === 'map'
  const [query, setQuery] = useState('')
  const [unassignedOnly, setUnassignedOnly] = useState(false)
  const [legacyTypeFilter, setLegacyTypeFilter] = useState<BuildingTypeFilter>('전체')
  const activeTeam = teams.find((t) => t.id === activeTeamId) ?? null
  const scopeEnabled = teamServiceEnabled()
  const buildingTypeFilter: BuildingTypeFilter = useMemo(() => {
    if (!teamServiceEnabled()) return legacyTypeFilter
    return teams.find((t) => t.id === activeTeamId)?.cardScope ?? '전체'
  }, [teams, activeTeamId, legacyTypeFilter])
  const changeScope = (scope: BuildingTypeFilter) => {
    if (!canEdit || !activeTeam) return false
    const valid = new Set(scopeServiceBuildings(buildings, activeTeam.cardIds, scope).map((b) => b.cardId))
    const retained = activeTeam.cardIds.filter((id) => valid.has(id))
    const removed = activeTeam.cardIds.length - retained.length
    if (removed && !window.confirm(msg('해당 세대가 없는 카드 {n}개를 배정에서 제외할까요?', { n: removed }))) return false
    dispatch({ type: 'SET_CARD_SCOPE', teamId: activeTeam.id, scope, cardIds: retained })
    return true
  }
  const eligibleCards = useMemo(() => {
    if (!scopeEnabled || buildingTypeFilter === '전체') return cards
    const ids = new Set(scopeServiceBuildings(buildings, cards.map((c) => c.id), buildingTypeFilter).map((b) => b.cardId))
    return cards.filter((c) => ids.has(c.id))
  }, [scopeEnabled, buildingTypeFilter, buildings, cards])
    const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
  const [openCompletedGroups, setOpenCompletedGroups] = useState<Set<string>>(new Set())
  const [expandedSubGroups, setExpandedSubGroups] = useState<Set<string>>(new Set())

  // 구(區) 목록 — 담당 카드가 여러 구에 걸치면 지도가 너무 줌아웃됨 → 한 구만 보기
  const regions = useMemo(() => {
    const present = new Set(cards.map((c) => c.region))
    // 설정에 정해둔 지역 순서를 그대로 쓴다 (처인구 → 기흥구 → 수지구 → …).
    // 예전엔 카드 개수 순으로 늘어놔서 사람마다·날마다 자리가 바뀌었다.
    const ordered = getRegionNames().filter((r) => present.has(r))
    const rest = Array.from(present).filter((r) => !ordered.includes(r)).sort((a, b) => a.localeCompare(b, 'ko'))
    return [...ordered, ...rest]
  }, [cards])
  // 기본은 전체. 구를 누르면 **더해지고**, 다시 누르면 빠진다.
  // (예전엔 하나만 골라져서 처인구를 보다 기흥구를 누르면 처인구가 사라졌다)
  const [selectedRegions, setSelectedRegions] = useState<Set<string>>(() => new Set())
  const toggleRegion = (r: string) =>
    setSelectedRegions((prev) => {
      const next = new Set(prev)
      if (next.has(r)) next.delete(r)
      else next.add(r)
      return next
    })
  const regionCards = useMemo(
    () => (selectedRegions.size === 0 ? eligibleCards : eligibleCards.filter((c) => selectedRegions.has(c.region))),
    [eligibleCards, selectedRegions],
  )

  // cardId → 이 카드를 맡은 팀들 (한 카드를 여러 팀이 함께 맡을 수 있음)
  const cardTeams = useMemo(() => {
    const m = new Map<number, DraftTeam[]>()
    teams.forEach((t) => t.cardIds.forEach((id) => m.set(id, [...(m.get(id) ?? []), t])))
    return m
  }, [teams])

  // 지도 색칠용: cardId → 팀 색(hex)
  const cardColorMap = useMemo(() => {
    const m = new Map<number, string>()
    teams.forEach((t) => t.cardIds.forEach((id) => m.set(id, teamHex(t.color))))
    return m
  }, [teams])

  // 선택된 구의 담당 카드만 지도에 (경계선 있는 것) — 한 구로 좁혀 줌 적정화
  const myCardIds = useMemo(() => new Set(scopeEnabled && buildingTypeFilter !== '전체'
    ? scopeServiceBuildings(buildings, regionCards.map((c) => c.id), buildingTypeFilter).map((b) => b.cardId)
    : regionCards.map((c) => c.id)), [regionCards, buildings, buildingTypeFilter, scopeEnabled])
  const myBoundaries = useMemo(
    () => cardBoundaries.filter((b) => myCardIds.has(b.cardId)),
    [cardBoundaries, myCardIds],
  )

  // 지도용 buildings — 선택 구 + 타입 필터 + 완료 제외 (건물 포인트 표시용)
  const mapBuildings = useMemo(() => {
    return buildings.filter((b) => {
      if (!myCardIds.has(b.cardId)) return false
      if (!buildingHasUsage(b, buildingTypeFilter)) return false
      if (getBuildingStatus(scopeBuildingToUsage(b, buildingTypeFilter)) === '방문완료') return false
      return true
    }).map((b) => scopeBuildingToUsage(b, buildingTypeFilter))
  }, [buildings, myCardIds, buildingTypeFilter])

  // 카드별 주택/상가 세대 수
  const unitStats = useMemo(() => {
    const m = new Map<number, { house: number; shop: number }>()
    buildings.forEach((b) => {
      const prev = m.get(b.cardId) ?? { house: 0, shop: 0 }
      prev.house += unitsForUsage(b, '주택').length
      prev.shop += unitsForUsage(b, '상가').length
      m.set(b.cardId, prev)
    })
    return m
  }, [buildings])

  // 카드별 최근 봉사(방문) 날짜 — visit_histories 최신 visited_at
  const cardLastVisit = useMemo(() => {
    const unitCard = new Map<number, number>()  // unitId → cardId
    for (const b of buildings) for (const u of b.units ?? []) unitCard.set(u.id, b.cardId)
    const m = new Map<number, string>()  // cardId → 최신 visited_at
    for (const h of visitHistories) {
      const cardId = unitCard.get(h.unitId)
      if (cardId == null) continue
      const prev = m.get(cardId)
      if (!prev || (h.visitedAt ?? '') > prev) m.set(cardId, h.visitedAt)
    }
    return m
  }, [buildings, visitHistories])
  // "M/D" (없으면 —)
  const lastVisitLabel = (cardId: number) => {
    const v = cardLastVisit.get(cardId)
    if (!v) return '—'
    const mm = v.match(/^(\d{4})-(\d{2})-(\d{2})/)
    return mm ? `${Number(mm[2])}/${Number(mm[3])}` : v
  }


  // 구별 카드 수 (필터 pill 카운트)
  const regionCount = useMemo(() => {
    const m = new Map<string, number>()
    eligibleCards.forEach((c) => m.set(c.region, (m.get(c.region) ?? 0) + 1))
    return m
  }, [eligibleCards])

  // cardId → 짧은 카드명 (지역/구 접두 제거: "처인구 고림동 1" → "고림동 1")
  const shortName = (id: number) => {
    const c = cards.find((x) => x.id === id)
    if (!c) return `카드 ${id}`
    return stripRegionPrefix(c.name)
  }
  const teamAreaNames = (t: DraftTeam) =>
    t.cardIds.length ? t.cardIds.map(shortName).slice(0, 3).join(', ') + (t.cardIds.length > 3 ? msg(' 외 {n}', { n: t.cardIds.length - 3 }) : '') : null

  // 동(area)별 그룹 — 선택된 구 기준
  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = regionCards.filter((c) => {
      if (q && !c.name.toLowerCase().includes(q)) return false
      if (unassignedOnly && cardTeams.has(c.id)) return false
      if (buildingTypeFilter !== '전체') {
        const stats = unitStats.get(c.id) ?? { house: 0, shop: 0 }
        if (buildingTypeFilter === '주택' && stats.house === 0) return false
        if (buildingTypeFilter === '상가' && stats.shop === 0) return false
      }
      return true
    })
    const groups = new Map<string, TerritoryCard[]>()
    filtered.forEach((c) => {
      const key = `${c.region} · ${c.area}`
      const arr = groups.get(key) ?? []
      arr.push(c)
      groups.set(key, arr)
    })
    const result = Array.from(groups.entries()).sort((a, b) => a[0].localeCompare(b[0], 'ko'))
    return result.map(([groupName, groupCards]) => [groupName, sortTerritoryCardsByOperationalPriority(groupCards)] as [string, TerritoryCard[]])
  }, [regionCards, query, unassignedOnly, cardTeams, buildingTypeFilter, unitStats])

  const toggleGroup = (groupName: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(groupName)) next.delete(groupName)
      else next.add(groupName)
      return next
    })
  }

  const toggleCompletedGroup = (groupName: string) => {
    setOpenCompletedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(groupName)) next.delete(groupName)
      else next.add(groupName)
      return next
    })
  }

  // 이 일정에 비공식 자료/식당이 누구에게 배정됐는지 + 배정 id (해제용)
  // assetId/buildingId → [{ user, assignmentId }]
  const informalAssigns = useMemo(() => {
    const m = new Map<number, Array<{ user: string; assignmentId: number }>>()
    eventInformalAssignments.filter((a) => a.eventId === eventId).forEach((a) => {
      m.set(a.assetId, [...(m.get(a.assetId) ?? []), { user: a.userName, assignmentId: a.id }])
    })
    return m
  }, [eventInformalAssignments, eventId])
  // 식당은 세대 단위 — key = `${buildingId}:${unitId ?? 0}` (unitId 0 = 건물단위 레거시)
  const restaurantAssigns = useMemo(() => {
    const m = new Map<string, Array<{ user: string; assignmentId: number }>>()
    eventRestaurantAssignments.filter((a) => a.eventId === eventId).forEach((a) => {
      const k = `${a.buildingId}:${a.unitId ?? 0}`
      m.set(k, [...(m.get(k) ?? []), { user: a.userName, assignmentId: a.id }])
    })
    return m
  }, [eventRestaurantAssignments, eventId])

  // 비공식 토글: 활성팀에 이미 배정돼 있으면 해제, 아니면 전원 배정
  const toggleInformal = async (assetId: number, label: string) => {
    if (!activeTeam || activeTeam.members.length === 0) {
      showToast(msg('멤버가 있는 팀을 먼저 선택하세요'), 'error')
      return
    }
    if (scopeEnabled) {
      dispatch({ type: 'TOGGLE_TEAM_INFORMAL', teamId: activeTeam.id, assetId })
      return
    }
    const members = activeTeam.members
    const toRemove = (informalAssigns.get(assetId) ?? []).filter((a) => members.includes(a.user))
    if (toRemove.length > 0) {
      for (const a of toRemove) await onRemoveInformalAssignment?.(a.assignmentId)
      showToast(msg('"{label}" → {name} 배정 해제', { label: label, name: activeTeam.name }))
      return
    }
    let ok = 0
    for (const member of members) {
      if (await onAssignInformalToUser?.({ eventId, userName: member, assetId, assignedBy: currentVisitor })) ok += 1
    }
    if (ok > 0) showToast(msg('"{label}" → {name}({v1}) 배정', { label: label, name: activeTeam.name, v1: members.join('·') }))
  }

  // 식당 토글 (세대 단위)
  const toggleRestaurant = async (buildingId: number, unitId: number | null, label: string) => {
    if (!activeTeam || activeTeam.members.length === 0) {
      showToast(msg('멤버가 있는 팀을 먼저 선택하세요'), 'error')
      return
    }
    const members = activeTeam.members
    const toRemove = (restaurantAssigns.get(`${buildingId}:${unitId ?? 0}`) ?? []).filter((a) => members.includes(a.user))
    if (toRemove.length > 0) {
      for (const a of toRemove) await onRemoveRestaurantAssignment?.(a.assignmentId)
      showToast(msg('"{label}" → {name} 배정 해제', { label: label, name: activeTeam.name }))
      return
    }
    let ok = 0
    for (const member of members) {
      if (await onAssignRestaurantToUser?.({ eventId, userName: member, buildingId, unitId, assignedBy: currentVisitor })) ok += 1
    }
    if (ok > 0) showToast(msg('"{label}" → {name}({v1}) 배정', { label: label, name: activeTeam.name, v1: members.join('·') }))
  }

  // 공용 항목 타입 (비공식·식당). 식당은 unitId, 비공식은 imageUrl 세팅.
  type SubItem = { key: string; id: number; unitId: number | null; name: string; address: string; imageUrl?: string; kind?: InformalAsset['kind']; assignedTo: string[]; isActive: boolean }

  // 비공식 — 그룹(미분류 + 그룹)별 묶음. 구역 비공식 화면과 동일한 구성.
  const informalGroupSections = useMemo(() => {
    const memberSet = new Set(teams.find((t) => t.id === activeTeamId)?.members ?? [])
    const visible = assignableInformalAssets(informalAssets, query)
    const byGroup = new Map<number | 'null', SubItem[]>()
    visible.forEach((a) => {
      const assigns = informalAssigns.get(a.id) ?? []
      const assignedTeams = teams.filter((t) => t.informalAssetIds?.includes(a.id))
      const assignedTo = scopeEnabled ? assignedTeams.map((t) => t.name) : assigns.map((x) => x.user)
      if (unassignedOnly && assignedTo.length > 0) return
      const item: SubItem = { key: `inf-asset-${a.id}`, id: a.id, unitId: null, name: a.name, address: '', imageUrl: a.imageUrl, kind: a.kind, assignedTo, isActive: scopeEnabled ? assignedTeams.some((t) => t.id === activeTeamId) : assigns.some((x) => memberSet.has(x.user)) }
      const key = a.groupId ?? 'null'
      byGroup.set(key, [...(byGroup.get(key) ?? []), item])
    })
    const sections: Array<{ key: string; title: string; items: SubItem[] }> = []
    if (byGroup.has('null')) sections.push({ key: 'inf-null', title: msg('미분류'), items: byGroup.get('null')! })
    informalGroups.forEach((g) => {
      if (byGroup.has(g.id)) sections.push({ key: `inf-${g.id}`, title: g.name, items: byGroup.get(g.id)! })
    })
    return sections
  }, [informalAssets, informalGroups, query, informalAssigns, unassignedOnly, teams, activeTeamId, scopeEnabled])

  // 식당 — 구(區)별 + 세대 단위. 구역 식당 화면처럼 중국인 세대별 행.
  const cardRegionById = useMemo(() => {
    const m = new Map<number, string>()
    const source = allCards.length ? allCards : cards
    source.forEach((c) => m.set(c.id, c.region))
    return m
  }, [allCards, cards])
  const restaurantRegionSections = useMemo(() => {
    const memberSet = new Set(teams.find((t) => t.id === activeTeamId)?.members ?? [])
    const q = query.trim().toLowerCase()
    const byRegion = new Map<string, SubItem[]>()
    buildings.forEach((b) => {
      // 유형(상가) 조건은 걸지 않는다 — 잘못 등록돼도 조용히 사라지지 않게
      if (!b.isRestaurant && getRestaurantUnits(b).length === 0) return
      const region = cardRegionById.get(b.cardId) || '기타'
      // 식당 판정은 utils/restaurants 한 곳에서만 (화면마다 다르면 어긋난다)
      const restaurantUnits = getRestaurantUnits(b)
      // 세대가 없으면 건물명 1행 (unitId null = 건물단위 옛 데이터)
      const rows: Array<{ unitId: number | null; name: string; excluded: boolean }> = restaurantUnits.length === 0
        ? [{ unitId: null, name: b.name || b.address, excluded: false }]
        : restaurantUnits.map((u) => ({ unitId: u.id, name: u.number || b.name || b.address, excluded: u.status === '대상외' }))
      rows.forEach((row) => {
        if (q && !row.name.toLowerCase().includes(q) && !(b.address ?? '').toLowerCase().includes(q)) return
        const assigns = restaurantAssigns.get(`${b.id}:${row.unitId ?? 0}`) ?? []
        if (unassignedOnly && assigns.length > 0) return
        const item: SubItem = { key: `rest-${b.id}-${row.unitId ?? 0}`, id: b.id, unitId: row.unitId, name: row.excluded ? `${row.name} (대상외)` : row.name, address: b.address, assignedTo: assigns.map((x) => x.user), isActive: assigns.some((x) => memberSet.has(x.user)) }
        byRegion.set(region, [...(byRegion.get(region) ?? []), item])
      })
    })
    return Array.from(byRegion.entries())
      .sort(([a], [b]) => a.localeCompare(b, 'ko'))
      .map(([region, items]) => ({ key: `rest-${region}`, title: region, items }))
  }, [buildings, query, restaurantAssigns, unassignedOnly, cardRegionById, teams, activeTeamId])

  const subSections = mainTab === '비공식' ? informalGroupSections : restaurantRegionSections
  const subTotal = subSections.reduce((n, s) => n + s.items.length, 0)
  const toggleSubGroup = (key: string) => {
    setExpandedSubGroups((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const toggleCard = (cardId: number) => {
    if (!canEdit || !activeTeam) return
    // 활성팀 기준 토글. 다른 팀이 이미 맡고 있어도 뺏지 않고 함께 배정한다
    // (큰 구역은 여러 팀이 나눠 도는 경우가 있음)
    if (activeTeam.cardIds.includes(cardId)) {
      dispatch({ type: 'UNASSIGN_CARD', teamId: activeTeam.id, cardId })
    } else {
      dispatch({ type: 'ASSIGN_CARD', teamId: activeTeam.id, cardId })
    }
  }

  return (
    <div className={`asg-zone${isMapView ? ' is-map-view' : ''}`}>
      {/* sticky 헤더 */}
      <div className="asg-zone-sticky">
        <header className="asg-editor-head" style={{ position: 'relative', borderBottom: 'none' }}>
          <div className="asg-editor-head-left">
            <button className="asg-editor-back" onClick={onBack} type="button" aria-label={msg('뒤로')}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
            <div className="asg-editor-titles">
              <strong>{msg('구역 배분')}</strong>
              <span title={activeTeam ? activeTeam.members.join(' · ') : ''}>
                {activeTeam ? `${activeTeam.name} · ${activeTeam.members.join(' · ')}` : ''}
              </span>
            </div>
          </div>
        </header>
        {/* 배분할 팀 — 가로 스크롤, 받은 구역명 표시 */}
        <div className="asg-teambar">
          {teams.map((team) => {
            const isActive = team.id === activeTeamId
            const areas = teamAreaNames(team)
            return (
              <button
                key={team.id}
                type="button"
                aria-pressed={isActive}
                className={`asg-teambar-card${isActive ? ' is-active' : ''}`}
                style={{ borderColor: isActive ? teamHex(team.color) : undefined }}
                onClick={() => dispatch({ type: 'SET_ACTIVE_TEAM', teamId: team.id })}
              >
                <span className="asg-teambar-name">
                  <span className="asg-team-dot" style={{ background: teamHex(team.color) }} />
                  {team.name}
                  <span className="asg-teambar-cnt">{team.members.length}</span>
                </span>
                <span className="asg-teambar-zones" title={areas ?? undefined} style={areas ? undefined : { color: 'var(--warn, #b8862a)' }}>
                  {scopeEnabled && (team.cardIds.length > 0 || team.informalAssetIds?.length)
                    ? [team.cardIds.length > 0 ? `${msg(team.cardScope ?? '전체')} · ${msg('카드 {n}개', { n: team.cardIds.length })}` : '',
                      team.informalAssetIds?.length ? `${msg('비공식')} ${team.informalAssetIds.length}` : ''].filter(Boolean).join(' · ')
                    : areas ?? msg('구역 미배정')}
                </span>
              </button>
            )
          })}
        </div>
        {/* 뷰 토글 */}
        <div className="asg-zone-controls">
          <div className={`asg-zone-navigation${scopeEnabled ? ' is-unified' : ''}`}>
            {scopeEnabled && <div className="asg-zone-scope-tabs" role="group" aria-label={msg('봉사 형태')}>
              {(['전체', '주택', '상가'] as const).map((scope) => (
                <button key={scope} type="button" aria-pressed={mainTab === '카드' && buildingTypeFilter === scope}
                  disabled={!activeTeam || (!canEdit && buildingTypeFilter !== scope)}
                  onClick={() => {
                    if (buildingTypeFilter === scope || changeScope(scope)) setMainTab('카드')
                  }}>{msg(scope)}</button>
              ))}
            </div>}
            <div className={`asg-zone-view-slot${mainTab !== '카드' ? ' is-empty' : ''}`}>
            {mainTab === '카드' && <div className="asg-zone-toggle" style={{ padding: 0, margin: 0, flexShrink: 0 }}>
              <button className={view === 'list' ? 'is-on' : ''} onClick={() => setView('list')} type="button" aria-label={msg('목록')} title={msg('목록')} aria-pressed={view === 'list'}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
              </button>
              <button className={view === 'map' ? 'is-on' : ''} onClick={() => setView('map')} type="button" aria-label={msg('지도')} title={msg('지도')} aria-pressed={view === 'map'}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/></svg>
              </button>
            </div>}
            </div>
            
            {/* 배분 대상 탭 */}
            <div className="asg-zone-kind-tabs">
              {(scopeEnabled ? ['비공식', '식당'] as const : ['카드', '비공식', '식당'] as const).map((tb) => {
                const on = mainTab === tb
                return (
                  <button key={tb} type="button" aria-pressed={on} onClick={() => setMainTab(tb)}>{msg(tb)}</button>
                )
              })}
            </div>
          </div>
        </div>
      </div>

      {/* 본문 */}
      {isMapView ? (
        <div className="asg-zone-map">
          {/* 구 + 주택/상가 + 완료 필터 (sticky 헤더 바로 아래) */}
          {/* 오버레이 필터: 구 선택 (좌측 상단) */}
          {regions.length > 1 && (
            <div className="asg-map-overlay-regions">
              <button type="button"
                className={`asg-filter-pill${selectedRegions.size === 0 ? ' is-on' : ''}`}
                onClick={() => setSelectedRegions(new Set())}
              >{t(currentLang(), 'map.filterAll')} <span className="asg-filter-cnt">{eligibleCards.length}</span></button>
              {regions.map((r) => (
                <button key={r} type="button"
                  className={`asg-filter-pill${selectedRegions.has(r) ? ' is-on' : ''}`}
                  onClick={() => toggleRegion(r)}
                >{r} <span className="asg-filter-cnt">{regionCount.get(r) ?? 0}</span></button>
              ))}
            </div>
          )}

          <MapCanvas
            buildings={mapBuildings}
            cardBoundaries={myBoundaries}
            cards={regionCards}
            selectedBuildingId={0}
            selectedCardId="전체"
            highlightedCardIds={myCardIds}
            cardColorMap={cardColorMap}
            isMobile
            onSelectBuilding={() => undefined}
            onSelectCardBoundary={(cardId) => {
              if (!canEdit || !activeTeam) return
              if (activeTeam.cardIds.includes(cardId)) dispatch({ type: 'UNASSIGN_CARD', teamId: activeTeam.id, cardId })
              else dispatch({ type: 'ASSIGN_CARD', teamId: activeTeam.id, cardId })
            }}
          />
          <div className="asg-zone-map-hint">
            <div className="asg-zone-map-hint-row">
              <span className="asg-zone-map-hint-swatch" style={{ background: activeTeam ? `${teamHex(activeTeam.color)}22` : 'transparent', borderColor: activeTeam ? teamHex(activeTeam.color) : 'var(--line)' }} />
              <span>{msg('폴리곤을 탭하면')}<b>{activeTeam?.name ?? msg('팀 선택')}</b>{msg('색으로 칠해집니다.')}</span>
            </div>
            <div className="asg-zone-map-hint-meta">
              담당 카드 {regionCards.length} · 경계선 {myBoundaries.length}
              {activeTeam ? ` · ${activeTeam.name} 배분 ${activeTeam.cardIds.length}` : ''}
            </div>
          </div>
        </div>
      ) : (
        <div className="asg-zone-list">
          {mainTab === '카드' && regions.length > 1 && (
            <div className="asg-list-regions">
              <button type="button" className={`asg-filter-pill${selectedRegions.size === 0 ? ' is-on' : ''}`}
                aria-pressed={selectedRegions.size === 0} onClick={() => setSelectedRegions(new Set())}
              >{t(currentLang(), 'map.filterAll')} <span className="asg-filter-cnt">{eligibleCards.length}</span></button>
              {regions.map((region) => (
                <button key={region} type="button" className={`asg-filter-pill${selectedRegions.has(region) ? ' is-on' : ''}`}
                  aria-pressed={selectedRegions.has(region)} onClick={() => toggleRegion(region)}
                >{region} <span className="asg-filter-cnt">{regionCount.get(region) ?? 0}</span></button>
              ))}
            </div>
          )}
          <div className="asg-zone-filter" style={{ gap: 6, alignItems: 'center' }}>
            <input
              className="asg-zone-search"
              style={{ flex: 1, minWidth: 0 }}
              placeholder={mainTab === '식당' ? msg('식당 검색') : mainTab === '비공식' ? msg('비공식 검색') : msg('카드 검색')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <label className="asg-zone-unassigned-toggle" style={{ flexShrink: 0 }}>
              <input type="checkbox" checked={unassignedOnly} onChange={(e) => setUnassignedOnly(e.target.checked)} />
              {msg('미배정만')}
            </label>
            {mainTab === '카드' && !scopeEnabled && <select className="asg-card-composition" aria-label={msg('카드 구성')}
              value={buildingTypeFilter} onChange={(e) => setLegacyTypeFilter(e.target.value as BuildingTypeFilter)}>
              {(['전체', '주택', '상가'] as BuildingTypeFilter[]).map((type) => (
                <option key={type} value={type}>{msg('카드 구성')}: {msg(type)}</option>
              ))}
            </select>}
          </div>

          {/* 비공식 / 식당 — 구역 화면과 동일한 그룹 구성. 탭=토글(배정↔해제) */}
          {mainTab !== '카드' && (
            <>
              {!activeTeam && <div className="asg-empty">{msg('먼저 위에서 팀을 선택하세요.')}</div>}
              {activeTeam && (
                <div style={{ padding: '0 2px 8px', fontSize: 12, color: 'var(--muted)' }}>
                  {msg('탭하면 {name}({members}) 배정 ↔ 다시 탭하면 해제', { name: activeTeam.name, members: activeTeam.members.join('·') || msg('멤버 없음') })}
                </div>
              )}
              {subTotal === 0 ? (
                <div className="asg-empty" style={{ color: 'var(--muted)' }}>
                  {unassignedOnly
                    ? (mainTab === '비공식' ? '미배정 비공식 자료가 없어요.' : '미배정 식당이 없어요.')
                    : (mainTab === '비공식' ? '비공식 자료가 없어요.' : '식당이 없어요.')}
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  {subSections.map((section) => {
                    const open = expandedSubGroups.has(section.key)
                    return (
                      <section key={section.key}>
                        <div onClick={() => toggleSubGroup(section.key)}
                          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 4px', marginBottom: 6, cursor: 'pointer', userSelect: 'none' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ display: 'flex', transform: open ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 0.2s' }}>
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
                            </span>
                            <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>{section.title}</span>
                            <span style={{ fontSize: 12, color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' }}>{section.items.length}</span>
                          </div>
                          <span style={{ fontSize: 12, color: 'var(--muted)' }}>{open ? msg('접기') : msg('열기')}</span>
                        </div>
                        {open && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            {section.items.map((item) => (
                              <div
                                key={item.key}
                                role="button"
                                tabIndex={activeTeam ? 0 : -1}
                                onClick={() => {
                                  if (!activeTeam) return
                                  if (mainTab === '비공식') void toggleInformal(item.id, item.name)
                                  else void toggleRestaurant(item.id, item.unitId, item.name)
                                }}
                                style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', minHeight: 0, padding: '10px 14px', borderRadius: 12,
                                  border: item.isActive ? '1.5px solid var(--ink)' : '1px solid var(--line)',
                                  background: item.isActive ? 'var(--bg-subtle, #f4f4f2)' : 'var(--surface)',
                                  cursor: activeTeam ? 'pointer' : 'default', opacity: activeTeam ? 1 : 0.5 }}
                              >
                                {mainTab === '비공식' && (
                                  item.imageUrl ? (
                                    <a href={item.imageUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} style={{ flexShrink: 0, lineHeight: 0 }}>
                                      <img src={item.imageUrl} alt={item.name} loading="lazy"
                                        style={{ width: 44, height: 44, borderRadius: 8, objectFit: 'cover', border: '1px solid var(--line)', display: 'block' }} />
                                    </a>
                                  ) : (
                                    <span className="asg-informal-icon"><InformalKindIcon kind={item.kind ?? '비공식구역'} size={22} /></span>
                                  )
                                )}
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <span style={{ fontSize: 14.5, fontWeight: 600, color: 'var(--ink)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</span>
                                    {item.isActive && <span style={{ flexShrink: 0, fontSize: 11.5, fontWeight: 700, color: 'var(--ink)' }}>{msg('✓ 배정됨')}</span>}
                                  </div>
                                  {mainTab === '식당' && item.address && (
                                    <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.address}</div>
                                  )}
                                  {item.assignedTo.length > 0 && (
                                    <div style={{ fontSize: 11.5, color: 'var(--primary-600, #2563eb)', marginTop: 4, fontWeight: 600 }}>
                                      {msg('{v1} 배정됨', { v1: item.assignedTo.join('·') })}
                                    </div>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </section>
                    )
                  })}
                </div>
              )}
            </>
          )}

          {mainTab === '카드' && !activeTeam && <div className="asg-empty">{msg('먼저 위에서 팀을 선택하세요.')}</div>}

          {mainTab === '카드' && grouped.map(([groupName, groupCards]) => {
            const isCollapsed = collapsedGroups.has(groupName)
            const activeCards = groupCards.filter(c => (c.progress ?? 0) < 100 && c.status !== '완료')
            const completedCards = groupCards.filter(c => (c.progress ?? 0) >= 100 || c.status === '완료')
            const isCompletedOpen = openCompletedGroups.has(groupName)

            return (
            <div className="asg-zone-group" key={groupName}>
              <button type="button" className="asg-zone-group-head is-btn" onClick={() => toggleGroup(groupName)}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: isCollapsed ? 'rotate(-90deg)' : 'none', transition: 'transform 0.2s' }}><polyline points="6 9 12 15 18 9"/></svg>
                  {groupName}
                </span>
                <span style={{ fontSize: 13, color: 'var(--muted)', fontWeight: 400 }}>{activeCards.length}개</span>
              </button>
              {!isCollapsed && activeCards.length > 0 && (
                <div className="asg-zone-card-list">
                  {activeCards.map((card) => {
                const owners = cardTeams.get(card.id) ?? []
                const isActiveTeamCard = owners.some((t) => t.id === activeTeamId)
                const otherOwners = owners.filter((t) => t.id !== activeTeamId)
                const stats = unitStats.get(card.id) ?? { house: 0, shop: 0 }
                return (
                  <button
                    key={card.id}
                    type="button"
                    className={`asg-zone-card${isActiveTeamCard ? ' is-mine' : ''}`}
                    onClick={() => toggleCard(card.id)}
                    disabled={!canEdit || !activeTeam}
                  >
                    <span className={`asg-zone-check${isActiveTeamCard ? ' is-on' : ''}`}>
                      {isActiveTeamCard && (
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                      )}
                    </span>
                    <span className="asg-zone-card-main">
                      <strong>{card.name}</strong>
                      <small>
                        {(buildingTypeFilter === '전체' || buildingTypeFilter === '주택') && stats.house > 0 && `주택 ${stats.house}`}
                        {buildingTypeFilter === '전체' && stats.house > 0 && stats.shop > 0 && ' · '}
                        {(buildingTypeFilter === '전체' || buildingTypeFilter === '상가') && stats.shop > 0 && `상가 ${stats.shop}`}
                        {` · ${card.progress}%`}
                      </small>
                    </span>
                    {otherOwners.length > 0 ? (
                      <span style={{ display: 'inline-flex', gap: 4, flexShrink: 0 }}>
                        {otherOwners.map((t) => (
                          <span key={t.id} className="asg-zone-owner-pill" style={{ background: `${teamHex(t.color)}22`, color: teamHex(t.color) }}>
                            {t.name}
                          </span>
                        ))}
                      </span>
                    ) : (
                      <span style={{ fontSize: 11.5, color: 'var(--muted)', flexShrink: 0, whiteSpace: 'nowrap' }}>
                        최근 봉사 {lastVisitLabel(card.id)}
                      </span>
                    )}
                  </button>
                )
              })}
                </div>
              )}

              {!isCollapsed && completedCards.length > 0 && (
                <>
                  <button type="button" className="asg-zone-completed-head is-btn" onClick={() => toggleCompletedGroup(groupName)} style={{ marginTop: 4, padding: '8px 4px', width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', border: 'none', background: 'transparent', cursor: 'pointer' }}>
                    <span style={{ fontSize: 13, color: 'var(--muted)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ display: 'inline-block', width: 14, height: 1, background: 'var(--line)' }} />
                      {msg('완료됨')}
                      <span style={{ display: 'inline-block', width: 14, height: 1, background: 'var(--line)' }} />
                    </span>
                    <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 400, display: 'flex', alignItems: 'center', gap: 4 }}>
                      {completedCards.length}개
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: isCompletedOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}><polyline points="6 9 12 15 18 9"/></svg>
                    </span>
                  </button>
                  {isCompletedOpen && (
                    <div className="asg-zone-card-list">
                      {completedCards.map((card) => {
                const owners = cardTeams.get(card.id) ?? []
                const isActiveTeamCard = owners.some((t) => t.id === activeTeamId)
                const otherOwners = owners.filter((t) => t.id !== activeTeamId)
                const stats = unitStats.get(card.id) ?? { house: 0, shop: 0 }
                return (
                  <button
                    key={card.id}
                    type="button"
                    className={`asg-zone-card${isActiveTeamCard ? ' is-mine' : ''}`}
                    onClick={() => toggleCard(card.id)}
                    disabled={!canEdit || !activeTeam}
                  >
                    <span className={`asg-zone-check${isActiveTeamCard ? ' is-on' : ''}`}>
                      {isActiveTeamCard && (
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                      )}
                    </span>
                    <span className="asg-zone-card-main">
                      <strong>{card.name}</strong>
                      <small>
                        {(buildingTypeFilter === '전체' || buildingTypeFilter === '주택') && stats.house > 0 && `주택 ${stats.house}`}
                        {buildingTypeFilter === '전체' && stats.house > 0 && stats.shop > 0 && ' · '}
                        {(buildingTypeFilter === '전체' || buildingTypeFilter === '상가') && stats.shop > 0 && `상가 ${stats.shop}`}
                        {` · ${card.progress}%`}
                      </small>
                    </span>
                    {otherOwners.length > 0 ? (
                      <span style={{ display: 'inline-flex', gap: 4, flexShrink: 0 }}>
                        {otherOwners.map((t) => (
                          <span key={t.id} className="asg-zone-owner-pill" style={{ background: `${teamHex(t.color)}22`, color: teamHex(t.color) }}>
                            {t.name}
                          </span>
                        ))}
                      </span>
                    ) : (
                      <span style={{ fontSize: 11.5, color: 'var(--muted)', flexShrink: 0, whiteSpace: 'nowrap' }}>
                        최근 봉사 {lastVisitLabel(card.id)}
                      </span>
                    )}
                  </button>
                )
                  })}
                    </div>
                  )}
                </>
              )}
            </div>
          )})}

          {grouped.length === 0 && <div className="asg-empty">{msg('조건에 맞는 카드가 없습니다.')}</div>}
        </div>
      )}
    </div>
  )
}
