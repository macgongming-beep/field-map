import { t, translateKoreanAddress } from '../../i18n'
import { getRegionNames } from '../../lib/regions'
import type { AppLanguage } from '../../i18n'
// 관리자 모바일 구역 — design_handoff 04 화면 (구역 시·구 단위)
// + 20 / 21 / 22 drill-down 일부
//
// 구조:
//   - InlineTabs: 구역 카드 / 비공식 / 식당 (under-line active)
//   - 담당/전체 segmented + 목록/지도 toggle
//   - Stats inline: 전체 N · 배정 M · 미배정 K(danger)
//   - 검색 input
//   - 카드 리스트 (시·구 단위, drill-down 시 동/카드 단위)
//
// 비공식 / 식당 탭은 기존 InformalCardsTab / RestaurantsTab 재사용.

import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { Building, CardBoundary, InformalAsset, InformalGroup, InformalKind, Role, TerritoryCard, VisitHistory } from '../../types'
import { compareTerritoryCardsByOperationalPriority, getTerritoryCardOperationalState } from '../../utils/cardSearch'
import { getBuildingStatus } from '../../utils/mapUtils'
import { InformalCardsTab } from '../InformalCardsTab'
import { RestaurantsTab } from '../RestaurantsTab'
import { Card } from '../ui'
import { msg } from '../../lib/msg'
import { getRestaurantUnits } from '../../utils/restaurants'
import { countInformalCards } from '../../utils/informalAssets'
import { buildingHasUsage, scopeBuildingToUsage } from '../../utils/unitUsage'

type ZoneKind = 'territory' | 'informal' | 'restaurant'
type Scope = 'mine' | 'all'
type ViewMode = 'list' | 'map'
type Level = 'regions' | 'dongs' | 'cards'

function extractDong(name: string, region: string): string {
  // "처인구 김량장동 001" → "김량장동"
  const withoutRegion = name.replace(region, '').trim()
  const m = withoutRegion.match(/^(\S+동|\S+읍|\S+면|\S+리)/)
  return m ? m[1] : '기타'
}

type Props = {
  language: AppLanguage
  translatePlaceNames?: boolean
  cards: TerritoryCard[]
  buildings: Building[]
  cardBoundaries?: CardBoundary[]
  visitHistories?: VisitHistory[]
  /** 식당 탭: 세대 해제 / 대상외 해제 (PC 와 같은 기능) */
  onRemoveRestaurantUnit?: (unitId: number | null, buildingId: number, mode?: 'list' | 'place', deleteEmptyBuilding?: boolean) => Promise<void>
  onUpdateUnitFlags?: (unitId: number, flags: Partial<import('../../types').Unit>) => void
  currentVisitor: string
  visitorNames?: string[]
  role: Role
  informalAssets?: InformalAsset[]
  informalGroups?: InformalGroup[]
  onOpenMap: (cardId: number) => void
  onOpenAssignedMap: (cardIds: number[], context?: { region?: string; dong?: string; scope?: Scope }) => void
  onShowMapView: () => void
  onUploadInformalAsset?: (input: { file: File; name: string; uploadedBy: string; groupId?: number | null }) => Promise<{ ok: boolean; assetId?: number; error?: string }>
  onDeleteInformalAsset?: (assetId: number) => Promise<boolean>
  onDeleteInformalAssets?: (assetIds: number[]) => Promise<{ failed: number[] }>
  onCreateInformalGroup?: (input: { name: string; createdBy: string }) => Promise<number | null>
  onRenameInformalGroup?: (groupId: number, name: string) => Promise<boolean>
  onDeleteInformalGroup?: (groupId: number) => Promise<boolean>
  onMoveAssetToGroup?: (assetId: number, groupId: number | null) => Promise<boolean>
  onMoveAssetsToGroup?: (assetIds: number[], groupId: number | null) => Promise<{ failed: number[] }>
  /** 핀이 찍힌 장소를 지도에서 보여 준다 */
  onOpenInformalOnMap?: (assetId: number) => void
  /** 사진 없이 지도 핀으로 장소 만들기 (docs/비공식-봉사-재설계.md) */
  onCreateInformalPlace?: (input: { name: string; createdBy: string; groupId?: number | null; lat: number; lng: number; memo?: string; zoom?: number | null }) => Promise<boolean>
  /** 만든 뒤에 종류·이름을 고친다 */
  onUpdateInformalPlace?: (
    assetId: number,
    input: { name?: string; memo?: string; lat?: number; lng?: number; zoom?: number | null; kind?: InformalKind },
  ) => Promise<boolean>
  onToggleBuildingRestaurant?: (buildingId: number, isRestaurant: boolean) => Promise<void>
  restaurantRequests?: import('../../types').RestaurantRequest[]
  onRegisterRestaurant?: import('../../types/restaurantRegistration').RegisterRestaurant
  onApproveRestaurantRequest?: (id: number, opts: { name: string; address: string; reviewer: string; existingBuildingId?: number | null; lat?: number; lng?: number }) => Promise<void>
  onRejectRestaurantRequest?: (id: number, reviewer: string) => Promise<void>
}

// ── 아이콘 ─────────────────────────────
function ChevR({ size = 14, color = 'var(--muted-2)' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="9 6 15 12 9 18" />
    </svg>
  )
}
function ChevL({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 6 9 12 15 18" />
    </svg>
  )
}
function MapIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <polygon points="3 6 9 3 15 6 21 3 21 21 15 18 9 21 3 18 3 6" />
      <line x1="9" y1="3" x2="9" y2="21" />
      <line x1="15" y1="6" x2="15" y2="18" />
    </svg>
  )
}
function ListIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <line x1="8" y1="6" x2="21" y2="6" />
      <line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3" y1="6" x2="3.01" y2="6" />
      <line x1="3" y1="12" x2="3.01" y2="12" />
      <line x1="3" y1="18" x2="3.01" y2="18" />
    </svg>
  )
}
function SearchIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  )
}

export function AdminMobileZone({
  language,
  translatePlaceNames = false,
  cards,
  buildings,
  cardBoundaries = [],
  visitHistories = [],
  onRemoveRestaurantUnit,
  onUpdateUnitFlags,
  currentVisitor,
  visitorNames = [],
  role,
  informalAssets = [],
  informalGroups = [],
  restaurantRequests = [],
  onOpenMap,
  onOpenAssignedMap,
  onShowMapView,
  onUploadInformalAsset,
  onDeleteInformalAsset,
  onDeleteInformalAssets,
  onCreateInformalGroup,
  onRenameInformalGroup,
  onDeleteInformalGroup,
  onMoveAssetToGroup,
  onMoveAssetsToGroup,
  onCreateInformalPlace,
  onUpdateInformalPlace,
  onOpenInformalOnMap,
  onToggleBuildingRestaurant,
  onRegisterRestaurant,
  onApproveRestaurantRequest,
  onRejectRestaurantRequest,
}: Props) {
  // 지역 목록·순서는 DB 에서 온다. 모듈 상수로 두면 불러오기 전 기본값이 굳어 버린다
  const REGION_ORDER = getRegionNames()
  // URL 쿼리로 드릴 상태 보존 — 지도 진입 후 뒤로 오면 같은 위치로 복귀
  const [searchParams, setSearchParams] = useSearchParams()
  const urlLevel = (searchParams.get('level') as Level | null) ?? 'regions'
  const urlRegion = searchParams.get('region') ?? ''
  const urlDong = searchParams.get('dong') ?? ''
  const defaultScope: Scope = role === 'admin' ? 'all' : 'mine'
  const urlScope: Scope = (searchParams.get('scope') === 'all' || searchParams.get('scope') === 'mine')
    ? (searchParams.get('scope') as Scope)
    : defaultScope
  const urlZoneKind: ZoneKind = searchParams.get('tab') === 'informal'
    ? 'informal'
    : searchParams.get('tab') === 'restaurant'
      ? 'restaurant'
      : 'territory'

  const [scope, setScope] = useState<Scope>(urlScope)
  const [view, setView] = useState<ViewMode>('list')
  const [level, setLevel] = useState<Level>(urlLevel)
  const [selectedRegion, setSelectedRegion] = useState(urlRegion)
  const [selectedDong, setSelectedDong] = useState(urlDong)
  const [query, setQuery] = useState('')
  const [showDoneExcludedCards, setShowDoneExcludedCards] = useState(false)
  // 동/카드 목록 타입 필터 (지도뷰처럼 전체/주택/상가) — 0개면 목록에서 숨김
  const [typeFilter, setTypeFilter] = useState<'전체' | '주택' | '상가'>('전체')
  // 방문필요만 보기 — 켜면 방문필요 건물만 카운트/표시, 방문필요 없는 동·카드는 숨김
  const [onlyNeedsVisit, setOnlyNeedsVisit] = useState(false)
  const placeLabel = (value: string) => translateKoreanAddress(value, language, translatePlaceNames)

  const setZoneKind = (kind: ZoneKind) => {
    const next = new URLSearchParams(searchParams)
    if (kind === 'territory') next.delete('tab'); else next.set('tab', kind)
    setSearchParams(next, { replace: true })
  }

  // 드릴 상태 + scope URL 동기화 (replace — 히스토리 오염 방지)
  useEffect(() => {
    const next = new URLSearchParams(searchParams)
    if (level === 'regions') next.delete('level'); else next.set('level', level)
    if (selectedRegion) next.set('region', selectedRegion); else next.delete('region')
    if (selectedDong) next.set('dong', selectedDong); else next.delete('dong')
    // scope 는 default 와 같으면 키 제거
    if (scope === defaultScope) next.delete('scope'); else next.set('scope', scope)
    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [level, selectedRegion, selectedDong, scope])

  // 외부에서 URL 이 바뀐 경우 (브라우저 뒤로가기 등) 상태도 따라감
  useEffect(() => {
    if (urlLevel !== level) setLevel(urlLevel)
    if (urlRegion !== selectedRegion) setSelectedRegion(urlRegion)
    if (urlDong !== selectedDong) setSelectedDong(urlDong)
    if (urlScope !== scope) setScope(urlScope)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlLevel, urlRegion, urlDong, urlScope])

  const informalCount = countInformalCards(informalAssets)
  const restaurantCount = buildings.reduce((acc, b) => {
    const units = getRestaurantUnits(b).length
    if (units === 0) return acc + (b.isRestaurant ? 1 : 0)
    return acc + units
  }, 0)

  // ── 카드 필터: 담당/전체 ─────────────────────
  const baseCards = useMemo(() => {
    if (scope === 'all') return cards
    return cards.filter((c) => {
      const leaders = c.assignedLeaders?.length ? c.assignedLeaders : c.assignedLeader ? [c.assignedLeader] : []
      return leaders.includes(currentVisitor) || c.assignedUsers.includes(currentVisitor)
    })
  }, [cards, scope, currentVisitor])

  // ── 건물 카운트 매핑 (전체 + 방문필요만) ─────────────────────────
  const cardBuildingCounts = useMemo(() => {
    const map = new Map<number, { house: number; shop: number; houseNeed: number; shopNeed: number }>()
    for (const b of buildings) {
      const prev = map.get(b.cardId) ?? { house: 0, shop: 0, houseNeed: 0, shopNeed: 0 }
      if (buildingHasUsage(b, '주택')) {
        prev.house += 1
        if (getBuildingStatus(scopeBuildingToUsage(b, '주택')) === '방문필요') prev.houseNeed += 1
      }
      if (buildingHasUsage(b, '상가')) {
        prev.shop += 1
        if (getBuildingStatus(scopeBuildingToUsage(b, '상가')) === '방문필요') prev.shopNeed += 1
      }
      map.set(b.cardId, prev)
    }
    return map
  }, [buildings])

  // 카드별 최근 봉사(방문) 날짜 — visit_histories 최신 visited_at
  const cardLastVisit = useMemo(() => {
    const unitCard = new Map<number, number>()  // unitId → cardId
    for (const b of buildings) for (const u of b.units ?? []) unitCard.set(u.id, b.cardId)
    const map = new Map<number, string>()  // cardId → 최신 visited_at
    for (const h of visitHistories) {
      const cardId = unitCard.get(h.unitId)
      if (cardId == null) continue
      const prev = map.get(cardId)
      if (!prev || (h.visitedAt ?? '') > prev) map.set(cardId, h.visitedAt)
    }
    return map
  }, [buildings, visitHistories])

  // onlyNeedsVisit 여부에 따라 카드의 주택/상가 카운트를 골라준다
  const pickCounts = (cardId: number): { house: number; shop: number } => {
    const bc = cardBuildingCounts.get(cardId) ?? { house: 0, shop: 0, houseNeed: 0, shopNeed: 0 }
    return onlyNeedsVisit ? { house: bc.houseNeed, shop: bc.shopNeed } : { house: bc.house, shop: bc.shop }
  }

  // ── 상위 stats (전체/배정/미배정) ─────────────
  const topStats = useMemo(() => {
    const total = baseCards.length
    const assigned = baseCards.filter((c) => c.status !== '미배정').length
    const unassigned = baseCards.filter((c) => c.status === '미배정').length
    return { total, assigned, unassigned }
  }, [baseCards])

  // ── drill-down stats (현재 level 기준: 전체 카드 · 주택 · 상가) ───
  const drillStats = useMemo(() => {
    const cardsInScope = baseCards.filter((c) => {
      const region = REGION_ORDER.includes(c.region as string) ? (c.region as string) : '기타'
      if (level === 'regions') return true
      if (level === 'dongs') return region === selectedRegion
      // cards
      return region === selectedRegion && extractDong(c.name, selectedRegion) === selectedDong
    })
    let house = 0
    let shop = 0
    for (const c of cardsInScope) {
      const bc = pickCounts(c.id)
      house += bc.house
      shop += bc.shop
    }
    // 방문필요 모드에선 전체 칩 = 방문필요 건물 합, 평소엔 카드 수
    return { total: onlyNeedsVisit ? house + shop : cardsInScope.length, house, shop }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseCards, cardBuildingCounts, level, selectedRegion, selectedDong, onlyNeedsVisit])

  // ── 담당 view 의 state totals (미사용 / 사용중 / 완료·제외) ─────
  // 본인 담당 카드를 status 별 집계 — 어휘 매핑:
  //   미배정/진행 X → 미사용 (danger)
  //   진행중       → 사용중 (info)
  //   완료/대상없음 → 완료·제외 (ok)
  const mineStateTotals = useMemo(() => {
    let unused = 0
    let inUse = 0
    let done = 0
    for (const c of baseCards) {
      const operationalState = getTerritoryCardOperationalState(c)
      if (operationalState === '완료' || operationalState === '대상없음') done += 1
      else if (operationalState === '진행중') inUse += 1
      else unused += 1
    }
    return { unused, inUse, done }
  }, [baseCards])

  // ── 시·구 list ────────────────────────────────
  const regionList = useMemo(() => {
    const map = new Map<string, TerritoryCard[]>()
    for (const card of baseCards) {
      const key = REGION_ORDER.includes(card.region as string) ? (card.region as string) : '기타'
      const list = map.get(key) ?? []
      list.push(card)
      map.set(key, list)
    }
    const out: Array<{ name: string; cards: TerritoryCard[]; house: number; shop: number; total: number; done: number }> = []
    const buildEntry = (name: string, cs: TerritoryCard[]) => {
      let house = 0, shop = 0, done = 0
      for (const c of cs) {
        const bc = pickCounts(c.id)
        house += bc.house
        shop += bc.shop
        const operationalState = getTerritoryCardOperationalState(c)
        if (operationalState === '완료' || operationalState === '대상없음') done += 1
      }
      return { name, cards: cs, house, shop, total: cs.length, done }
    }
    for (const r of REGION_ORDER) {
      if (map.has(r)) out.push(buildEntry(r, map.get(r)!))
    }
    if (map.has('기타')) out.push(buildEntry('기타', map.get('기타')!))
    return out
      .filter((e) => !query || e.name.includes(query))
      .filter((e) => !onlyNeedsVisit || e.house + e.shop > 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseCards, cardBuildingCounts, query, onlyNeedsVisit])

  // ── 동 list ─────────────────────────────────
  const dongList = useMemo(() => {
    const regionCards = baseCards.filter((c) => {
      const key = REGION_ORDER.includes(c.region as string) ? (c.region as string) : '기타'
      return key === selectedRegion
    })
    const map = new Map<string, TerritoryCard[]>()
    for (const card of regionCards) {
      const dong = extractDong(card.name, selectedRegion)
      const list = map.get(dong) ?? []
      list.push(card)
      map.set(dong, list)
    }
    const out: Array<{ name: string; cards: TerritoryCard[]; house: number; shop: number; total: number; done: number }> = []
    for (const [dong, cs] of map.entries()) {
      let house = 0, shop = 0, done = 0
      for (const c of cs) {
        const bc = pickCounts(c.id)
        house += bc.house
        shop += bc.shop
        const operationalState = getTerritoryCardOperationalState(c)
        if (operationalState === '완료' || operationalState === '대상없음') done += 1
      }
      out.push({ name: dong, cards: cs, house, shop, total: cs.length, done })
    }
    return out
      .filter((e) => !query || e.name.includes(query))
      .filter((e) => !onlyNeedsVisit || e.house + e.shop > 0)
      .sort((a, b) => {
        if (a.name === '기타') return 1
        if (b.name === '기타') return -1
        return a.name.localeCompare(b.name, 'ko')
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseCards, cardBuildingCounts, selectedRegion, query, onlyNeedsVisit])

  // ── 카드 list ───────────────────────────────
  const cardList = useMemo(() => {
    return baseCards
      .filter((c) => {
        const key = REGION_ORDER.includes(c.region as string) ? (c.region as string) : '기타'
        return key === selectedRegion && extractDong(c.name, selectedRegion) === selectedDong
      })
      .filter((c) => !query || c.name.includes(query))
      .sort(compareTerritoryCardsByOperationalPriority)
  }, [baseCards, selectedRegion, selectedDong, query, REGION_ORDER])

  const isDoneExcludedCard = (card: TerritoryCard) => {
    const state = getTerritoryCardOperationalState(card)
    return state === '완료' || state === '대상없음'
  }
  const doneExcludedCards = cardList.filter(isDoneExcludedCard)
  const renderedCardList = showDoneExcludedCards
    ? cardList
    : cardList.filter((card) => !isDoneExcludedCard(card))

  // ── 네비게이션 ────────────────────────────
  const goToRegion = (region: string) => {
    setSelectedRegion(region)
    setSelectedDong('')
    setLevel('dongs')
    setQuery('')
  }
  const goToDong = (dong: string) => {
    setSelectedDong(dong)
    setLevel('cards')
    setQuery('')
  }
  const goBack = () => {
    if (level === 'cards') {
      setLevel('dongs')
      setSelectedDong('')  // 동 선택 해제해야 breadcrumb + 지도 범위가 처인구로 복귀
      setQuery('')
    } else if (level === 'dongs') {
      setLevel('regions')
      setSelectedRegion('')
      setSelectedDong('')
      setQuery('')
    }
  }

  // ── 비공식/식당 탭이면 위임 ─────────────────
  if (urlZoneKind === 'informal') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '16px 16px 24px' }}>
        <TerritoryInlineTabs language={language} active="informal" onChange={setZoneKind} cardCount={cards.length} informalCount={informalCount} restaurantCount={restaurantCount} />
        <InformalCardsTab
          role={role}
          onCreatePlace={onCreateInformalPlace}
          onUpdatePlace={onUpdateInformalPlace}
          onOpenOnMap={onOpenInformalOnMap}
          currentVisitor={currentVisitor}
          informalAssets={informalAssets}
          informalGroups={informalGroups}
          onUpload={onUploadInformalAsset || (() => Promise.resolve({ ok: false }))}
          onDelete={onDeleteInformalAsset || (() => Promise.resolve(false))}
          onDeleteMany={onDeleteInformalAssets}
          onCreateGroup={onCreateInformalGroup || (() => Promise.resolve(null))}
          onRenameGroup={onRenameInformalGroup || (() => Promise.resolve(false))}
          onDeleteGroup={onDeleteInformalGroup || (() => Promise.resolve(false))}
          onMoveAsset={onMoveAssetToGroup || (() => Promise.resolve(false))}
          onMoveMany={onMoveAssetsToGroup}
          language={language}
          expandedStateKey="mobile.informalExpandedGroups"
        />
      </div>
    )
  }

  if (urlZoneKind === 'restaurant') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '16px 16px 24px' }}>
        <TerritoryInlineTabs language={language} active="restaurant" onChange={setZoneKind} cardCount={cards.length} informalCount={informalCount} restaurantCount={restaurantCount} />
        <RestaurantsTab
          role={role}
          buildings={buildings}
          cardBoundaries={cardBoundaries}
          cards={cards}
          currentVisitor={currentVisitor}
          visitorNames={visitorNames}
          restaurantRequests={restaurantRequests}
          onToggleRestaurantFlag={onToggleBuildingRestaurant}
          onRemoveRestaurantUnit={onRemoveRestaurantUnit}
          onRegisterRestaurant={onRegisterRestaurant}
          onApproveRestaurantRequest={onApproveRestaurantRequest}
          onRejectRestaurantRequest={onRejectRestaurantRequest}
          onOpenMap={(cardId) => onOpenMap(cardId)}
          visitHistories={visitHistories}
          onUpdateUnitFlags={onUpdateUnitFlags}
          language={language}
          translatePlaceNames={translatePlaceNames}
        />
      </div>
    )
  }

  // ── 구역 카드 탭 (메인) ────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '16px 16px 24px' }}>
      <TerritoryInlineTabs language={language} active="territory" onChange={setZoneKind} cardCount={cards.length} informalCount={informalCount} restaurantCount={restaurantCount} />

      {/* Top toolbar — level 에 따라 다른 구성 (디자인 04 vs 20/21)
          - regions: [담당/전체 segmented] [ViewToggle]
          - dongs/cards: [← back] [전체 구역 › 처인구 (› 고림동)] [spacer] [ViewToggle] */}
      {level === 'regions' ? (
        <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
          {/* user 는 본인 담당만 고정 — segmented 숨김 */}
          {role !== 'user' && <SegmentedScope language={language} value={scope} onChange={setScope} />}
          <ViewToggle language={language} value={view} onChange={(next) => {
            setView(next)
            if (next === 'map') {
              if (scope === 'mine') {
                onOpenAssignedMap(baseCards.map((c) => c.id), { scope })
              } else {
                onShowMapView()
              }
            }
          }} />
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 4px' }}>
          <button
            type="button"
            onClick={goBack}
            style={{
              width: 30, height: 30, minHeight: 30,
              display: 'grid', placeItems: 'center',
              background: 'transparent', border: 'none', color: 'var(--text)',
              cursor: 'pointer', borderRadius: 8, marginLeft: -8,
              flexShrink: 0,
            }}
            aria-label={msg('뒤로')}
          >
            <ChevL size={16} />
          </button>
          <nav style={{
            display: 'flex', alignItems: 'center', gap: 4,
            fontSize: 12.5, color: 'var(--muted)',
            flexWrap: 'wrap', lineHeight: 1.4, flex: 1, minWidth: 0,
          }}>
            <span style={{ color: level === 'dongs' && !selectedDong ? 'var(--muted)' : 'var(--muted)' }}>{t(language, 'territory.allZone')}</span>
            {selectedRegion && (
              <>
                <span style={{ color: 'var(--muted-3)' }}>›</span>
                <span style={{ color: level === 'dongs' ? 'var(--ink)' : 'var(--muted)', fontWeight: level === 'dongs' ? 600 : 500 }}>
                  {placeLabel(selectedRegion)}
                </span>
              </>
            )}
            {selectedDong && (
              <>
                <span style={{ color: 'var(--muted-3)' }}>›</span>
                <span style={{ color: 'var(--ink)', fontWeight: 600 }}>{placeLabel(selectedDong)}</span>
              </>
            )}
          </nav>
          <ViewToggle language={language} value={view} onChange={(next) => {
            setView(next)
            if (next === 'map') {
              // 현재 드릴 컨텍스트의 카드만 지도에 노출
              // - region 만 선택: 그 구 전체 카드
              // - region + dong 선택: 그 동의 카드
              const ctxCardIds = baseCards
                .filter((c) => !selectedRegion || c.region === selectedRegion)
                .filter((c) => !selectedDong || c.area === selectedDong)
                .map((c) => c.id)
              onOpenAssignedMap(ctxCardIds, { region: selectedRegion || undefined, dong: selectedDong || undefined, scope })
            }
          }} />
        </div>
      )}

      {/* Stats inline
          - 전체 view: 전체 / 배정 / 미배정 (디자인 04 의 기본 카운터)
          - 담당 view + drill-down: 디자인 20/21 의 압축 stats (전체 · 주택 · 상가)
            대신 디자인 22 의 미사용/사용중/완료·제외 totals 행은 별도 카드로 아래 */}
      {scope === 'all' && level === 'regions' ? (
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0 4px', fontSize: 13, color: 'var(--muted)' }}>
          <span><span style={{ color: 'var(--muted)' }}>{t(language, 'map.filterAll')}</span> <b style={{ color: 'var(--ink)', fontWeight: 600, marginLeft: 4, fontVariantNumeric: 'tabular-nums' }}>{topStats.total}</b></span>
          <span><span style={{ color: 'var(--muted)' }}>{t(language, 'territory.assignedShort')}</span> <b style={{ color: 'var(--ink)', fontWeight: 600, marginLeft: 4, fontVariantNumeric: 'tabular-nums' }}>{topStats.assigned}</b></span>
          <span><span style={{ color: 'var(--muted)' }}>{t(language, 'zone.unassigned')}</span> <b style={{ color: 'var(--status-danger)', fontWeight: 600, marginLeft: 4, fontVariantNumeric: 'tabular-nums' }}>{topStats.unassigned}</b></span>
        </div>
      ) : level !== 'regions' ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', padding: '0 2px', gap: 6 }}>
          {([
            { key: '전체' as const, label: t(language, 'map.filterAll'), count: drillStats.total },
            { key: '주택' as const, label: t(language, 'map.house'), count: drillStats.house },
            { key: '상가' as const, label: t(language, 'map.shop'), count: drillStats.shop },
          ]).map((f) => {
            const active = typeFilter === f.key
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => setTypeFilter(f.key)}
                style={{
                  display: 'inline-flex', alignItems: 'baseline', gap: 3,
                  minHeight: 0, padding: '4px 10px', borderRadius: 7, cursor: 'pointer',
                  fontSize: 12, fontWeight: active ? 700 : 500, lineHeight: 1.3,
                  border: active ? '1px solid var(--ink)' : '1px solid var(--line)',
                  background: active ? 'var(--ink)' : 'var(--surface)',
                  color: active ? '#fff' : 'var(--muted)',
                }}
              >
                {f.label}
                <b style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: active ? '#fff' : 'var(--ink)' }}>{f.count}</b>
              </button>
            )
          })}
          {/* 방문필요만 보기 토글 — 오른쪽 끝 */}
          <button
            type="button"
            onClick={() => setOnlyNeedsVisit((v) => !v)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              minHeight: 0, padding: '4px 10px', borderRadius: 7, cursor: 'pointer', marginLeft: 'auto',
              fontSize: 12, fontWeight: onlyNeedsVisit ? 700 : 500, lineHeight: 1.3,
              border: onlyNeedsVisit ? '1px solid var(--status-danger)' : '1px solid var(--line)',
              background: onlyNeedsVisit ? 'rgba(220,38,38,0.08)' : 'var(--surface)',
              color: onlyNeedsVisit ? 'var(--status-danger)' : 'var(--muted)',
            }}
          >
            <span style={{ width: 13, height: 13, borderRadius: 3, flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: `1.5px solid ${onlyNeedsVisit ? 'var(--status-danger)' : 'var(--line-2,#ccc)'}`, background: onlyNeedsVisit ? 'var(--status-danger)' : 'transparent', color: '#fff', fontSize: 10 }}>{onlyNeedsVisit ? '✓' : ''}</span>
            {t(language, 'zone.summaryNeed')}
          </button>
        </div>
      ) : (
        /* scope === 'mine' && level === 'regions' → 담당 state totals 행 (디자인 22) */
        <div style={{
          display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 14,
          padding: '8px 12px',
          background: 'var(--surface)', border: '1px solid var(--line)',
          borderRadius: 8,
        }}>
          {[
            { label: t(language, 'territory.statusUnused'), count: mineStateTotals.unused, color: 'var(--status-danger)' },
            { label: t(language, 'territory.statusInUse'), count: mineStateTotals.inUse, color: 'var(--status-info)' },
            { label: t(language, 'territory.statusDone'), count: mineStateTotals.done, color: 'var(--status-ok)' },
          ].map((s) => (
            <span key={s.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
              <span style={{ width: 7, height: 7, borderRadius: 99, background: s.color, flexShrink: 0 }} />
              <b style={{ color: 'var(--ink)', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{s.count}</b>
              <span style={{ color: 'var(--muted)', fontSize: 12 }}>{s.label}</span>
            </span>
          ))}
        </div>
      )}

      {/* 검색 — 카드 레벨은 디자인 21 에서 검색 안 보임 */}
      {level !== 'cards' && (
        <label style={{
          background: 'var(--surface)',
          border: '1px solid var(--line)',
          borderRadius: 10,
          padding: '11px 14px',
          fontSize: 14,
          color: 'var(--text)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          cursor: 'text',
        }}>
          <SearchIcon />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={level === 'regions' ? t(language, 'territory.searchCity') : t(language, 'territory.searchDong')}
            style={{
              flex: 1, minWidth: 0, border: 'none', outline: 'none',
              background: 'transparent', font: 'inherit', color: 'inherit', padding: 0,
            }}
          />
        </label>
      )}

      {/* 리스트 (level 별) */}
      {level === 'regions' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {regionList.length === 0 ? (
            <Card padding={18} style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
              {scope === 'mine' ? t(language, 'territory.noMyZone') : t(language, 'territory.noCards')}
            </Card>
          ) : (
            regionList.map((r) => (
              <GroupRow language={language} translatePlaceNames={translatePlaceNames} key={r.name} name={r.name} house={r.house} shop={r.shop} done={r.done} total={r.total} onClick={() => goToRegion(r.name)} />
            ))
          )}
        </div>
      )}

      {level === 'dongs' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {dongList.length === 0 ? (
            <Card padding={18} style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
              {t(language, 'territory.noDongs')}
            </Card>
          ) : (
            dongList
              .filter((d) => typeFilter === '전체' || (typeFilter === '주택' ? d.house > 0 : d.shop > 0))
              .map((d) => (
                <GroupRow language={language} translatePlaceNames={translatePlaceNames} key={d.name} name={d.name} house={d.house} shop={d.shop} done={d.done} total={d.total} typeFilter={typeFilter} onClick={() => goToDong(d.name)} />
              ))
          )}
        </div>
      )}

      {level === 'cards' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {cardList.length === 0 ? (
            <Card padding={18} style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
              {t(language, 'territory.noCards')}
            </Card>
          ) : (
            <>
              {renderedCardList
                .filter((c) => {
                  const bc = pickCounts(c.id)
                  if (onlyNeedsVisit && bc.house + bc.shop === 0) return false
                  if (typeFilter === '전체') return true
                  return typeFilter === '주택' ? bc.house > 0 : bc.shop > 0
                })
                .map((c) => (
                  <CardRow language={language} translatePlaceNames={translatePlaceNames} key={c.id} card={c} buildingCount={pickCounts(c.id)} lastVisit={cardLastVisit.get(c.id)} typeFilter={typeFilter} onClick={() => onOpenMap(c.id)} />
                ))}
              {doneExcludedCards.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowDoneExcludedCards((open) => !open)}
                  style={{
                    width: '100%',
                    minHeight: 42,
                    border: '1px dashed var(--line-2)',
                    borderRadius: 14,
                    background: 'var(--surface)',
                    color: 'var(--muted)',
                    fontSize: 13,
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  {t(language, 'territory.statusDone')} {doneExcludedCards.length} {showDoneExcludedCards ? t(language, 'app.collapse') : t(language, 'app.expand')}
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ── 인라인 탭 (구역 카드 / 비공식 / 식당) ─────────
function TerritoryInlineTabs({
  language,
  active,
  onChange,
  cardCount,
  informalCount,
  restaurantCount,
}: {
  language: AppLanguage
  active: ZoneKind
  onChange: (kind: ZoneKind) => void
  cardCount: number
  informalCount: number
  restaurantCount: number
}) {
  const tabs: { id: ZoneKind; label: string; count: number }[] = [
    { id: 'territory', label: t(language, 'territory.zoneCard'), count: cardCount },
    { id: 'informal', label: t(language, 'territory.informalTab'), count: informalCount },
    { id: 'restaurant', label: t(language, 'territory.restaurantTab'), count: restaurantCount },
  ]
  return (
    <div
      role="tablist"
      style={{
        display: 'flex',
        gap: 4,
        borderBottom: '1px solid var(--line)',
        padding: '0 4px',
        margin: '0 -16px',
        paddingLeft: 20,
        paddingRight: 20,
      }}
    >
      {tabs.map((t) => {
        const isActive = active === t.id
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(t.id)}
            style={{
              padding: '10px 4px 12px',
              marginRight: 18,
              border: 'none',
              background: 'transparent',
              font: 'inherit',
              fontSize: 14,
              fontWeight: isActive ? 600 : 500,
              color: isActive ? 'var(--ink)' : 'var(--muted)',
              position: 'relative',
              display: 'inline-flex',
              alignItems: 'baseline',
              gap: 5,
              cursor: 'pointer',
              minHeight: 0,
            }}
          >
            {t.label}
            <span style={{
              fontSize: 12,
              color: isActive ? 'var(--ink)' : 'var(--muted-2)',
              fontWeight: 500,
              fontVariantNumeric: 'tabular-nums',
            }}>
              {t.count}
            </span>
            {isActive && (
              <span
                aria-hidden
                style={{
                  position: 'absolute',
                  left: 0,
                  right: 18,
                  bottom: -1,
                  height: 2,
                  background: 'var(--ink)',
                  borderRadius: 2,
                }}
              />
            )}
          </button>
        )
      })}
    </div>
  )
}

// ── 담당/전체 segmented ────────────────────────
function SegmentedScope({ language, value, onChange }: { language: AppLanguage; value: Scope; onChange: (v: Scope) => void }) {
  const options: { value: Scope; label: string }[] = [
    { value: 'mine', label: t(language, 'territory.myZone') },
    { value: 'all', label: t(language, 'territory.allZone') },
  ]
  return (
    <div style={{
      background: 'var(--tint)',
      borderRadius: 10,
      padding: 3,
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: 0,
      flex: 1,
    }}>
      {options.map((opt) => {
        const active = opt.value === value
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            style={{
              border: 'none',
              font: 'inherit',
              fontSize: 13,
              fontWeight: active ? 600 : 500,
              color: active ? 'var(--ink)' : 'var(--muted)',
              padding: '9px 8px',
              borderRadius: 7,
              textAlign: 'center',
              background: active ? 'var(--surface)' : 'transparent',
              boxShadow: active ? '0 1px 2px rgba(0,0,0,0.04)' : 'none',
              cursor: 'pointer',
              minHeight: 0,
            }}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

// ── 목록/지도 toggle ────────────────────────────
function ViewToggle({ language, value, onChange }: { language: AppLanguage; value: ViewMode; onChange: (v: ViewMode) => void }) {
  return (
    <div style={{
      background: 'var(--tint)',
      borderRadius: 10,
      padding: 3,
      display: 'flex',
      gap: 0,
    }}>
      <button
        type="button"
        onClick={() => onChange('list')}
        title={t(language, 'common.list')}
        aria-label={t(language, 'common.list')}
        style={{
          width: 36, height: 30, minHeight: 30,
          display: 'grid', placeItems: 'center',
          border: 'none', borderRadius: 7,
          background: value === 'list' ? 'var(--surface)' : 'transparent',
          color: value === 'list' ? 'var(--ink)' : 'var(--muted)',
          boxShadow: value === 'list' ? '0 1px 2px rgba(0,0,0,0.04)' : 'none',
          cursor: 'pointer',
        }}
      >
        <ListIcon />
      </button>
      <button
        type="button"
        onClick={() => onChange('map')}
        title={t(language, 'map.mapLabel')}
        aria-label={t(language, 'map.mapLabel')}
        style={{
          width: 36, height: 30, minHeight: 30,
          display: 'grid', placeItems: 'center',
          border: 'none', borderRadius: 7,
          background: value === 'map' ? 'var(--surface)' : 'transparent',
          color: value === 'map' ? 'var(--ink)' : 'var(--muted)',
          boxShadow: value === 'map' ? '0 1px 2px rgba(0,0,0,0.04)' : 'none',
          cursor: 'pointer',
        }}
      >
        <MapIcon />
      </button>
    </div>
  )
}

// ── 그룹 (시/구 OR 동) 행 ──────────────────────
function GroupRow({
  language,
  translatePlaceNames = false,
  name, house, shop, done, total, onClick, typeFilter = '전체',
}: {
  language: AppLanguage
  translatePlaceNames?: boolean
  name: string
  house: number
  shop: number
  done: number
  total: number
  onClick: () => void
  typeFilter?: '전체' | '주택' | '상가'
}) {
  const displayName = translateKoreanAddress(name, language, translatePlaceNames)
  const countText = typeFilter === '주택' ? `${t(language, 'map.house')} ${house}`
    : typeFilter === '상가' ? `${t(language, 'map.shop')} ${shop}`
    : `${t(language, 'map.house')} ${house} · ${t(language, 'map.shop')} ${shop}`
  const pct = total > 0 ? Math.round((done / total) * 100) : 0
  const isUnassigned = total === 0
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'block', width: '100%', padding: 0,
        border: 'none', background: 'transparent',
        cursor: 'pointer', textAlign: 'left', minHeight: 0,
      }}
    >
      <Card padding="14px 16px">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{
              fontSize: 15, fontWeight: 600,
              color: isUnassigned ? 'var(--muted)' : 'var(--ink)',
            }}>
              {displayName}
            </span>
            <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>
              {countText}
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3 }}>
            <span style={{ fontSize: 13, color: 'var(--ink)', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
              {pct}%
            </span>
            <span style={{ fontSize: 12, color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' }}>
              {done} / {total}
            </span>
          </div>
          <ChevR size={16} />
        </div>
      </Card>
    </button>
  )
}

// ── 카드 행 (drill-down 마지막 레벨) ────────────
function CardRow({
  language,
  translatePlaceNames = false,
  card, buildingCount, lastVisit, onClick, typeFilter = '전체',
}: {
  language: AppLanguage
  translatePlaceNames?: boolean
  card: TerritoryCard
  buildingCount: { house: number; shop: number }
  lastVisit?: string
  onClick: () => void
  typeFilter?: '전체' | '주택' | '상가'
}) {
  // "최근 봉사 M/D" (없으면 —)
  const lastVisitText = (() => {
    if (!lastVisit) return '—'
    const m = lastVisit.match(/^(\d{4})-(\d{2})-(\d{2})/)
    return m ? `${Number(m[2])}/${Number(m[3])}` : lastVisit
  })()
  const operationalState = getTerritoryCardOperationalState(card)
  const isEmptyTarget = operationalState === '대상없음'
  const displayName = translateKoreanAddress(card.name, language, translatePlaceNames)
  const countText = typeFilter === '주택' ? `${t(language, 'map.house')} ${buildingCount.house}`
    : typeFilter === '상가' ? `${t(language, 'map.shop')} ${buildingCount.shop}`
    : `${t(language, 'map.house')} ${buildingCount.house} · ${t(language, 'map.shop')} ${buildingCount.shop}`
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'block', width: '100%', padding: 0,
        border: 'none', background: 'transparent',
        cursor: 'pointer', textAlign: 'left', minHeight: 0,
      }}
    >
      <Card padding="12px 14px">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {/* 첫 줄: 이름 + StatePill + 지도 ghost (디자인 21) */}
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>{displayName}</span>
              </div>
              <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>
                {(() => {
                  const leaderCount = card.assignedLeaders?.length ?? (card.assignedLeader ? 1 : 0)
                  return leaderCount > 0
                    ? `${t(language, 'territory.assignedPrefix')} ${t(language, 'common.nPeople', { n: leaderCount })} · `
                    : ''
                })()}
                {isEmptyTarget ? t(language, 'territory.statusDone') : countText}
              </span>
            </div>
            <span
              aria-hidden
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                height: 30, padding: '0 12px',
                border: '1px solid var(--line-2)', borderRadius: 8,
                background: 'var(--surface)', color: 'var(--text)',
                fontSize: 12, fontWeight: 600, flexShrink: 0,
              }}
            >
              <MapIcon size={13} /> {t(language, 'map.mapLabel')}
            </span>
          </div>

          {/* 진행률 바 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ flex: 1, height: 4, background: 'var(--tint)', borderRadius: 99, overflow: 'hidden' }}>
              <div style={{ width: `${card.progress}%`, height: '100%', background: 'var(--ink)', borderRadius: 99 }} />
            </div>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)', minWidth: 32, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
              {card.progress}%
            </span>
            <span style={{ fontSize: 11.5, color: 'var(--muted)', flexShrink: 0, whiteSpace: 'nowrap' }}>
              {t(language, 'zone.recentService')} {lastVisitText}
            </span>
          </div>
        </div>
      </Card>
    </button>
  )
}
