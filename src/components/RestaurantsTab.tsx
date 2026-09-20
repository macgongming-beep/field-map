// 식당 탭 — design_handoff 06 화면
// 식당 표시된 상가 목록 (지역별 그룹) + 추가 모달 + 식당봉사 신청 승인
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Building, CardBoundary, Unit, RestaurantRequest, Role, TerritoryCard, VisitHistory } from '../types'
import { RestaurantRegistrationModal } from './RestaurantRegistrationModal'
import type { RegisterRestaurant } from '../types/restaurantRegistration'
import { msg } from '../lib/msg'
import { normalizeCardSearch } from '../utils/cardSearch'
import { translateKoreanAddress, type AppLanguage } from '../i18n'
import {
  SAMPLE_CSV_CONTENT,
  matchRestaurantsToBuildings,
  parseCsvRestaurants,
} from '../utils/csvRestaurantImport'
import type { MatchResult } from '../utils/csvRestaurantImport'
import { getRestaurantUnits } from '../utils/restaurants'

function isLeaderOrAdmin(role: Role): boolean {
  return role === 'leader' || role === 'admin' || role === 'developer'
}

const restaurantCopy = {
  ko: {
    excluded: '대상외',
    lastVisit: '최근',
    hideExcluded: (n: number) => `대상외 ${n}곳 숨기기`,
    releaseExcluded: '대상외 해제',
    releaseTitle: '대상외 해제',
    releaseHint: '해제 사유를 적어 두면 다음에 방문하는 사람이 이유를 알 수 있어요. (선택)',
    releaseReasonPlaceholder: '예: 중국인 직원 새로 들어옴',
    release: '해제',
    other: '기타',
    pendingTitle: '식당봉사 추가 신청',
    total: (count: number) => `전체 ${count}개`,
    csvBulk: 'CSV 일괄등록',
    addRestaurant: '식당 추가',
    searchPlaceholder: '식당 이름 또는 주소 검색',
    emptyAdmin: '아직 등록된 식당이 없습니다.',
    emptyAdminHelp: '위 + 식당 추가로 시작하세요.',
    emptyUser: '아직 등록된 식당이 없습니다.',
    noSearch: '검색 결과가 없습니다.',
    open: '열기',
    close: '접기',
    map: '지도',
    more: '더보기',
    removeFromList: '식당 목록 제거',
    removeTitle: '식당 정리',
    removeHint: '식당 목록에서만 뺄지, 장소 자료까지 삭제할지 선택하세요.',
    removeListHelp: '건물·세대·방문 기록을 그대로 둡니다.',
    deletePlace: '장소 삭제',
    deletePlaceHelp: '식당 세대를 삭제하고, 마지막 세대라면 빈 건물도 정리합니다.',
    cancel: '취소',
    addNext: '다음 식당 추가하기',
    restaurantName: '식당 이름',
    address: '주소',
    recheckAddress: '주소 재확인',
    addressDirty: '주소를 수정했습니다. 오른쪽 버튼을 눌러 재확인하세요.',
    requestBy: '신청',
    checkingLocation: '주소 위치 확인 중...',
    locationFound: '위치 확인됨',
    locationNotFound: '위치를 찾지 못했습니다. 아래에서 건물을 직접 선택하세요.',
    sameLocation: '같은 위치의 기존 건물',
    directSearch: '건물 직접 검색',
    buildingSearchPlaceholder: '건물 이름 또는 주소',
    newBuilding: '새 건물로 추가',
    newBuildingHelp: '미배정 건물 카드에 새로 생성',
    willRegisterBuilding: (name: string) => `✓ ${name} 건물에 식당으로 등록됩니다`,
    willCreateBuilding: '✓ 미배정 건물 카드에 새 건물로 추가됩니다',
    processing: '처리 중...',
    approve: '승인 확정',
    reject: '거절',
    units: (count: number) => `세대 ${count}개`,
  },
  zh: {
    excluded: '非目标',
    lastVisit: '最近',
    hideExcluded: (n: number) => `隐藏非目标 ${n} 处`,
    releaseExcluded: '解除非目标',
    releaseTitle: '解除非目标',
    releaseHint: '写下解除原因，下次访问的人就能知道理由。（选填）',
    releaseReasonPlaceholder: '例：新来了会中文的员工',
    release: '解除',
    other: '其他',
    pendingTitle: '餐厅传道申请',
    total: (count: number) => `共 ${count} 个`,
    csvBulk: 'CSV 批量登记',
    addRestaurant: '添加餐厅',
    searchPlaceholder: '搜索餐厅名称或地址',
    emptyAdmin: '还没有登记餐厅。',
    emptyAdminHelp: '请用上方 + 添加餐厅开始。',
    emptyUser: '还没有登记餐厅。',
    noSearch: '没有搜索结果。',
    open: '打开',
    close: '收起',
    map: '地图',
    more: '更多',
    removeFromList: '从餐厅列表移除',
    removeTitle: '整理餐厅',
    removeHint: '请选择只从餐厅列表移除，还是连同地点资料一起删除。',
    removeListHelp: '保留建筑、住户和访问记录。',
    deletePlace: '删除地点',
    deletePlaceHelp: '删除餐厅住户；若为最后一个住户，也会清理空建筑。',
    cancel: '取消',
    addNext: '继续添加餐厅',
    restaurantName: '餐厅名称',
    address: '地址',
    recheckAddress: '重新确认地址',
    addressDirty: '地址已修改。请按右侧按钮重新确认。',
    requestBy: '申请',
    checkingLocation: '正在确认地址位置...',
    locationFound: '位置已确认',
    locationNotFound: '找不到位置。请在下方直接选择建筑。',
    sameLocation: '同一位置的现有建筑',
    directSearch: '直接搜索建筑',
    buildingSearchPlaceholder: '建筑名称或地址',
    newBuilding: '新增为新建筑',
    newBuildingHelp: '在未分配建筑卡中新增',
    willRegisterBuilding: (name: string) => `✓ 将登记到“${name}”建筑为餐厅`,
    willCreateBuilding: '✓ 将在未分配建筑卡中新增建筑',
    processing: '处理中...',
    approve: '确认批准',
    reject: '拒绝',
    units: (count: number) => `${count} 户`,
  },
  en: {
    excluded: 'Not target',
    lastVisit: 'Last',
    hideExcluded: (n: number) => `Hide ${n} not-target`,
    releaseExcluded: 'Clear not-target',
    releaseTitle: 'Clear not-target',
    releaseHint: 'A short reason helps whoever visits next. (optional)',
    releaseReasonPlaceholder: 'e.g. Chinese-speaking staff joined',
    release: 'Clear',
    other: 'Other',
    pendingTitle: 'Restaurant service requests',
    total: (count: number) => `${count} total`,
    csvBulk: 'Bulk CSV',
    addRestaurant: 'Add restaurant',
    searchPlaceholder: 'Search restaurant name or address',
    emptyAdmin: 'No restaurants have been added yet.',
    emptyAdminHelp: 'Start with + Add restaurant above.',
    emptyUser: 'No restaurants have been added yet.',
    noSearch: 'No results.',
    open: 'Open',
    close: 'Close',
    map: 'Map',
    more: 'More',
    removeFromList: 'Remove from restaurant list',
    removeTitle: 'Clean up restaurant',
    removeHint: 'Choose whether to remove only the restaurant label or delete the place data too.',
    removeListHelp: 'Keeps the building, unit, and visit history.',
    deletePlace: 'Delete place',
    deletePlaceHelp: 'Deletes the restaurant unit and removes the empty building when it was the last unit.',
    cancel: 'Cancel',
    addNext: 'Add another restaurant',
    restaurantName: 'Restaurant name',
    address: 'Address',
    recheckAddress: 'Recheck address',
    addressDirty: 'Address changed. Press the right button to recheck.',
    requestBy: 'Requested by',
    checkingLocation: 'Checking address location...',
    locationFound: 'Location confirmed',
    locationNotFound: 'Could not find the location. Select a building below.',
    sameLocation: 'Existing building at same location',
    directSearch: 'Search building',
    buildingSearchPlaceholder: 'Building name or address',
    newBuilding: 'Add as new building',
    newBuildingHelp: 'Create under unassigned building card',
    willRegisterBuilding: (name: string) => `✓ Will register as restaurant in ${name}`,
    willCreateBuilding: '✓ Will create a new building under unassigned card',
    processing: 'Processing...',
    approve: 'Approve',
    reject: 'Reject',
    units: (count: number) => `${count} units`,
  },
}

// Naver Maps 지오코딩 (Promise wrapping + 4초 타임아웃)
// 지도 페이지 밖에서는 콜백이 안 돌아오는 경우가 있어 타임아웃 필수
function geocodeAddress(address: string): Promise<{ lat: number; lng: number } | null> {
  return new Promise((resolve) => {
    const naver = (window as Window & { naver?: { maps?: { Service?: { geocode?: (opts: { query: string }, cb: (status: string, res: { v2?: { addresses?: Array<{ x: string; y: string }> } }) => void) => void } } } }).naver
    if (!naver?.maps?.Service?.geocode) { resolve(null); return }
    const timer = setTimeout(() => resolve(null), 4000) // 4초 내 응답 없으면 null
    // 주의: geocode를 구조분해할당 하면 this 컨텍스트를 잃어 콜백이 안 올 수 있음
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 네이버 지도 SDK 무타입
    naver.maps.Service.geocode({ query: address }, (status: string, res: any) => {
      clearTimeout(timer)
      const addr = res?.v2?.addresses?.[0]
      if (status !== 'OK' || !addr) { resolve(null); return }
      resolve({ lat: parseFloat(addr.y), lng: parseFloat(addr.x) })
    })
  })
}

// 주소 + 좌표 기반 건물 매칭
function findMatchedBuildings(address: string, coords: { lat: number; lng: number } | null, buildings: Building[]): Building[] {
  const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase()
  const addrNorm = norm(address)
  const byAddress = buildings.filter((b) => {
    const bNorm = norm(b.address)
    return bNorm === addrNorm || bNorm.includes(addrNorm) || addrNorm.includes(bNorm)
  })
  if (!coords) return byAddress
  const toRad = (d: number) => (d * Math.PI) / 180
  const byCoords = buildings.filter((b) => {
    if (!b.lat || !b.lng) return false
    const dLat = toRad(b.lat - coords.lat)
    const dLng = toRad(b.lng - coords.lng)
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(coords.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
    return 6371000 * 2 * Math.asin(Math.sqrt(a)) < 150
  })
  const ids = new Set(byAddress.map((b) => b.id))
  return [...byAddress, ...byCoords.filter((b) => !ids.has(b.id))]
}

// ── 아이콘 ─────────────────────────────
/** 목록용 짧은 날짜 — 올해면 08.12, 지난해면 25.08.12 */
function shortVisitDate(iso: string): string {
  const d = iso.slice(0, 10)
  const [y, m, day] = d.split('-')
  const nowYear = String(new Date().getFullYear())
  return y === nowYear ? `${m}.${day}` : `${y.slice(2)}.${m}.${day}`
}

function MapIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <polygon points="3 6 9 3 15 6 21 3 21 21 15 18 9 21 3 18 3 6" /><line x1="9" y1="3" x2="9" y2="21" /><line x1="15" y1="6" x2="15" y2="18" />
    </svg>
  )
}
function DotsIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <circle cx="12" cy="5" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="12" cy="19" r="1.5" />
    </svg>
  )
}
function PlusIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round">
      <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  )
}
function SearchIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  )
}
function SearchIconLg({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  )
}
function UploadIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  )
}
function DownloadIcon({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  )
}
function XIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  )
}
function ChevD({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  )
}
function Spinner() {
  return (
    <span style={{ display: 'inline-block', width: 12, height: 12, border: '2px solid var(--muted)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
  )
}

// ── 신청 카드 (카드별 독립 상태) ─────────────────────────────────────
type VerifyStatus = 'idle' | 'loading' | 'done'

function PendingRequestCard({
  req, buildings, cards, currentVisitor,
  onApprove, onReject,
  language = 'ko',
  translatePlaceNames = false,
}: {
  req: RestaurantRequest
  buildings: Building[]
  cards: TerritoryCard[]
  currentVisitor: string
  onApprove: (id: number, opts: { name: string; address: string; reviewer: string; existingBuildingId?: number | null; lat?: number; lng?: number }) => Promise<void>
  onReject: (id: number, reviewer: string) => Promise<void>
  language?: AppLanguage
  translatePlaceNames?: boolean
}) {
  const copy = restaurantCopy[language]
  const placeLabel = (value: string) => translateKoreanAddress(value, language, translatePlaceNames)
  const [name, setName] = useState(req.name)
  const [address, setAddress] = useState(req.address)
  const [addressDirty, setAddressDirty] = useState(false)

  const [verifyStatus, setVerifyStatus] = useState<VerifyStatus>('idle')
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null)
  const [matchedBuildings, setMatchedBuildings] = useState<Building[]>([])
  const [selectedMatchId, setSelectedMatchId] = useState<number | 'new'>('new')

  const [buildingSearch, setBuildingSearch] = useState('')
  const [processing, setProcessing] = useState<'approve' | 'reject' | null>(null)

  // 렌더 시 자동 주소 확인
  useEffect(() => {
    runVerify(req.address)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const runVerify = async (addr: string) => {
    setVerifyStatus('loading')
    setAddressDirty(false)
    const c = await geocodeAddress(addr)
    setCoords(c)
    const matched = findMatchedBuildings(addr, c, buildings)
    setMatchedBuildings(matched)
    setSelectedMatchId(matched.length > 0 ? matched[0].id : 'new')
    setVerifyStatus('done')
  }

  const buildingSearchResults = useMemo(() => {
    if (!buildingSearch.trim()) return []
    const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase()
    const q = norm(buildingSearch)
    return buildings.filter((b) => norm(`${b.name}${b.address}`).includes(q)).slice(0, 8)
  }, [buildings, buildingSearch])

  const selectedBuilding = matchedBuildings.find((b) => b.id === selectedMatchId)
    ?? buildingSearchResults.find((b) => b.id === selectedMatchId)

  const handleApprove = async () => {
    setProcessing('approve')
    await onApprove(req.id, {
      name,
      address,
      reviewer: currentVisitor,
      existingBuildingId: selectedMatchId === 'new' ? null : (selectedMatchId as number),
      lat: coords?.lat,
      lng: coords?.lng,
    })
    setProcessing(null)
  }

  const handleReject = async () => {
    setProcessing('reject')
    await onReject(req.id, currentVisitor)
    setProcessing(null)
  }

  const sharedInputStyle: React.CSSProperties = {
    padding: '8px 10px', borderRadius: 8,
    border: '1.5px solid var(--line)', fontSize: 14,
    background: 'var(--surface)', color: 'var(--ink)',
    outline: 'none', width: '100%', boxSizing: 'border-box',
  }

  return (
    <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--line, #e5e4e0)' }}>

      {/* 이름 */}
      <div style={{ marginBottom: 6 }}>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={copy.restaurantName}
          autoComplete="new-password"
          style={sharedInputStyle}
        />
      </div>

      {/* 주소 + 🔍 재확인 버튼 (깔끔한 이너 버튼 형태의 flex 컨테이너) */}
      <div style={{
        display: 'flex', alignItems: 'center',
        padding: '3px 4px 3px 10px',
        border: `1.5px solid ${addressDirty ? 'var(--primary-400, #818cf8)' : 'var(--line)'}`,
        borderRadius: 8,
        background: 'var(--surface)',
        marginBottom: 6,
        transition: 'border-color 0.15s',
      }}>
        <input
          value={address}
          onChange={(e) => { setAddress(e.target.value); setAddressDirty(true) }}
          placeholder={copy.address}
          autoComplete="new-password"
          style={{
            flex: 1, minWidth: 0,
            padding: '5px 0', fontSize: 14,
            border: 'none', outline: 'none',
            background: 'transparent', color: 'var(--ink)',
          }}
        />
        <button
          type="button"
          onClick={() => runVerify(address)}
          disabled={verifyStatus === 'loading'}
          title={copy.recheckAddress}
          style={{
            flexShrink: 0, width: 28, height: 28,
            borderRadius: 6,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: addressDirty ? 'var(--primary-500, #6366f1)' : 'var(--tint)',
            color: addressDirty ? '#fff' : 'var(--muted)',
            border: 'none',
            cursor: verifyStatus === 'loading' ? 'default' : 'pointer',
            transition: 'background 0.15s, color 0.15s',
          }}
        >
          {verifyStatus === 'loading' ? <Spinner /> : <SearchIcon />}
        </button>
      </div>

      {/* 주소 수정 안내 */}
      {addressDirty && (
        <div style={{ fontSize: 11, color: '#d97706', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
          🔍 {copy.addressDirty}
        </div>
      )}

      {/* 신청자 */}
      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>
        {copy.requestBy}: {req.requestedBy}
        {req.memo && <> · <em style={{ fontStyle: 'normal', color: 'var(--ink-light, #666)' }}>"{req.memo}"</em></>}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
        <span style={{ padding: '3px 7px', borderRadius: 5, background: 'var(--tint)', color: 'var(--ink)', fontSize: 11, fontWeight: 700 }}>{req.initialStatus}</span>
        <span style={{ padding: '3px 7px', borderRadius: 5, background: 'var(--tint)', color: 'var(--muted)', fontSize: 11, fontWeight: 600 }}>
          {req.isChinese ? '중국어 사용' : '중국어 미사용'}
        </span>
        {req.initialStatus === '정기방문' && req.regularVisitor && (
          <span style={{ padding: '3px 7px', borderRadius: 5, background: 'var(--tint)', color: 'var(--muted)', fontSize: 11, fontWeight: 600 }}>담당 {req.regularVisitor}</span>
        )}
      </div>

      {/* 주소 검증 결과 */}
      {verifyStatus === 'loading' && (
        <div style={{ fontSize: 12, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10, padding: '8px 10px', background: 'var(--tint)', borderRadius: 8 }}>
          <Spinner /> {copy.checkingLocation}
        </div>
      )}

      {verifyStatus === 'done' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12, padding: '10px 12px', background: 'var(--tint)', borderRadius: 10 }}>
          {/* 위치 확인 결과 */}
          {coords ? (
            <div style={{ fontSize: 12, color: '#16a34a', display: 'flex', alignItems: 'center', gap: 5, fontWeight: 600 }}>
              <span>📍</span> {copy.locationFound}
            </div>
          ) : (
            matchedBuildings.length === 0 && (
              <div style={{ fontSize: 12, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 5 }}>
                <span>📍</span> {copy.locationNotFound}
              </div>
            )
          )}

          {/* 자동 매칭된 건물 */}
          {matchedBuildings.length > 0 && (
            <div>
              <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                {copy.sameLocation}
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {matchedBuildings.map((b) => {
                  const cardName = cards.find((c) => c.id === b.cardId)?.name
                  return (
                    <label key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', borderRadius: 8, border: `1.5px solid ${selectedMatchId === b.id ? 'var(--ink)' : 'var(--line)'}`, cursor: 'pointer', background: selectedMatchId === b.id ? 'var(--bg-subtle)' : 'var(--surface)' }}>
                      <input type="radio" name={`match-${req.id}`} value={b.id} checked={selectedMatchId === b.id} onChange={() => setSelectedMatchId(b.id)} style={{ accentColor: 'var(--ink)', flexShrink: 0 }} />
                      <div style={{ minWidth: 0 }}>
                        <strong style={{ fontSize: 13 }}>{placeLabel(b.name || b.address)}</strong>
                        <div style={{ fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {cardName ? `${placeLabel(cardName)} · ` : ''}{placeLabel(b.address)} · {copy.units(b.units.length)}
                        </div>
                      </div>
                    </label>
                  )
                })}
              </div>
            </div>
          )}

          {/* 건물 직접 검색 */}
          <div>
            <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              {copy.directSearch}
            </p>
            <div style={{ position: 'relative' }}>
              <span style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)', display: 'flex', pointerEvents: 'none' }}>
                <SearchIcon size={13} />
              </span>
              <input
                value={buildingSearch}
                onChange={(e) => setBuildingSearch(e.target.value)}
                placeholder={copy.buildingSearchPlaceholder}
                autoComplete="off"
                style={{ width: '100%', boxSizing: 'border-box', padding: '7px 10px 7px 26px', borderRadius: 8, border: '1.5px solid var(--line)', fontSize: 13, background: 'var(--surface)', color: 'var(--ink)', outline: 'none' }}
              />
            </div>
            {buildingSearchResults.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 5 }}>
                {buildingSearchResults.map((b) => {
                  const cardName = cards.find((c) => c.id === b.cardId)?.name
                  return (
                    <label key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', borderRadius: 8, border: `1.5px solid ${selectedMatchId === b.id ? 'var(--ink)' : 'var(--line)'}`, cursor: 'pointer', background: selectedMatchId === b.id ? 'var(--bg-subtle)' : 'var(--surface)' }}>
                      <input type="radio" name={`match-${req.id}`} value={b.id} checked={selectedMatchId === b.id} onChange={() => setSelectedMatchId(b.id)} style={{ accentColor: 'var(--ink)', flexShrink: 0 }} />
                      <div style={{ minWidth: 0 }}>
                        <strong style={{ fontSize: 13 }}>{placeLabel(b.name || b.address)}</strong>
                        <div style={{ fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {cardName ? `${placeLabel(cardName)} · ` : ''}{placeLabel(b.address)}
                        </div>
                      </div>
                    </label>
                  )
                })}
              </div>
            )}
          </div>

          {/* 새 건물로 추가 */}
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', borderRadius: 8, border: `1.5px solid ${selectedMatchId === 'new' ? 'var(--ink)' : 'var(--line)'}`, cursor: 'pointer', background: selectedMatchId === 'new' ? 'var(--bg-subtle)' : 'var(--surface)' }}>
            <input type="radio" name={`match-${req.id}`} value="new" checked={selectedMatchId === 'new'} onChange={() => setSelectedMatchId('new')} style={{ accentColor: 'var(--ink)', flexShrink: 0 }} />
            <div>
              <strong style={{ fontSize: 13 }}>{copy.newBuilding}</strong>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>{copy.newBuildingHelp}</div>
            </div>
          </label>

          {/* 선택 요약 */}
          {selectedMatchId !== 'new' && selectedBuilding && (
            <div style={{ fontSize: 11, color: 'var(--ink)', background: 'var(--bg-subtle)', borderRadius: 6, padding: '5px 8px', border: '1px solid var(--line)' }}>
              {copy.willRegisterBuilding(placeLabel(selectedBuilding.name || selectedBuilding.address))}
            </div>
          )}
          {selectedMatchId === 'new' && (
            <div style={{ fontSize: 11, color: 'var(--ink)', background: 'var(--bg-subtle)', borderRadius: 6, padding: '5px 8px', border: '1px solid var(--line)' }}>
              {copy.willCreateBuilding}
            </div>
          )}
        </div>
      )}

      {/* 액션 버튼 */}
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          type="button"
          onClick={handleApprove}
          disabled={!!processing || verifyStatus === 'loading'}
          style={{ flex: 1, padding: '9px 0', borderRadius: 8, border: 'none', background: processing === 'approve' ? 'var(--muted)' : 'var(--ink)', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
        >
          {processing === 'approve' ? copy.processing : copy.approve}
        </button>
        <button
          type="button"
          onClick={handleReject}
          disabled={!!processing}
          style={{ padding: '9px 16px', borderRadius: 8, border: '1px solid #fca5a5', background: '#fff', color: '#ef4444', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
        >
          {processing === 'reject' ? '...' : copy.reject}
        </button>
      </div>
    </div>
  )
}

// ── 메인 탭 컴포넌트 ─────────────────────────────────────────────────
type Props = {
  role: Role
  buildings: Building[]
  cardBoundaries?: CardBoundary[]
  cards: TerritoryCard[]
  currentVisitor?: string
  visitorNames?: string[]
  restaurantRequests?: RestaurantRequest[]
  onRegisterRestaurant?: RegisterRestaurant
  onToggleRestaurantFlag?: (buildingId: number, isRestaurant: boolean) => Promise<void>
  onRemoveRestaurantUnit?: (unitId: number | null, buildingId: number, mode?: 'list' | 'place', deleteEmptyBuilding?: boolean) => Promise<void>
  onBulkSetRestaurant?: (buildingIds: number[], nameUpdates?: { id: number; name: string }[]) => Promise<void>
  onApproveRestaurantRequest?: (id: number, opts: { name: string; address: string; reviewer: string; existingBuildingId?: number | null; lat?: number; lng?: number }) => Promise<void>
  onRejectRestaurantRequest?: (id: number, reviewer: string) => Promise<void>
  onOpenMap: (cardId: number) => void
  onOpenBuildingMap?: (buildingId: number) => void
  /** 방문 기록 — 식당별 최근 방문일 표시에 쓴다 */
  visitHistories?: VisitHistory[]
  /** 대상외 해제용. 방문 기록을 만들지 않고 상태·메모만 고친다 */
  onUpdateUnitFlags?: (unitId: number, flags: Partial<Unit>) => void
  language?: AppLanguage
  translatePlaceNames?: boolean
}

export function RestaurantsTab({
  role, buildings, cardBoundaries = [], cards, currentVisitor = '', visitorNames = [], restaurantRequests = [],
  onRegisterRestaurant, onToggleRestaurantFlag, onRemoveRestaurantUnit, onBulkSetRestaurant, onApproveRestaurantRequest, onRejectRestaurantRequest, onOpenMap, onOpenBuildingMap,
  visitHistories = [], onUpdateUnitFlags,
  language = 'ko',
  translatePlaceNames = false,
}: Props) {
  const copy = restaurantCopy[language]
  const placeLabel = (value: string) => translateKoreanAddress(value, language, translatePlaceNames)
  const canManage = isLeaderOrAdmin(role)
  const [search, setSearch] = useState('')
  const [hideExcluded, setHideExcluded] = useState(false)
  // 대상외 해제 — 사유를 받아 세대 메모에 남긴다 (누가·언제·왜)
  const [excludeReleaseTarget, setExcludeReleaseTarget] = useState<{ unit: Unit; name: string } | null>(null)
  const [releaseReason, setReleaseReason] = useState('')
  const [expandedRegions, setExpandedRegions] = useState<Set<string>>(new Set())
  const [removingKey, setRemovingKey] = useState<string | null>(null)
  const [removeTarget, setRemoveTarget] = useState<{ key: string; name: string; building: Building; unit: Unit | null } | null>(null)

  // 세대별 최근 방문일
  const lastVisitByUnit = useMemo(() => {
    const map = new Map<number, string>()
    for (const h of visitHistories) {
      const prev = map.get(h.unitId)
      if (!prev || h.visitedAt > prev) map.set(h.unitId, h.visitedAt)
    }
    return map
  }, [visitHistories])

  const releaseExcluded = async () => {
    const target = excludeReleaseTarget
    if (!target || !onUpdateUnitFlags) return
    const today = new Date().toISOString().slice(0, 10)
    const reason = releaseReason.trim()
    const line = `${today} ${currentVisitor || '관리자'}: 대상외 해제${reason ? ` — ${reason}` : ''}`
    const memo = [target.unit.memo?.trim(), line].filter(Boolean).join('\n')
    onUpdateUnitFlags(target.unit.id, { status: '미방문', memo })
    setExcludeReleaseTarget(null)
    setReleaseReason('')
  }

  const toggleRegion = (region: string) => {
    setExpandedRegions(prev => {
      const next = new Set(prev)
      if (next.has(region)) next.delete(region)
      else next.add(region)
      return next
    })
  }

  const [addOpen, setAddOpen] = useState(false)
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)

  // ── CSV 일괄등록 상태 ─────────────────────────────────────────
  const [csvPanelOpen, setCsvPanelOpen] = useState(false)
  const [csvResults, setCsvResults] = useState<MatchResult[] | null>(null)
  const [csvFileName, setCsvFileName] = useState('')
  const [csvApplying, setCsvApplying] = useState(false)
  const [csvDone, setCsvDone] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const csvMatched = useMemo(
    () => csvResults?.filter((r) => r.matched && !r.alreadyRestaurant) ?? [],
    [csvResults],
  )
  const csvAlready = useMemo(
    () => csvResults?.filter((r) => r.alreadyRestaurant) ?? [],
    [csvResults],
  )
  const csvUnmatched = useMemo(
    () => csvResults?.filter((r) => !r.matched) ?? [],
    [csvResults],
  )

  function handleSampleDownload() {
    const blob = new Blob(['﻿' + SAMPLE_CSV_CONTENT], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = '식당_CSV_예시.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setCsvFileName(file.name)
    setCsvDone(false)
    const reader = new FileReader()
    reader.onload = (ev) => {
      const text = ev.target?.result as string
      const rows = parseCsvRestaurants(text)
      const results = matchRestaurantsToBuildings(rows, buildings)
      setCsvResults(results)
    }
    reader.readAsText(file, 'UTF-8')
    // 같은 파일 재선택 가능하도록 초기화
    e.target.value = ''
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    const file = e.dataTransfer.files?.[0]
    if (!file) return
    setCsvFileName(file.name)
    setCsvDone(false)
    const reader = new FileReader()
    reader.onload = (ev) => {
      const text = ev.target?.result as string
      const rows = parseCsvRestaurants(text)
      const results = matchRestaurantsToBuildings(rows, buildings)
      setCsvResults(results)
    }
    reader.readAsText(file, 'UTF-8')
  }

  async function handleApplyBulk() {
    if (!onBulkSetRestaurant || csvMatched.length === 0) return
    setCsvApplying(true)
    try {
      const ids = csvMatched.map((r) => r.matched!.id)
      await onBulkSetRestaurant(ids)
      setCsvDone(true)
      setCsvResults(null)
      setCsvFileName('')
    } finally {
      setCsvApplying(false)
    }
  }

  function handleCloseCsv() {
    setCsvPanelOpen(false)
    setCsvResults(null)
    setCsvFileName('')
    setCsvDone(false)
  }

  const pendingRequests = useMemo(
    () => restaurantRequests.filter((r) => r.status === 'pending'),
    [restaurantRequests],
  )

  // 세대별 평탄화 타입
  type RestaurantRow = { building: Building; unit: Unit | null; key: string }

  const restaurants = useMemo<RestaurantRow[]>(() => {
    const rows: RestaurantRow[] = []
    for (const b of buildings) {
      // 판정은 utils/restaurants 한 곳에서만. 유형(상가) 조건은 걸지 않는다
      // — 잘못 등록된 건물이 조용히 사라지는 편보다 눈에 보이는 편이 낫다
      const restaurantUnits = getRestaurantUnits(b)
      if (restaurantUnits.length === 0) {
        if (!b.isRestaurant) continue
        // 세대가 없는 옛 데이터는 건물명으로 1행
        rows.push({ building: b, unit: null, key: `${b.id}-none` })
      } else {
        for (const u of restaurantUnits) {
          rows.push({ building: b, unit: u, key: `${b.id}-${u.id}` })
        }
      }
    }
    return rows
  }, [buildings])

  const excludedCount = useMemo(
    () => restaurants.filter((r) => r.unit?.status === '대상외').length,
    [restaurants],
  )

  // 식당명: 세대 번호(unit.number) → 건물명 → 주소 순
  const getRestaurantName = (row: RestaurantRow): string =>
    row.unit?.number || row.building.name || row.building.address

  const filtered = useMemo(() => {
    const q = normalizeCardSearch(search)
    if (!q) return restaurants
    return restaurants.filter((row) =>
      normalizeCardSearch(`${getRestaurantName(row)}${row.building.address}`).includes(q),
    )
  // eslint-disable-next-line react-hooks/exhaustive-deps -- getRestaurantName은 안정적인 헬퍼(렌더 무관)
  }, [restaurants, search])

  const grouped = useMemo(() => {
    const map = new Map<string, RestaurantRow[]>()
    for (const row of filtered) {
      const card = cards.find((c) => c.id === row.building.cardId)
      const region = (card?.region as string) || copy.other
      const list = map.get(region) ?? []
      list.push(row)
      map.set(region, list)
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b, language === 'zh' ? 'zh-Hans-CN' : language))
  }, [filtered, cards, copy.other, language])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* ── 식당봉사 승인 대기 ─────────────────────────── */}
      {canManage && pendingRequests.length > 0 && (
        <div style={{
          background: 'var(--gray-50, #f9f8f7)',
          border: '1px solid var(--line, #e5e4e0)',
          borderRadius: 12, overflow: 'hidden',
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '12px 16px',
            borderBottom: '1px solid var(--line, #e5e4e0)',
            background: 'var(--tint, #EFEFED)',
          }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink)' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 13h18"></path>
                <path d="M4 13a8 8 0 0 0 16 0"></path>
                <path d="M8 21h8"></path>
                <path d="M9 9v-3"></path>
                <path d="M12 9v-4"></path>
                <path d="M15 9v-3"></path>
              </svg>
            </span>
            <span style={{ fontSize: 14, color: 'var(--ink)', fontWeight: 600 }}>{copy.pendingTitle}</span>
            <span style={{
              marginLeft: 'auto',
              background: '#ef4444', color: '#fff',
              borderRadius: 10, padding: '1px 7px', fontSize: 11, fontWeight: 700,
            }}>{pendingRequests.length}</span>
          </div>
          {pendingRequests.map((req) => (
            <PendingRequestCard
              key={req.id}
              req={req}
              buildings={buildings}
              cards={cards}
              currentVisitor={currentVisitor}
              onApprove={async (id, opts) => { await onApproveRestaurantRequest?.(id, opts) }}
              onReject={async (id, reviewer) => { await onRejectRestaurantRequest?.(id, reviewer) }}
              language={language}
              translatePlaceNames={translatePlaceNames}
            />
          ))}
        </div>
      )}

      {/* 상단 카운트 + 추가 + CSV */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 4px' }}>
        <span style={{ fontSize: 13, color: 'var(--muted)' }}>{copy.total(restaurants.length)}</span>
        {/* restaurants = 세대별 행 수 */}
        {canManage && (
          <div style={{ display: 'flex', gap: 8 }}>
            {onBulkSetRestaurant && (
              <button type="button" onClick={() => { setCsvPanelOpen((o) => !o); setCsvDone(false) }}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 5, height: 32, minHeight: 32, padding: '0 12px', border: '1px solid var(--line-2)', borderRadius: 8, background: 'var(--surface)', color: 'var(--text)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                <UploadIcon /> {copy.csvBulk}
              </button>
            )}
            <button type="button" onClick={() => setAddOpen(true)} disabled={!onRegisterRestaurant}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4, height: 32, minHeight: 32, padding: '0 12px', border: 'none', borderRadius: 8, background: 'var(--ink)', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', letterSpacing: '-0.005em' }}>
              <PlusIcon /> {copy.addRestaurant}
            </button>
          </div>
        )}
      </div>

      {/* ── CSV 일괄등록 패널 ─────────────────────────────────── */}
      {csvPanelOpen && (
        <div style={{ background: 'var(--tint)', border: '1px solid var(--line)', borderRadius: 12, overflow: 'hidden' }}>

          {/* 패널 헤더 */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--line)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <UploadIcon size={16} />
              <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>{msg('CSV 일괄등록')}</span>
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>{msg('식당 건물에 식당 표시를 한꺼번에 적용합니다')}</span>
            </div>
            <button type="button" onClick={handleCloseCsv}
              style={{ width: 28, height: 28, minHeight: 0, display: 'grid', placeItems: 'center', background: 'transparent', border: 'none', color: 'var(--muted)', cursor: 'pointer', borderRadius: 6 }}>
              <XIcon size={14} />
            </button>
          </div>

          <div style={{ padding: '16px' }}>

            {/* 샘플 다운로드 + 파일 선택 */}
            {!csvResults && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 10 }}>
                  <span style={{ fontSize: 13, color: 'var(--text)', flex: 1 }}>
                    {msg('CSV 형식')}: <code style={{ fontSize: 12, background: 'var(--tint)', padding: '2px 6px', borderRadius: 4, color: 'var(--ink)' }}>{msg('시구, 동, 상세주소, 식당명')}</code>
                  </span>
                  <button type="button" onClick={handleSampleDownload}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 5, height: 30, padding: '0 10px', border: '1px solid var(--line-2)', borderRadius: 7, background: 'var(--surface)', color: 'var(--text)', fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}>
                    <DownloadIcon /> {msg('예시 파일')}
                  </button>
                </div>

                {/* 파일 드롭 존 */}
                <div
                  onDrop={handleDrop}
                  onDragOver={(e) => e.preventDefault()}
                  onClick={() => fileInputRef.current?.click()}
                  style={{
                    border: '1.5px dashed var(--line-2)', borderRadius: 12, padding: '32px 16px',
                    textAlign: 'center', cursor: 'pointer',
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
                    background: 'var(--surface)',
                    transition: 'background 0.15s',
                  }}
                >
                  <UploadIcon size={24} />
                  <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>{msg('CSV 파일 선택 또는 드래그')}</span>
                  <span style={{ fontSize: 12, color: 'var(--muted)' }}>{msg('Excel에서 내보낸 .csv 파일을 올려주세요')}</span>
                  {csvFileName && <span style={{ fontSize: 12, color: 'var(--ink)', fontWeight: 600 }}>📎 {csvFileName}</span>}
                </div>
                <input ref={fileInputRef} type="file" accept=".csv,text/csv" style={{ display: 'none' }} onChange={handleFileChange} />
              </div>
            )}

            {/* CSV 완료 메시지 */}
            {csvDone && (
              <div style={{ padding: '20px', textAlign: 'center', fontSize: 14, color: '#16a34a', fontWeight: 600 }}>
                ✓ {msg('식당 등록이 완료됐습니다')}
              </div>
            )}

            {/* 미리보기 결과 */}
            {csvResults && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

                {/* 집계 요약 */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
                  <div style={{ padding: '12px', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 10, textAlign: 'center' }}>
                    <div style={{ fontSize: 22, fontWeight: 700, color: '#16a34a' }}>{csvMatched.length}</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{msg('매칭됨 (신규)')}</div>
                  </div>
                  <div style={{ padding: '12px', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 10, textAlign: 'center' }}>
                    <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--muted)' }}>{csvAlready.length}</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{msg('이미 식당')}</div>
                  </div>
                  <div style={{ padding: '12px', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 10, textAlign: 'center' }}>
                    <div style={{ fontSize: 22, fontWeight: 700, color: '#c44536' }}>{csvUnmatched.length}</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{msg('미매칭')}</div>
                  </div>
                </div>

                {/* 매칭된 항목 목록 */}
                {csvMatched.length > 0 && (
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      {msg('식당 표시 적용 예정 ({count}개)', { count: csvMatched.length })}
                    </div>
                    <div style={{ maxHeight: 220, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4, padding: '2px 0' }}>
                      {csvMatched.map((r, i) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 8, fontSize: 13 }}>
                          <span style={{ color: '#16a34a', fontWeight: 700, flexShrink: 0 }}>✓</span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <span style={{ fontWeight: 600, color: 'var(--ink)' }}>{r.row.name || r.row.address}</span>
                            {r.nameWillUpdate && (
                              <span style={{ marginLeft: 6, fontSize: 11, color: '#0891b2', background: '#ecfeff', padding: '1px 5px', borderRadius: 4 }}>{msg('이름 업데이트')}</span>
                            )}
                            <span style={{ color: 'var(--muted)', marginLeft: 6, fontSize: 12 }}>→ {r.matched!.address}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 미매칭 항목 */}
                {csvUnmatched.length > 0 && (
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      {msg('주소 미매칭 ({count}개) — 건너뜀', { count: csvUnmatched.length })}
                    </div>
                    <div style={{ maxHeight: 140, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {csvUnmatched.map((r, i) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 12px', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 8, fontSize: 12, color: 'var(--muted)' }}>
                          <span style={{ color: '#c44536', fontWeight: 700, flexShrink: 0 }}>✗</span>
                          <span>{r.row.name}</span>
                          <span style={{ color: 'var(--line-2)', margin: '0 2px' }}>·</span>
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.row.sigu} {r.row.address}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 파일 재선택 + 적용 버튼 */}
                <div style={{ display: 'flex', gap: 10 }}>
                  <button type="button"
                    onClick={() => { setCsvResults(null); setCsvFileName('') }}
                    style={{ flex: 1, padding: '9px 0', borderRadius: 9, border: '1px solid var(--line-2)', background: 'var(--surface)', color: 'var(--text)', fontSize: 13, fontWeight: 600, cursor: 'pointer', minHeight: 0 }}>
                    {msg('다시 선택')}
                  </button>
                  <button type="button"
                    disabled={csvMatched.length === 0 || csvApplying}
                    onClick={handleApplyBulk}
                    style={{ flex: 2, padding: '9px 0', borderRadius: 9, border: 'none', background: csvMatched.length === 0 ? 'var(--muted)' : 'var(--ink)', color: '#fff', fontSize: 13, fontWeight: 600, cursor: csvMatched.length === 0 ? 'default' : 'pointer', minHeight: 0 }}>
                    {csvApplying ? msg('적용 중...') : csvMatched.length === 0 ? msg('적용 대상 없음') : msg('{count}개 식당 표시 적용', { count: csvMatched.length })}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 검색 */}
      <label style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 10, padding: '11px 14px', fontSize: 14, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 8, cursor: 'text' }}>
        <span style={{ color: 'var(--muted-2)', display: 'inline-flex' }}><SearchIconLg /></span>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={copy.searchPlaceholder}
          style={{ flex: 1, minWidth: 0, border: 'none', outline: 'none', background: 'transparent', font: 'inherit', color: 'inherit', padding: 0 }}
        />
      </label>

      {/* 대상외는 기본으로 보여 준다 — 숨기면 "왜 안 보이지?" 하고 헤매기 쉽다 */}
      {excludedCount > 0 && (
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 7, marginTop: 2, fontSize: 13, color: 'var(--muted)', cursor: 'pointer' }}>
          <input type="checkbox" checked={hideExcluded} onChange={(e) => setHideExcluded(e.target.checked)} />
          {copy.hideExcluded(excludedCount)}
        </label>
      )}

      {/* 빈 상태 */}
      {restaurants.length === 0 ? (
        <div style={{ padding: '40px 16px', textAlign: 'center', fontSize: 13, color: 'var(--muted)', lineHeight: 1.6, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 12 }}>
          {canManage ? <>{copy.emptyAdmin}<br />{copy.emptyAdminHelp}</> : <>{copy.emptyUser}</>}
        </div>
      ) : grouped.length === 0 ? (
        <div style={{ padding: '32px 16px', textAlign: 'center', fontSize: 13, color: 'var(--muted)' }}>{copy.noSearch}</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {grouped.map(([region, list]) => (
            <section key={region}>
              <div 
                onClick={() => toggleRegion(region)}
                style={{ display: 'flex', alignItems: 'center', padding: '8px 4px', justifyContent: 'space-between', marginBottom: 6, cursor: 'pointer', userSelect: 'none' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ display: 'flex', transform: expandedRegions.has(region) ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 0.2s' }}>
                    <ChevD />
                  </span>
                  <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>{placeLabel(region)}</span>
                  <span style={{ fontSize: 12, color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' }}>{list.length}</span>
                </div>
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                  {expandedRegions.has(region) ? copy.close : copy.open}
                </span>
              </div>
              {expandedRegions.has(region) && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {list.filter((row) => !hideExcluded || row.unit?.status !== '대상외').map((row) => {
                  const { building: b, unit: rowUnit, key } = row
                  const restaurantName = getRestaurantName(row)
                  const isExcluded = rowUnit?.status === '대상외'
                  const lastVisit = rowUnit ? lastVisitByUnit.get(rowUnit.id) : undefined
                  return (
                    <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 10px 9px 12px', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 10 }}>
                      {/* 포크 아이콘 제거 — 385줄이 전부 같은 그림이라 자리만 차지했다.
                          이름과 뱃지가 잘리던 것도 그 공간을 되찾아 해결된다 */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
                          <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 14.5, fontWeight: 600, color: isExcluded ? 'var(--muted)' : 'var(--ink)' }}>
                            {placeLabel(restaurantName)}
                          </span>
                          {/* 뱃지는 이름 밖에 둔다 — 안에 있으면 이름 말줄임에 같이 잘린다 */}
                          {isExcluded && (
                            <span style={{ flexShrink: 0, padding: '0 5px', borderRadius: 4, background: 'var(--tint)', border: '1px solid var(--line-2)', color: 'var(--muted)', fontSize: 10.5, fontWeight: 700, lineHeight: '16px' }}>
                              {copy.excluded}
                            </span>
                          )}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0, fontSize: 12, color: 'var(--muted)' }}>
                          <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {placeLabel(b.address)}
                          </span>
                          {lastVisit && <span style={{ flexShrink: 0 }}>· {shortVisitDate(lastVisit)}</span>}
                        </div>
                      </div>
                      <button type="button"
                        onClick={() => onOpenBuildingMap ? onOpenBuildingMap(b.id) : onOpenMap(b.cardId)}
                        aria-label={copy.map}
                        title={copy.map}
                        style={{ flexShrink: 0, width: 36, height: 36, minHeight: 36, display: 'grid', placeItems: 'center', border: '1px solid var(--line-2)', borderRadius: 8, background: 'var(--surface)', color: 'var(--text)', cursor: 'pointer' }}>
                        <MapIcon />
                      </button>
                      {canManage && (onToggleRestaurantFlag || onRemoveRestaurantUnit) && (
                        <div style={{ position: 'relative' }}>
                          <button type="button" onClick={() => setOpenMenuId(openMenuId === key ? null : key)}
                            style={{ width: 36, height: 36, minHeight: 36, display: 'grid', placeItems: 'center', background: 'transparent', border: 'none', color: 'var(--text)', cursor: 'pointer', borderRadius: 8 }}
                            aria-label={copy.more}>
                            <DotsIcon />
                          </button>
                          {openMenuId === key && (
                            <>
                              <div onClick={() => setOpenMenuId(null)} style={{ position: 'fixed', inset: 0, zIndex: 30 }} />
                              <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: 4, zIndex: 31, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 8, boxShadow: '0 4px 12px rgba(0,0,0,0.08)', minWidth: 140, padding: 4 }}>
                                <button type="button"
                                  onClick={() => {
                                    setOpenMenuId(null)
                                    setRemoveTarget({ key, name: placeLabel(restaurantName), building: b, unit: rowUnit ?? null })
                                  }}
                                  disabled={removingKey === key}
                                  style={{ width: '100%', textAlign: 'left', padding: '8px 10px', minHeight: 0, background: 'transparent', border: 'none', fontSize: 13, color: 'var(--status-danger)', cursor: 'pointer', borderRadius: 6 }}>
                                  {removingKey === key ? copy.processing : copy.removeFromList}
                                </button>
                                {isExcluded && rowUnit && onUpdateUnitFlags && (
                                  <button type="button"
                                    onClick={() => {
                                      setOpenMenuId(null)
                                      setReleaseReason('')
                                      setExcludeReleaseTarget({ unit: rowUnit, name: placeLabel(restaurantName) })
                                    }}
                                    style={{ width: '100%', textAlign: 'left', padding: '8px 10px', minHeight: 0, background: 'transparent', border: 'none', fontSize: 13, color: 'var(--text)', cursor: 'pointer', borderRadius: 6 }}>
                                    {copy.releaseExcluded}
                                  </button>
                                )}
                              </div>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
              )}
            </section>
          ))}
          {canManage && onRegisterRestaurant && (
            <button type="button" onClick={() => setAddOpen(true)}
              style={{ padding: '18px 14px', border: '1px dashed var(--line-2)', background: 'transparent', color: 'var(--muted)', borderRadius: 12, display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'center', font: 'inherit', fontSize: 13, fontWeight: 500, cursor: 'pointer', minHeight: 0 }}>
              <PlusIcon /> {copy.addNext}
            </button>
          )}
        </div>
      )}

      {canManage && addOpen && onRegisterRestaurant && (
        <RestaurantRegistrationModal
          buildings={buildings}
          cardBoundaries={cardBoundaries}
          visitorNames={visitorNames}
          onRegister={onRegisterRestaurant}
          onClose={() => setAddOpen(false)}
        />
      )}

      {removeTarget && (
        <div className="v2-picker-backdrop" onClick={() => { if (!removingKey) setRemoveTarget(null) }}>
          <div className="v2-picker-sheet restaurant-remove-picker" role="dialog" aria-modal="true" aria-labelledby="restaurant-remove-title" onClick={(event) => event.stopPropagation()}>
            <div className="v2-picker-head">
              <div>
                <h2 id="restaurant-remove-title">{copy.removeTitle}</h2>
                <p>{removeTarget.name}</p>
              </div>
              <button type="button" className="v2-picker-close" disabled={Boolean(removingKey)} onClick={() => setRemoveTarget(null)} aria-label={copy.cancel}>×</button>
            </div>
            <div className="restaurant-remove-actions">
              <p>{copy.removeHint}</p>
              <button type="button" disabled={Boolean(removingKey)} onClick={async () => {
                setRemovingKey(removeTarget.key)
                try {
                  if (removeTarget.unit && onRemoveRestaurantUnit) {
                    await onRemoveRestaurantUnit(removeTarget.unit.id, removeTarget.building.id, 'list')
                  } else if (onToggleRestaurantFlag) {
                    await onToggleRestaurantFlag(removeTarget.building.id, false)
                  }
                  setRemoveTarget(null)
                } finally { setRemovingKey(null) }
              }}>
                <strong>{copy.removeFromList}</strong>
                <span>{copy.removeListHelp}</span>
              </button>
              <button type="button" className="is-danger" disabled={Boolean(removingKey) || !onRemoveRestaurantUnit} onClick={async () => {
                setRemovingKey(removeTarget.key)
                try {
                  await onRemoveRestaurantUnit?.(
                    removeTarget.unit?.id ?? null,
                    removeTarget.building.id,
                    'place',
                    removeTarget.building.units.length <= 1,
                  )
                  setRemoveTarget(null)
                } finally { setRemovingKey(null) }
              }}>
                <strong>{removingKey ? copy.processing : copy.deletePlace}</strong>
                <span>{copy.deletePlaceHelp}</span>
              </button>
              <button type="button" className="restaurant-remove-cancel" disabled={Boolean(removingKey)} onClick={() => setRemoveTarget(null)}>{copy.cancel}</button>
            </div>
          </div>
        </div>
      )}

      {/* 대상외 해제 — 사유를 받아 세대 메모에 남긴다 (누가·언제·왜) */}
      {excludeReleaseTarget && (
        <div
          onClick={() => setExcludeReleaseTarget(null)}
          style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(15,23,42,0.45)', display: 'grid', placeItems: 'center', padding: 16 }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ width: '100%', maxWidth: 380, background: 'var(--surface)', borderRadius: 14, padding: 18, boxShadow: '0 12px 40px rgba(15,23,42,0.25)' }}
          >
            <h3 style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 700, color: 'var(--ink)' }}>{copy.releaseTitle}</h3>
            <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--muted)' }}>{excludeReleaseTarget.name}</p>
            <p style={{ margin: '0 0 8px', fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.5 }}>{copy.releaseHint}</p>
            <input
              autoFocus
              value={releaseReason}
              onChange={(e) => setReleaseReason(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void releaseExcluded() }}
              placeholder={copy.releaseReasonPlaceholder}
              style={{ width: '100%', boxSizing: 'border-box', padding: '9px 11px', borderRadius: 9, border: '1px solid var(--line)', fontSize: 13.5, background: 'var(--bg)', color: 'var(--ink)' }}
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <button type="button" onClick={() => setExcludeReleaseTarget(null)}
                style={{ flex: 1, padding: '9px 0', borderRadius: 9, border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--muted)', fontSize: 13.5, fontWeight: 600, cursor: 'pointer' }}>
                {msg('취소')}
              </button>
              <button type="button" onClick={() => void releaseExcluded()}
                style={{ flex: 1, padding: '9px 0', borderRadius: 9, border: 'none', background: 'var(--ink)', color: '#fff', fontSize: 13.5, fontWeight: 700, cursor: 'pointer' }}>
                {copy.release}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
