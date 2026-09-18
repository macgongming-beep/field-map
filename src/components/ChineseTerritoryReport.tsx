import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { showToast } from '../lib/toast'
import {
  createChineseTerritoryReportShare,
  listChineseTerritoryReportShares,
  previewChineseTerritoryReport,
  revokeChineseTerritoryReportShare,
} from '../lib/territoryReport'
import type { ChineseTerritoryReportSnapshot, TerritoryReportShare } from '../types/territoryReport'
import { TerritoryReportView } from './TerritoryReportView'

const localDate = (date: Date) => {
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 10)
}

export function ChineseTerritoryReport() {
  const navigate = useNavigate()
  const defaults = useMemo(() => {
    const end = new Date()
    const start = new Date(end)
    start.setMonth(start.getMonth() - 6)
    return { start: localDate(start), end: localDate(end) }
  }, [])
  const [start, setStart] = useState(defaults.start)
  const [end, setEnd] = useState(defaults.end)
  const [note, setNote] = useState('중국어 세대의 지역별 분포와 최근 관리 현황을 집계한 보고서입니다.')
  const [snapshot, setSnapshot] = useState<ChineseTerritoryReportSnapshot | null>(null)
  const [shares, setShares] = useState<TerritoryReportShare[]>([])
  const [loading, setLoading] = useState(true)
  const [shareOpen, setShareOpen] = useState(false)
  const [expiresInDays, setExpiresInDays] = useState(14)
  const [usePin, setUsePin] = useState(false)
  const [pin, setPin] = useState('')
  const [createdLink, setCreatedLink] = useState('')

  const refreshShares = useCallback(async () => {
    try { setShares(await listChineseTerritoryReportShares()) } catch { setShares([]) }
  }, [])

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      setSnapshot(await previewChineseTerritoryReport(start, end, note))
    } catch (error) {
      showToast(error instanceof Error ? error.message : '보고서를 불러오지 못했습니다.', 'error')
    } finally {
      setLoading(false)
    }
  }, [start, end, note])

  useEffect(() => { void refresh(); void refreshShares() }, [refresh, refreshShares])

  const createShare = async () => {
    if (usePin && !/^\d{6}$/.test(pin)) {
      showToast('암호는 숫자 6자리로 입력해 주세요.', 'error')
      return
    }
    const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString()
    try {
      const result = await createChineseTerritoryReportShare({ start, end, note, expiresAt, pin: usePin ? pin : undefined })
      const link = `${window.location.origin}/shared/territory-report/${result.shareToken}`
      setCreatedLink(link)
      await navigator.clipboard?.writeText(link)
      showToast('공유 링크를 만들고 복사했습니다.', 'success')
      void refreshShares()
    } catch (error) {
      showToast(error instanceof Error ? error.message : '공유 링크를 만들지 못했습니다.', 'error')
    }
  }

  const copyLink = async () => {
    await navigator.clipboard.writeText(createdLink)
    showToast('링크를 복사했습니다.', 'success')
  }

  return (
    <main className="territory-report-page">
      <div className="territory-report-toolbar no-print">
        <button className="icon-button" type="button" onClick={() => navigate('/stats')} aria-label="통계로 돌아가기">‹</button>
        <div><h1>구역 관리 보고서</h1><p>순회 방문 보고와 내부 관리에 사용할 집계 자료입니다.</p></div>
        <div className="territory-report-toolbar-actions">
          <button type="button" className="secondary-button" onClick={() => window.print()} disabled={!snapshot}>PDF 인쇄</button>
          <button type="button" className="primary-button" onClick={() => setShareOpen(v => !v)}>공유 링크</button>
        </div>
      </div>

      <section className="territory-report-controls no-print">
        <label>시작일<input type="date" value={start} onChange={e => setStart(e.target.value)} /></label>
        <label>종료일<input type="date" value={end} onChange={e => setEnd(e.target.value)} /></label>
        <label className="territory-report-note-input">보고서 설명
          <input value={note} maxLength={1000} onChange={e => setNote(e.target.value)} />
          <small>공유 링크에 그대로 공개됩니다. 이름, 연락처, 주소 등 개인정보를 입력하지 마세요.</small>
        </label>
        <button type="button" className="secondary-button" onClick={() => void refresh()}>새로고침</button>
      </section>

      {shareOpen && (
        <section className="territory-report-share-panel no-print">
          <div className="territory-report-share-form">
            <h2>외부 공유 링크 만들기</h2>
            <label>공개 기간
              <select value={expiresInDays} onChange={e => setExpiresInDays(Number(e.target.value))}>
                <option value={3}>3일</option><option value={7}>7일</option>
                <option value={14}>14일</option><option value={30}>30일</option><option value={90}>90일</option>
              </select>
            </label>
            <label className="territory-report-pin-toggle">
              <input type="checkbox" checked={usePin} onChange={e => setUsePin(e.target.checked)} /> 6자리 암호 사용
            </label>
            {usePin && <label>암호<input inputMode="numeric" pattern="[0-9]*" maxLength={6} value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="숫자 6자리" /></label>}
            <button type="button" className="primary-button" onClick={() => void createShare()}>링크 만들기</button>
            <p>링크에는 집계 숫자만 포함되며 주소, 세대 번호, 이름, 전화번호, 메모는 공개되지 않습니다.</p>
          </div>
          {createdLink && (
            <div className="territory-report-created-link">
              <input readOnly value={createdLink} aria-label="생성된 공유 링크" />
              <button type="button" onClick={() => void copyLink()}>복사</button>
              {usePin && <strong>암호 {pin}</strong>}
            </div>
          )}
          {shares.length > 0 && (
            <div className="territory-report-share-list">
              <h3>최근 공유</h3>
              {shares.slice(0, 8).map(share => (
                <div key={share.id}>
                  <span>{share.periodStart} - {share.periodEnd}</span>
                  <span>{share.pinRequired ? '암호 있음' : '암호 없음'} · 조회 {share.viewCount}</span>
                  <span>{share.revokedAt ? '종료됨' : `${new Date(share.expiresAt).toLocaleDateString('ko-KR')}까지`}</span>
                  {!share.revokedAt && <button type="button" onClick={async () => { await revokeChineseTerritoryReportShare(share.id); void refreshShares() }}>공유 종료</button>}
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {loading && !snapshot ? <div className="territory-report-loading">보고서를 집계하고 있습니다.</div> : snapshot && <TerritoryReportView snapshot={snapshot} />}
    </main>
  )
}
