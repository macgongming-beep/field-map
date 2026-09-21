import { useMemo, useState } from 'react'
import { showToast } from '../lib/toast'
import type { TerritoryCard } from '../types'
import { isEmptyTerritoryCard, sortTerritoryCardsByOperationalPriority } from '../utils/cardSearch'
import { msg } from '../lib/msg'

function getCardLeaders(card: TerritoryCard) {
  return card.assignedLeaders && card.assignedLeaders.length > 0
    ? card.assignedLeaders
    : card.assignedLeader
      ? [card.assignedLeader]
      : []
}

function AssignmentStatusModal({
  leaders,
  cards,
  onClose,
}: {
  leaders: string[]
  cards: TerritoryCard[]
  onClose: () => void
}) {
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<'name' | 'count'>('name')
  const [expandedLeader, setExpandedLeader] = useState<string | null>(null)

  const leaderStats = useMemo(() => {
    return leaders.map((leader) => {
      const leaderCards = cards.filter((card) => getCardLeaders(card).includes(leader))
      const latestAssignedAt = leaderCards
        .map((card) => card.leaderAssignedAt?.[leader])
        .filter((value): value is string => Boolean(value))
        .sort()
        .at(-1) ?? null
      return { leader, cards: leaderCards, latestAssignedAt }
    })
  }, [cards, leaders])

  const filtered = useMemo(() => {
    const query = search.trim()
    const list = query ? leaderStats.filter((item) => item.leader.includes(query)) : leaderStats
    return [...list].sort((a, b) =>
      sort === 'name'
        ? a.leader.localeCompare(b.leader, 'ko')
        : b.cards.length - a.cards.length,
    )
  }, [leaderStats, search, sort])

  const totalLeaders = leaders.length
  const withCards = leaderStats.filter((item) => item.cards.length > 0).length
  const totalCards = leaderStats.reduce((sum, item) => sum + item.cards.length, 0)
  const formatAssignedDate = (value: string | null) => value
    ? new Date(value).toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\. /g, '.').replace(/\.$/, '')
    : '-'

  return (
    <div className="cal-modal-backdrop" onClick={onClose}>
      <div className="cal-modal lam-status-modal" onClick={(event) => event.stopPropagation()}>
        <div className="cal-modal-head">
          <div className="cal-modal-title"><h2>배정 현황 보기</h2></div>
          <button className="cal-modal-close" onClick={onClose} type="button">x</button>
        </div>
        <div className="cal-modal-body lam-status-body">
          <p className="lam-status-sub">인도자별 담당 구역 현황을 확인할 수 있습니다.</p>
          <div className="lam-stat-row">
            <div className="lam-stat-card"><strong>{totalLeaders}명</strong><span>전체 인도자</span></div>
            <div className="lam-stat-card"><strong>{withCards}명</strong><span>담당 구역 보유 인도자</span></div>
            <div className="lam-stat-card"><strong>{totalCards}개</strong><span>전체 담당 구역</span></div>
          </div>
          <div className="lam-status-toolbar">
            <div className="la-search-wrap" style={{ padding: 0, flex: 1 }}>
              <input className="la-search" placeholder="인도자 검색" value={search} onChange={(event) => setSearch(event.target.value)} />
              <span className="la-search-icon">검색</span>
            </div>
            <select className="la-filter-select" value={sort} onChange={(event) => setSort(event.target.value as 'name' | 'count')}>
              <option value="name">정렬: 인도자 이름순</option>
              <option value="count">정렬: 담당 구역 많은순</option>
            </select>
          </div>
          <div className="lam-status-table">
            <div className="lam-table-head">
              <span>인도자</span>
              <span>담당 구역 수</span>
              <span>담당 구역 목록</span>
              <span>최근 배정일</span>
            </div>
            <div className="lam-table-body">
              {filtered.map(({ leader, cards: leaderCards, latestAssignedAt }) => {
                const isExpanded = expandedLeader === leader
                const shownCards = isExpanded ? leaderCards : leaderCards.slice(0, 3)
                const extra = leaderCards.length - 3
                return (
                  <div className="lam-table-row" key={leader}>
                    <div className="lam-leader-cell">
                      <span className="la-leader-avatar">{leader.slice(0, 1)}</span>
                      <span>{leader}</span>
                    </div>
                    <span className={`lam-count ${leaderCards.length === 0 ? 'zero' : ''}`}>{leaderCards.length}개</span>
                    <div className="lam-cards-cell">
                      {leaderCards.length === 0 ? (
                        <span className="lam-no-card">담당 구역 없음</span>
                      ) : (
                        <>
                          {shownCards.map((card) => <span className="lam-card-tag" key={card.id}>{card.name}</span>)}
                          {!isExpanded && extra > 0 && (
                            <button className="lam-more-btn" onClick={() => setExpandedLeader(leader)} type="button">+{extra}</button>
                          )}
                          {isExpanded && (
                            <button className="lam-more-btn" onClick={() => setExpandedLeader(null)} type="button">접기</button>
                          )}
                        </>
                      )}
                    </div>
                    <span className="lam-date">{formatAssignedDate(latestAssignedAt)}</span>
                  </div>
                )
              })}
            </div>
          </div>
          <div className="lam-info-box">
            <span>안내</span>
            <ul>
              <li>담당 구역 목록은 최대 3개까지 표시되며, +숫자를 클릭하면 전체 목록을 확인할 수 있습니다.</li>
              <li>최근 배정일은 현재 담당 구역 가운데 가장 늦게 배정된 날짜입니다.</li>
            </ul>
          </div>
        </div>
        <div className="cal-modal-foot" style={{ justifyContent: 'flex-end' }}>
          <button className="cal-cancel-btn" onClick={onClose} type="button">닫기</button>
        </div>
      </div>
    </div>
  )
}

export function DesktopAdminAssignment({
  cards: rawCards,
  currentVisitor,
  leaderNames = [],
  onSetCardLeaders,
}: {
  cards: TerritoryCard[]
  currentVisitor: string
  leaderNames?: string[]
  onSetCardLeaders: (cardId: number, leaders: string[], options?: { silentSuccess?: boolean }) => Promise<void> | void
}) {
  // 담당자 이름 정제: 현재 존재하는 인도자/관리자(leaderNames)만 남김.
  // → 삭제·개명된 계정 잔재와 개발자 계정(leaderNames 에 원래 미포함)이 배정 탭에서 사라짐.
  const cards = useMemo(() => {
    if (leaderNames.length === 0) return rawCards
    const valid = new Set(leaderNames)
    return rawCards.map((card) => {
      const filtered = getCardLeaders(card).filter((name) => valid.has(name))
      if (filtered.length === getCardLeaders(card).length) return card
      return { ...card, assignedLeaders: filtered, assignedLeader: filtered[0] ?? null }
    })
  }, [rawCards, leaderNames])
  const [leaderSearch, setLeaderSearch] = useState('')
  const [selectedLeader, setSelectedLeader] = useState<string | null>(null)
  const [cardQuery, setCardQuery] = useState('')
  const [regionFilter, setRegionFilter] = useState('전체')
  const [statusFilter, setStatusFilter] = useState('전체')
  const [selectMode, setSelectMode] = useState(false)
  const [selectedCardIds, setSelectedCardIds] = useState<Set<number>>(new Set())
  const [bulkWorking, setBulkWorking] = useState<'assign' | 'release' | null>(null)
  const [releasing, setReleasing] = useState<number | null>(null)
  const [showStatusModal, setShowStatusModal] = useState(false)

  const leaders = useMemo(() => {
    const names = leaderNames.length > 0
      ? leaderNames
      : Array.from(new Set(cards.flatMap((card) => getCardLeaders(card))))
    return names.sort((a, b) => a.localeCompare(b, 'ko'))
  }, [cards, leaderNames])

  const filteredLeaders = useMemo(
    () => leaders.filter((leader) => leader.includes(leaderSearch.trim())),
    [leaderSearch, leaders],
  )

  const getLeaderCardCount = (leader: string) =>
    cards.filter((card) => getCardLeaders(card).includes(leader)).length

  const leaderCards = useMemo(() => {
    if (!selectedLeader) return []
    return cards.filter((card) => getCardLeaders(card).includes(selectedLeader))
  }, [cards, selectedLeader])

  const regions = useMemo(
    () => Array.from(new Set(cards.map((card) => card.region))).sort((a, b) => a.localeCompare(b, 'ko')),
    [cards],
  )

  const filteredCards = useMemo(() => {
    const query = cardQuery.trim().toLowerCase()
    return sortTerritoryCardsByOperationalPriority(
      cards.filter((card) => {
        if (isEmptyTerritoryCard(card)) return false
        const leadersForCard = getCardLeaders(card)
        if (regionFilter !== '전체' && card.region !== regionFilter) return false
        if (statusFilter === '미배정' && leadersForCard.length > 0) return false
        if (statusFilter === '배정됨' && leadersForCard.length === 0) return false
        if (!query) return true
        return `${card.name} ${card.region} ${card.area}`.toLowerCase().includes(query)
      }),
    )
  }, [cardQuery, cards, regionFilter, statusFilter])

  const unassignedCount = useMemo(
    () => cards.filter((card) => !isEmptyTerritoryCard(card) && getCardLeaders(card).length === 0).length,
    [cards],
  )

  const allFilteredSelected = filteredCards.length > 0
    && filteredCards.every((card) => selectedCardIds.has(card.id))
  const selectedCards = useMemo(
    () => cards.filter((card) => selectedCardIds.has(card.id)),
    [cards, selectedCardIds],
  )
  const selectedAssignableCount = selectedLeader
    ? selectedCards.filter((card) => !getCardLeaders(card).includes(selectedLeader)).length
    : 0
  const selectedReleasableCount = selectedLeader
    ? selectedCards.filter((card) => getCardLeaders(card).includes(selectedLeader)).length
    : 0

  const toggleSelectCard = (id: number) => {
    setSelectedCardIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleSelectAll = () => {
    setSelectedCardIds(allFilteredSelected ? new Set() : new Set(filteredCards.map((card) => card.id)))
  }

  const handleRelease = async (card: TerritoryCard) => {
    if (!selectedLeader) return
    setReleasing(card.id)
    const nextLeaders = getCardLeaders(card).filter((leader) => leader !== selectedLeader)
    await Promise.resolve(onSetCardLeaders(card.id, nextLeaders, { silentSuccess: true }))
    showToast(msg('{name} 배정을 해제했습니다.', { name: card.name }))
    setReleasing(null)
  }

  const handleAssignCard = async (card: TerritoryCard) => {
    if (!selectedLeader) {
      showToast(msg('인도자를 먼저 선택하세요.'), 'info')
      return
    }
    const currentLeaders = getCardLeaders(card)
    if (currentLeaders.includes(selectedLeader)) {
      showToast(msg('이미 배정된 카드입니다.'), 'info')
      return
    }
    await Promise.resolve(onSetCardLeaders(card.id, [...currentLeaders, selectedLeader], { silentSuccess: true }))
    showToast(msg('{name} -> {selectedLeader} 배정 완료', { name: card.name, selectedLeader: selectedLeader }))
  }

  const handleBulkAssign = async () => {
    if (!selectedLeader || selectedCardIds.size === 0) return
    const targets = selectedCards.filter((card) => !getCardLeaders(card).includes(selectedLeader))
    if (targets.length === 0) return
    setBulkWorking('assign')
    try {
      await Promise.all(targets.map((card) => Promise.resolve(onSetCardLeaders(
        card.id,
        [...getCardLeaders(card), selectedLeader],
        { silentSuccess: true },
      ))))
      showToast(msg('{length}개 카드를 {selectedLeader}님께 배정했습니다.', { length: targets.length, selectedLeader: selectedLeader }))
      setSelectedCardIds(new Set())
      setSelectMode(false)
    } finally {
      setBulkWorking(null)
    }
  }

  const handleBulkRelease = async () => {
    if (!selectedLeader || selectedCardIds.size === 0) return
    const targets = selectedCards.filter((card) => getCardLeaders(card).includes(selectedLeader))
    if (targets.length === 0) return
    setBulkWorking('release')
    try {
      await Promise.all(targets.map((card) => Promise.resolve(onSetCardLeaders(
        card.id,
        getCardLeaders(card).filter((leader) => leader !== selectedLeader),
        { silentSuccess: true },
      ))))
      showToast(msg('{length}개 카드에서 {selectedLeader}님의 배정을 해제했습니다.', { length: targets.length, selectedLeader: selectedLeader }))
      setSelectedCardIds(new Set())
      setSelectMode(false)
    } finally {
      setBulkWorking(null)
    }
  }

  return (
    <section className="la-page">
      <header className="page-header">
        <div className="page-header-text">
          <h1 className="page-header-title">관리자 배정</h1>
          <p className="page-header-subtitle">전체 카드 {cards.length}개 · 미배정 {unassignedCount}개</p>
        </div>
        <div className="page-header-actions">
          <button className="la-header-btn" type="button" onClick={() => setShowStatusModal(true)}>배정 현황 보기</button>
          <span className="la-badge-red">미배정 {unassignedCount}개</span>
        </div>
      </header>

      <div className="la-grid">
        <aside className="la-col la-col-leaders">
          <div className="la-col-head"><h2>1. 인도자 선택</h2></div>
          <div className="la-search-wrap">
            <input className="la-search" placeholder="인도자 검색" value={leaderSearch} onChange={(event) => setLeaderSearch(event.target.value)} />
            <span className="la-search-icon">검색</span>
          </div>
          <div className="la-leader-list">
            {filteredLeaders.length === 0 && <p className="la-empty-msg">인도자가 없습니다</p>}
            {filteredLeaders.map((leader) => (
              <button
                className={`la-leader-row ${selectedLeader === leader ? 'active' : ''}`}
                key={leader}
                onClick={() => setSelectedLeader(leader)}
                type="button"
              >
                <span className="la-leader-avatar">{leader.slice(0, 1)}</span>
                <span className="la-leader-name">{leader}</span>
                <span className={`la-leader-count ${getLeaderCardCount(leader) === 0 ? 'zero' : ''}`}>
                  담당 구역 {getLeaderCardCount(leader)}개
                </span>
              </button>
            ))}
          </div>
          <button className="la-add-leader-btn" type="button" onClick={() => showToast(msg('사용자 탭에서 인도자를 추가하세요.'), 'info')}>
            + 인도자 추가
          </button>
        </aside>

        <div className="la-col la-col-assigned">
          <div className="la-col-head">
            <h2>{selectedLeader ? `${selectedLeader} 님의 담당 구역` : '인도자를 선택하세요'}</h2>
            {selectedLeader && <span className="la-count-badge">총 {leaderCards.length}개</span>}
          </div>
          {!selectedLeader ? (
            <div className="la-empty-panel"><p>왼쪽에서 인도자를 선택하면<br />담당 구역 목록이 표시됩니다.</p></div>
          ) : leaderCards.length === 0 ? (
            <div className="la-empty-panel"><p>담당 구역이 없습니다.<br />오른쪽 목록에서 카드를 배정하세요.</p></div>
          ) : (
            <div className="la-assigned-list">
              {leaderCards.map((card) => (
                <div className="la-assigned-card" key={card.id}>
                  <div className="la-assigned-info">
                    <strong>{card.name}</strong>
                    <span>{card.region} / {card.area}</span>
                  </div>
                  <button className="la-release-btn" disabled={releasing === card.id} onClick={() => void handleRelease(card)} type="button">
                    {releasing === card.id ? '...' : '해제'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="la-col la-col-all">
          <div className="la-col-head la-col-head-right">
            <h2>3. 전체 구역 목록</h2>
            <div className="la-col-head-actions">
              <button className={`la-select-mode-btn ${selectMode ? 'active' : ''}`} onClick={() => { setSelectMode((value) => !value); setSelectedCardIds(new Set()) }} type="button">
                {selectMode ? '선택 모드' : '선택 모드'}
              </button>
              {selectMode && <button className="la-select-all-btn" onClick={toggleSelectAll} type="button">{allFilteredSelected ? '전체 선택 해제' : '전체 선택'}</button>}
            </div>
          </div>

          {selectMode && selectedCardIds.size > 0 && (
            <div className="la-selection-bar">
              <span>{selectedCardIds.size}개 선택됨</span>
              <button onClick={() => setSelectedCardIds(new Set())} type="button">선택 해제</button>
              <button className="la-bulk-release-btn" disabled={!selectedLeader || selectedReleasableCount === 0 || bulkWorking !== null} onClick={() => void handleBulkRelease()} type="button">
                {bulkWorking === 'release' ? '해제 중...' : selectedLeader ? `${selectedLeader} 일괄 해제` : '인도자 먼저 선택'}
              </button>
              <button className="la-bulk-assign-btn" disabled={!selectedLeader || selectedAssignableCount === 0 || bulkWorking !== null} onClick={() => void handleBulkAssign()} type="button">
                {bulkWorking === 'assign' ? '배정 중...' : selectedLeader ? `${selectedLeader}에게 일괄 배정` : '인도자 먼저 선택'}
              </button>
            </div>
          )}

          <div className="la-filters">
            <div className="la-search-wrap">
              <input className="la-search" placeholder="구역명 검색" value={cardQuery} onChange={(event) => setCardQuery(event.target.value)} />
              <span className="la-search-icon">검색</span>
            </div>
            <select className="la-filter-select" value={regionFilter} onChange={(event) => setRegionFilter(event.target.value)}>
              <option value="전체">전체 지역</option>
              {regions.map((region) => <option key={region} value={region}>{region}</option>)}
            </select>
            <select className="la-filter-select" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="전체">전체 상태</option>
              <option value="미배정">미배정</option>
              <option value="배정됨">배정됨</option>
            </select>
          </div>

          <p className="la-total-label">총 {filteredCards.length}개 구역</p>

          <div className="la-card-list">
            {filteredCards.map((card) => {
              const leadersForCard = getCardLeaders(card)
              const displayedLeaders = selectedLeader && leadersForCard.includes(selectedLeader)
                ? [selectedLeader, ...leadersForCard.filter((leader) => leader !== selectedLeader)].slice(0, 2)
                : leadersForCard.slice(0, 2)
              const isSelected = selectedCardIds.has(card.id)
              return (
                <div className={`la-card-row${selectMode ? ' selecting' : ''}${isSelected ? ' selected' : ''}`} key={card.id} onClick={() => selectMode && toggleSelectCard(card.id)}>
                  {selectMode && (
                    <input className="la-card-check" type="checkbox" checked={isSelected} onChange={() => toggleSelectCard(card.id)} onClick={(event) => event.stopPropagation()} />
                  )}
                  <div className="la-card-info">
                    <strong>{card.name}</strong>
                    <span>{card.region} / {card.area}</span>
                  </div>
                  <div className="la-card-meta">
                    <div className="la-assignee-summary" title={leadersForCard.join(', ')}>
                      {leadersForCard.length > 0 ? (
                        <>
                          {displayedLeaders.map((leader) => (
                            <span className={`la-assignee-badge ${leader === currentVisitor ? 'mine' : ''}`} key={leader}>{leader}</span>
                          ))}
                          {leadersForCard.length > 2 && <span className="la-assignee-more">+{leadersForCard.length - 2}명</span>}
                        </>
                      ) : (
                        <span className="la-assignee-badge unassigned">미배정</span>
                      )}
                    </div>
                    <button
                      className={`la-detail-btn${leadersForCard.includes(selectedLeader ?? '') ? ' release' : ''}`}
                      disabled={releasing === card.id}
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation()
                        if (leadersForCard.includes(selectedLeader ?? '')) void handleRelease(card)
                        else void handleAssignCard(card)
                      }}
                    >
                      {releasing === card.id ? '...' : leadersForCard.includes(selectedLeader ?? '') ? '해제' : '배정'}
                    </button>
                  </div>
                </div>
              )
            })}
            {filteredCards.length === 0 && <div className="la-empty-panel"><p>조건에 맞는 카드가 없습니다</p></div>}
          </div>
        </div>
      </div>

      {showStatusModal && (
        <AssignmentStatusModal leaders={leaders} cards={cards} onClose={() => setShowStatusModal(false)} />
      )}
    </section>
  )
}
