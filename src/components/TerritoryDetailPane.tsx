// 구역 카드 상세 패널 (오른쪽).
//
// 받는 것을 좁혔다 — 예전에는 화면 변수 열셋을 그대로 봤다.
// '보일지 말지'(zoneKind·activeTab·detailPaneOpen)는 부모가 판단하고,
// 선택된 카드의 요약 셋은 한 덩이(summary)로 묶었다.
import type { TerritoryCard, VisitHistory } from '../types'
import { useGroupTerritory } from '../features/groupTerritory/context'
import { GroupCardOwners } from '../features/groupTerritory/GroupCardOwners'
import { msg } from '../lib/msg'

export type SelectedCardSummary = {
  /** 중국어 세대 수 */
  chinesePointCount: number
  /** 구역선이 그려져 있나 */
  hasBoundary: boolean
  /** 마지막 방문 기록 (없으면 null) */
  lastVisit: VisitHistory | null
}

type Props = {
  /** 고른 카드. 없으면 '카드를 선택하세요' 를 그린다 */
  card: TerritoryCard | null
  summary: SelectedCardSummary
  isAdmin: boolean
  leaderOptions: string[]
  leadersOf: (card: TerritoryCard) => string[]
  onToggleLeader: (cardId: number, name: string) => void
  onSetCardLeaders: (cardId: number, names: string[]) => void
  formatRelativeDate: (iso: string) => string
}

export function TerritoryDetailPane({
  card: selectedCard, summary, isAdmin, leaderOptions,
  leadersOf: getCardLeaderList, onToggleLeader: toggleCardLeader,
  onSetCardLeaders, formatRelativeDate,
}: Props) {
  const groupTerritory = useGroupTerritory()
  const selectedChinesePointCount = summary.chinesePointCount
  const selectedHasBoundary = summary.hasBoundary
  const selectedLastVisit = summary.lastVisit

  return (
  <aside className="territory-side">
  {!selectedCard ? (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, color: '#94a3b8' }}>
  <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="14" y1="8" x2="19" y2="8"/><line x1="14" y1="12" x2="19" y2="12"/><line x1="14" y1="16" x2="19" y2="16"/>
  </svg>
  <p style={{ fontSize: 13, fontWeight: 600, margin: 0 }}>카드를 선택하세요</p>
    </div>
  ) : (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'auto' }}>

  {/* 헤더 */}
  <div style={{ padding: '18px 20px 14px', borderBottom: '1px solid #f1f5f9' }}>
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
      <div>
        <p style={{ margin: 0, fontSize: 11, fontWeight: 600, color: '#94a3b8', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
          {selectedCard.region} · {selectedCard.area}
        </p>
        <h3 style={{ margin: '4px 0 0', fontSize: 16, fontWeight: 700, color: '#1e293b' }}>{selectedCard.name}</h3>
      </div>
      <span style={{
        fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 6,
        background: selectedCard.status === '완료' ? '#f0fdf4' : selectedCard.status === '진행중' ? '#eff6ff' : '#f8fafc',
        color: selectedCard.status === '완료' ? '#16a34a' : selectedCard.status === '진행중' ? '#2563eb' : '#94a3b8',
        border: `1px solid ${selectedCard.status === '완료' ? '#bbf7d0' : selectedCard.status === '진행중' ? '#bfdbfe' : '#e2e8f0'}`,
        flexShrink: 0,
      }}>{selectedCard.status}</span>
    </div>

    {/* 진행률 바 */}
    <div style={{ marginTop: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#64748b', marginBottom: 5 }}>
        <span>진행률</span>
        <span style={{ fontWeight: 700, color: '#1e293b' }}>{selectedCard.progress}%</span>
      </div>
      <div style={{ height: 5, background: '#f1f5f9', borderRadius: 99, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${selectedCard.progress}%`, background: selectedCard.progress >= 80 ? '#16a34a' : selectedCard.progress >= 40 ? '#2563eb' : '#94a3b8', borderRadius: 99, transition: 'width .3s' }} />
      </div>
    </div>

    {/* 마지막 방문 */}
    <div style={{ marginTop: 14, display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, fontSize: 12 }}>
      <span style={{ color: '#64748b', fontWeight: 600 }}>마지막 방문</span>
      {selectedLastVisit ? (
        <span style={{ color: '#1e293b' }}>
          <strong style={{ fontWeight: 700 }}>{formatRelativeDate(selectedLastVisit.visitedAt)}</strong>
          <span style={{ color: '#94a3b8', marginLeft: 6 }}>· {selectedLastVisit.visitor}</span>
        </span>
      ) : (
        <span style={{ color: '#cbd5e1' }}>아직 없음</span>
      )}
    </div>
  </div>

  {/* 통계 칩 */}
  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, padding: '14px 20px', borderBottom: '1px solid #f1f5f9' }}>
    {[
      { label: '건물', value: `${selectedCard.buildings}개` },
      { label: '세대', value: `${selectedCard.units}개` },
      { label: '완료', value: `${selectedCard.completed}개` },
      { label: '중국어', value: `${selectedChinesePointCount}건`, highlight: selectedChinesePointCount > 0 },
      { label: '정기방문', value: `${selectedCard.regularVisits}건` },
      { label: '구역선', value: selectedHasBoundary ? '있음' : '없음' },
    ].map(({ label, value, highlight }) => (
      <div key={label} style={{ background: '#f8fafc', borderRadius: 8, padding: '8px 12px', border: '1px solid #f1f5f9' }}>
        <div style={{ fontSize: 10, fontWeight: 600, color: '#94a3b8', marginBottom: 2 }}>{label}</div>
        <div style={{ fontSize: 14, fontWeight: 700, color: highlight ? '#dc2626' : '#1e293b' }}>{value}</div>
      </div>
    ))}
  </div>

  {/* 인도자 배정 */}
  <div style={{ padding: '14px 20px', borderBottom: '1px solid #f1f5f9' }}>
    <p style={{ margin: '0 0 10px', fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{groupTerritory.enabled ? msg('집단 구역') : '인도자 배정'}</p>
    {groupTerritory.enabled ? <GroupCardOwners card={selectedCard} readOnly={!isAdmin} /> : isAdmin ? (
      <>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {leaderOptions.map((leaderName) => (
            <label key={leaderName} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#334155', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={getCardLeaderList(selectedCard).includes(leaderName)}
                onChange={() => void toggleCardLeader(selectedCard.id, leaderName)}
                style={{ accentColor: '#2563eb', width: 14, height: 14 }}
              />
              {leaderName}
            </label>
          ))}
        </div>
        {getCardLeaderList(selectedCard).length > 0 && (
          <button
            type="button"
            onClick={() => void onSetCardLeaders(selectedCard.id, [])}
            style={{ marginTop: 10, width: '100%', padding: '7px 0', borderRadius: 8, border: '1px solid #e2e8f0', background: '#fff', fontSize: 12, fontWeight: 600, color: '#94a3b8', cursor: 'pointer' }}
          >인도자 모두 해제</button>
        )}
      </>
    ) : (
      <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: getCardLeaderList(selectedCard).length > 0 ? '#1e293b' : '#94a3b8' }}>
        {getCardLeaderList(selectedCard).length > 0 ? getCardLeaderList(selectedCard).join(', ') : '미배정'}
      </p>
    )}
  </div>

  {/* 배정된 사용자 */}
  <div style={{ padding: '14px 20px', borderBottom: '1px solid #f1f5f9' }}>
    <p style={{ margin: '0 0 10px', fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>배정 사용자</p>
    {selectedCard.assignedUsers.length === 0 ? (
      <p style={{ margin: 0, fontSize: 12, color: '#cbd5e1' }}>아직 없음</p>
    ) : (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {selectedCard.assignedUsers.map((person) => (
          <span key={person} style={{ fontSize: 12, fontWeight: 600, padding: '3px 9px', borderRadius: 99, background: '#f1f5f9', color: '#475569', border: '1px solid #e2e8f0' }}>
            {person}
          </span>
        ))}
      </div>
    )}
  </div>

  {/* 정기방문 포인트 */}
  <div style={{ padding: '14px 20px' }}>
    <p style={{ margin: '0 0 10px', fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>정기방문</p>
    {selectedCard.regularVisitPoints.length === 0 ? (
      <p style={{ margin: 0, fontSize: 12, color: '#cbd5e1' }}>등록된 정기방문 없음</p>
    ) : (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {selectedCard.regularVisitPoints.map((point) => (
          <div key={`${point.point}-${point.visitor}`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 12, padding: '6px 10px', background: '#f8fafc', borderRadius: 8, border: '1px solid #f1f5f9' }}>
            <span style={{ fontWeight: 600, color: '#1e293b' }}>{point.point}</span>
            <span style={{ color: '#64748b' }}>{point.visitor}</span>
          </div>
        ))}
      </div>
    )}
  </div>

    </div>
  )}
  </aside>
  )
}
