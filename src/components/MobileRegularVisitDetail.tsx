// 정기방문 상세 화면 (풀스크린).
// 디자인 핸드오프 대기 — 톤/간격/위계는 디자이너가 정리할 예정.
// 기능/플로우는 살아있게 미리 구성.

import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import type { AppLanguage } from '../i18n'
import { t } from '../i18n'
import type { Building, EndReturnVisitInput, ReturnVisit, ReturnVisitLog } from '../types'
import { formatRelativeVisitDate } from '../utils/returnVisits'
import { confirmDialog } from '../lib/confirm'
import { msg } from '../lib/msg'
import { EndReturnVisitDialog } from './EndReturnVisitDialog'
import { useReturnVisitLogDetails } from '../hooks/useReturnVisitLogDetails'
import { ReturnVisitLogReadStatus } from './ReturnVisitLogReadStatus'

type Props = {
  language: AppLanguage
  returnVisits: ReturnVisit[]
  returnVisitLogs: ReturnVisitLog[]
  buildings: Building[]
  currentVisitor: string
  onAddReturnVisitLog?: (returnVisitId: number, result: '만남' | '부재' | null, memo: string) => Promise<void>
  onUpdateReturnVisitLog?: (id: number, result: '만남' | '부재' | null, memo: string) => Promise<void>
  onDeleteReturnVisitLog?: (id: number) => Promise<void>
  onDeleteReturnVisit?: (id: number, input: EndReturnVisitInput) => Promise<boolean>
  onUpdateReturnVisitNickname?: (id: number, nickname: string) => Promise<void>
  onUpdateReturnVisitAddress?: (id: number, address: string) => Promise<void>
}

function fmtFullDate(value: string, language: AppLanguage) {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  const m = d.getMonth() + 1
  const day = d.getDate()
  if (language === 'zh') return `${d.getFullYear()}年${m}月${day}日`
  if (language === 'en') return `${d.toLocaleString('en-US', { month: 'short' })} ${day}, ${d.getFullYear()}`
  const dow = ['일', '월', '화', '수', '목', '금', '토'][d.getDay()]
  return `${d.getFullYear()}년 ${m}월 ${day}일 (${dow})`
}

export function MobileRegularVisitDetail({
  language = 'ko',
  returnVisits,
  returnVisitLogs,
  buildings,
  currentVisitor,
  onAddReturnVisitLog,
  onUpdateReturnVisitLog,
  onDeleteReturnVisitLog,
  onDeleteReturnVisit,
  onUpdateReturnVisitNickname,
  onUpdateReturnVisitAddress,
}: Props) {
  void currentVisitor
  const navigate = useNavigate()
  const { id } = useParams()
  const rvId = Number(id)
  const rv = returnVisits.find((item) => item.id === rvId)
  const logDetails = useReturnVisitLogDetails(rv?.id ?? null, returnVisitLogs)

  const [logResult, setLogResult] = useState<'만남' | '부재' | null>(null)
  const [logMemo, setLogMemo] = useState('')
  const [logSaving, setLogSaving] = useState(false)
  // 26b — 빠른 기록 시트
  const [showQuickLog, setShowQuickLog] = useState(false)
  const [editingLogId, setEditingLogId] = useState<number | null>(null)
  const [editLogResult, setEditLogResult] = useState<'만남' | '부재' | null>(null)
  const [editLogMemo, setEditLogMemo] = useState('')
  const [nicknameOpen, setNicknameOpen] = useState(false)
  const [nicknameValue, setNicknameValue] = useState('')
  const [addressOpen, setAddressOpen] = useState(false)
  const [addressValue, setAddressValue] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const [endOpen, setEndOpen] = useState(false)

  const myLogs = useMemo(() => {
    if (!rv) return []
    return logDetails.logs
      .filter((log) => log.returnVisitId === rv.id)
      .sort((a, b) => new Date(b.visitedAt).getTime() - new Date(a.visitedAt).getTime())
  }, [rv, logDetails.logs])

  const latestVisit = useMemo(() => {
    if (!rv) return null
    const candidates = [
      rv.lastVisitedAt,
      ...returnVisitLogs.filter((log) => log.returnVisitId === rv.id).map((log) => log.visitedAt),
    ].filter((value): value is string => !!value)
    candidates.sort((a, b) => new Date(b).getTime() - new Date(a).getTime())
    return candidates[0] ?? null
  }, [rv, returnVisitLogs])

  // 추론: 평균 방문 간격 (3건 이상일 때만)
  const avgIntervalDays = useMemo(() => {
    if (myLogs.length < 3) return null
    const sorted = [...myLogs].sort((a, b) => new Date(a.visitedAt).getTime() - new Date(b.visitedAt).getTime())
    const intervals: number[] = []
    for (let i = 1; i < sorted.length; i += 1) {
      const diff = (new Date(sorted[i].visitedAt).getTime() - new Date(sorted[i - 1].visitedAt).getTime()) / 86_400_000
      if (diff > 0) intervals.push(diff)
    }
    if (intervals.length === 0) return null
    return Math.round(intervals.reduce((a, b) => a + b, 0) / intervals.length)
  }, [myLogs])

  if (!rv) {
    return (
      <main className="mobile-rv-detail-shell">
        <header className="mobile-rv-detail-header">
          <button className="mobile-rv-back-btn" onClick={() => navigate(-1)} type="button" aria-label={msg('뒤로')}>‹</button>
          <h1>{t(language, 'territory.regularVisit')}</h1>
        </header>
        <div className="mobile-rv-detail-empty">
          <p>{t(language, 'territory.notFound')}</p>
          <button type="button" onClick={() => navigate('/territory?section=regular')}>
            {t(language, 'territory.backToList')}
          </button>
        </div>
      </main>
    )
  }

  const label = rv.nickname || rv.displayName
  const building = buildings.find((b) => b.id === rv.buildingId)
  const lastVisitLabel = latestVisit ? formatRelativeVisitDate(latestVisit, language) : t(language, 'home.noVisitYet')

  const handleAddLog = async () => {
    if (!onAddReturnVisitLog) return
    if (!logResult && !logMemo.trim()) return
    setLogSaving(true)
    try {
      await onAddReturnVisitLog(rv.id, logResult, logMemo.trim())
      setLogResult(null)
      setLogMemo('')
      setShowQuickLog(false)
    } finally {
      setLogSaving(false)
    }
  }

  const handleSaveEditLog = async (logId: number) => {
    if (!onUpdateReturnVisitLog) return
    setLogSaving(true)
    try {
      await onUpdateReturnVisitLog(logId, editLogResult, editLogMemo.trim())
      setEditingLogId(null)
    } finally {
      setLogSaving(false)
    }
  }

  const handleDeleteLog = async (logId: number) => {
    if (!onDeleteReturnVisitLog) return
    if (!(await confirmDialog({ message: t(language, 'territory.deleteLogConfirm'), danger: true, confirmLabel: msg('삭제') }))) return
    await onDeleteReturnVisitLog(logId)
  }

  const handleEndRv = () => {
    if (onDeleteReturnVisit) setEndOpen(true)
  }

  const handleOpenMap = () => {
    if (building) {
      navigate(`/map?cardId=${building.cardId}`)
      return
    }
    if (rv.address) {
      navigate(`/map?addr=${encodeURIComponent(rv.address)}&pinLabel=${encodeURIComponent(label)}`)
    }
  }

  return (
    <main className="mobile-rv-detail-shell">
      {/* 헤더 */}
      <header className="mobile-rv-detail-header">
        <button className="mobile-rv-back-btn" onClick={() => navigate(-1)} type="button" aria-label={msg('뒤로')}>‹</button>
        <h1>{t(language, 'territory.regularVisit')}</h1>
        <div className="mobile-rv-header-menu">
          <button type="button" onClick={() => setMenuOpen((v) => !v)} aria-label={msg('더보기')}>⋮</button>
          {menuOpen && (
            <>
              <div onClick={() => setMenuOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 30 }} />
              <div className="mobile-rv-menu-dropdown">
                <button type="button" onClick={() => { setMenuOpen(false); setNicknameOpen(true); setNicknameValue(rv.nickname || rv.displayName) }}>
                  {t(language, 'territory.editNickname')}
                </button>
                <button type="button" onClick={() => { setMenuOpen(false); setAddressOpen(true); setAddressValue(rv.address) }}>
                  {t(language, 'territory.editAddress')}
                </button>
                <button type="button" className="danger" onClick={() => { setMenuOpen(false); handleEndRv() }}>
                  {msg('정기방문 종료')}
                </button>
              </div>
            </>
          )}
        </div>
      </header>

      {/* 본문 */}
      <div className="mobile-rv-detail-body">
        {/* Title block — 디자인 26 */}
        <section className="mobile-rv-title-block">
          <h1 className="mobile-rv-title">{label}</h1>
          {rv.address && <p className="mobile-rv-title-addr">{rv.address}</p>}
          <p className="mobile-rv-title-last">
            {t(language, 'territory.lastVisitPrefix')} {lastVisitLabel}
          </p>
        </section>

        {/* 단일 액션 — + 기록 solid / 지도 ghost */}
        <div className="mobile-rv-actions-v2">
          <button
            type="button"
            className="mobile-rv-act-primary"
            onClick={() => { setLogResult(null); setLogMemo(''); setShowQuickLog(true) }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            {t(language, 'territory.record')}
          </button>
          {(building || rv.address) && (
            <button type="button" className="mobile-rv-act-ghost" onClick={handleOpenMap}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden><polygon points="3 7 9 4 15 7 21 4 21 17 15 20 9 17 3 20"/><line x1="9" y1="4" x2="9" y2="17"/><line x1="15" y1="7" x2="15" y2="20"/></svg>
              {t(language, 'rv.map')}
            </button>
          )}
        </div>

        {/* 다음 방문 권장 (옵션) */}
        {avgIntervalDays && (
          <section className="mobile-rv-card mobile-rv-insight">
            <p>
              <b>{t(language, 'territory.avgInterval', { days: avgIntervalDays })}</b>
              {latestVisit && (() => {
                const lastTime = new Date(latestVisit).getTime()
                const nextTime = lastTime + avgIntervalDays * 86_400_000
                const d = new Date(nextTime)
                const m = d.getMonth() + 1
                const day = d.getDate()
                return ` · ${t(language, 'territory.nextRecommend', { date: `${m}/${day}` })}`
              })()}
            </p>
          </section>
        )}

        {/* 히스토리 */}
        <section className="mobile-rv-history">
          <h3 className="mobile-rv-section-title">
            {t(language, 'rv.records')} <span className="rv-count">{logDetails.loading || logDetails.error ? returnVisitLogs.filter((log) => log.returnVisitId === rv.id).length : myLogs.length}{t(language, 'territory.visitCountSuffix')}</span>
          </h3>
          <ReturnVisitLogReadStatus {...logDetails} />
          {logDetails.loading || logDetails.error ? null : myLogs.length === 0 ? (
            <p className="mobile-rv-history-empty">{language === 'ko' ? '아직 기록이 없습니다.' : language === 'zh' ? '暂无记录。' : 'No records yet.'}</p>
          ) : (
            <ul className="mobile-rv-history-list">
              {myLogs.map((log) => {
                const isEdit = editingLogId === log.id
                return (
                  <li key={log.id} className="mobile-rv-history-item">
                    <div className="mobile-rv-history-row1">
                      <span className="mobile-rv-history-date">{fmtFullDate(log.visitedAt, language)}</span>
                      {!isEdit && log.result && (
                        <span className={`mobile-rv-result-chip is-${log.result === '만남' ? 'met' : 'absent'}`}>
                          {log.result === '만남' ? t(language, 'rv.meet') : t(language, 'rv.absent')}
                        </span>
                      )}
                      <span className="mobile-rv-history-actions">
                        {!isEdit && onUpdateReturnVisitLog && (
                          <button type="button" onClick={() => { setEditingLogId(log.id); setEditLogResult(log.result); setEditLogMemo(log.memo) }}>
                            {t(language, 'common.edit')}
                          </button>
                        )}
                        {!isEdit && onDeleteReturnVisitLog && (
                          <button type="button" className="danger" onClick={() => handleDeleteLog(log.id)}>
                            {t(language, 'common.delete')}
                          </button>
                        )}
                      </span>
                    </div>
                    {isEdit ? (
                      <div className="mobile-rv-history-edit">
                        <div className="mobile-rv-result-toggle">
                          <button type="button" className={editLogResult === '만남' ? 'is-active' : ''} onClick={() => setEditLogResult((prev) => prev === '만남' ? null : '만남')}>{language === 'ko' ? '만남' : language === 'zh' ? '见面' : 'Met'}</button>
                          <button type="button" className={editLogResult === '부재' ? 'is-active' : ''} onClick={() => setEditLogResult((prev) => prev === '부재' ? null : '부재')}>{language === 'ko' ? '부재' : language === 'zh' ? '不在' : 'Absent'}</button>
                        </div>
                        <textarea
                          className="mobile-rv-memo-input"
                          value={editLogMemo}
                          onChange={(e) => setEditLogMemo(e.target.value)}
                          rows={2}
                        />
                        <div className="mobile-rv-history-edit-actions">
                          <button type="button" onClick={() => setEditingLogId(null)}>{t(language, 'common.cancel')}</button>
                          <button type="button" disabled={logSaving} onClick={() => handleSaveEditLog(log.id)}>
                            {logSaving ? '…' : t(language, 'common.save')}
                          </button>
                        </div>
                      </div>
                    ) : (
                      log.memo && <p className="mobile-rv-history-memo">{log.memo}</p>
                    )}
                    {log.createdBy && !isEdit && (
                      <p className="mobile-rv-history-author">{log.createdBy}</p>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      </div>

      {/* 별칭 편집 모달 */}
      {nicknameOpen && (
        <div className="mobile-rv-modal-backdrop" onClick={() => setNicknameOpen(false)}>
          <div className="mobile-rv-modal" onClick={(e) => e.stopPropagation()}>
            <h3>{t(language, 'territory.editNickname')}</h3>
            <input
              type="text"
              value={nicknameValue}
              onChange={(e) => setNicknameValue(e.target.value)}
              placeholder={rv.displayName}
              autoFocus
            />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => setNicknameOpen(false)}>{t(language, 'common.cancel')}</button>
              <button
                type="button"
                onClick={async () => {
                  if (!onUpdateReturnVisitNickname) return
                  await onUpdateReturnVisitNickname(rv.id, nicknameValue)
                  setNicknameOpen(false)
                }}
              >
                {t(language, 'common.save')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 주소 편집 모달 */}
      {addressOpen && (
        <div className="mobile-rv-modal-backdrop" onClick={() => setAddressOpen(false)}>
          <div className="mobile-rv-modal" onClick={(e) => e.stopPropagation()}>
            <h3>{t(language, 'territory.editAddress')}</h3>
            <input
              type="text"
              value={addressValue}
              onChange={(e) => setAddressValue(e.target.value)}
              placeholder={t(language, 'territory.addressPlaceholderShort')}
              autoFocus
            />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => setAddressOpen(false)}>{t(language, 'common.cancel')}</button>
              <button
                type="button"
                onClick={async () => {
                  if (!onUpdateReturnVisitAddress) return
                  await onUpdateReturnVisitAddress(rv.id, addressValue)
                  setAddressOpen(false)
                }}
              >
                {t(language, 'common.save')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 26b — 빠른 기록 시트 */}
      {showQuickLog && (() => {
        const todayD = new Date()
        const dows = language === 'zh'
          ? ['日', '一', '二', '三', '四', '五', '六']
          : language === 'en'
          ? ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
          : ['일', '월', '화', '수', '목', '금', '토']
        const dow = dows[todayD.getDay()]
        const m = todayD.getMonth() + 1
        const d = todayD.getDate()
        const dateLabel = language === 'zh'
          ? `${m}月${d}日 (${dow})`
          : language === 'en'
          ? `${todayD.toLocaleString('en-US', { month: 'short' })} ${d} (${dow})`
          : `${m}월 ${d}일 (${dow})`
        return (
          <div className="rv-sheet-backdrop" onClick={() => setShowQuickLog(false)}>
            <div className="rv-sheet" onClick={(e) => e.stopPropagation()}>
              <div className="rv-sheet-grabber" />
              <div className="rv-sheet-title-row">
                <div className="rv-sheet-title-col">
                  <span className="rv-sheet-title">{label}</span>
                  {rv.address && <span className="rv-sheet-sub">{rv.address}</span>}
                </div>
                <button
                  type="button"
                  className="rv-sheet-close"
                  onClick={() => setShowQuickLog(false)}
                  aria-label={msg('닫기')}
                >×</button>
              </div>
              <div className="rv-sheet-divider" />
              <div className="rv-sheet-meta-row">
                <span className="rv-sheet-date">{dateLabel}</span>
                <div className="rv-sheet-chips">
                  <button
                    type="button"
                    className={`rv-sheet-chip${logResult === '만남' ? ' is-active' : ''}`}
                    onClick={() => setLogResult((prev) => prev === '만남' ? null : '만남')}
                  >{language === 'ko' ? '만남' : language === 'zh' ? '见面' : 'Met'}</button>
                  <button
                    type="button"
                    className={`rv-sheet-chip${logResult === '부재' ? ' is-active' : ''}`}
                    onClick={() => setLogResult((prev) => prev === '부재' ? null : '부재')}
                  >{language === 'ko' ? '부재' : language === 'zh' ? '不在' : 'Absent'}</button>
                </div>
              </div>
              <textarea
                className="rv-sheet-memo"
                value={logMemo}
                onChange={(e) => setLogMemo(e.target.value)}
                placeholder={language === "ko" ? "메모 (선택)" : language === "zh" ? "备注（选填）" : "Memo (optional)"}
                rows={3}
              />
              <div className="rv-sheet-actions">
                <button type="button" className="rv-sheet-btn rv-sheet-btn-ghost" onClick={() => setShowQuickLog(false)}>
                  {t(language, 'common.cancel')}
                </button>
                <button
                  type="button"
                  className="rv-sheet-btn rv-sheet-btn-solid"
                  disabled={logSaving || (!logResult && !logMemo.trim())}
                  onClick={handleAddLog}
                >
                  {logSaving ? '…' : t(language, 'common.save')}
                </button>
              </div>
            </div>
          </div>
        )
      })()}
      {endOpen && onDeleteReturnVisit && (
        <EndReturnVisitDialog
          visit={rv}
          onClose={() => setEndOpen(false)}
          onSubmit={async (input) => {
            const ok = await onDeleteReturnVisit(rv.id, input)
            if (ok) navigate('/territory?section=regular')
            return ok
          }}
        />
      )}
    </main>
  )
}
