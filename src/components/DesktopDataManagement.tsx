import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { confirmDialog, alertDialog } from '../lib/confirm'
import { DataRoundTrip } from './DataRoundTrip'
import { PhoneSurveyPanel } from './PhoneSurveyPanel'
import { getCurrentVisitor } from '../hooks/useStore'
import { t, currentLang } from '../i18n'
import { msg } from '../lib/msg'
import { resetDemoEnvironment } from '../lib/demoEnvironment'

export function DesktopDataManagement({ isDeveloper = false }: { isDeveloper?: boolean }) {
  

  const [resetEnabled, setResetEnabled] = useState(true)
  const [resetDays, setResetDays] = useState(90)
  const [hideParticipants, setHideParticipants] = useState(false)
  const [resetSettingsLoaded, setResetSettingsLoaded] = useState(false)
  const [resetSaving, setResetSaving] = useState(false)
  const [manualResetting, setManualResetting] = useState(false)
  const [manualResetResult, setManualResetResult] = useState<number | null>(null)
  const [demoResetting, setDemoResetting] = useState(false)

  const [purgeCutoffYear, setPurgeCutoffYear] = useState(new Date().getFullYear() - 1)
  const [purgeCutoffMonth, setPurgeCutoffMonth] = useState(new Date().getMonth() + 1)
  const [purgePreview, setPurgePreview] = useState<number | null>(null)
  const [purgePreviewLoading, setPurgePreviewLoading] = useState(false)
  const [showPurgeModal, setShowPurgeModal] = useState(false)
  const [purgeError, setPurgeError] = useState(false)
  const [purging, setPurging] = useState(false)
  const [purgeResult, setPurgeResult] = useState<number | null>(null)

  // 데이터 자동 정리 (용량 관리)
  const [retentionLoaded, setRetentionLoaded] = useState(false)
  const [retEnabled, setRetEnabled] = useState(true)
  const [retChat, setRetChat] = useState(90)
  const [retNotif, setRetNotif] = useState(30)
  const [retSvc, setRetSvc] = useState(60)
  const [retLogin, setRetLogin] = useState(180)
  const [retSaving, setRetSaving] = useState(false)
  const [retRunning, setRetRunning] = useState(false)
  const [retPreview, setRetPreview] = useState<null | { chat: number; notif: number; svc: number; login: number }>(null)

  useEffect(() => {
    supabase.from('app_settings').select('key, value').in('key', ['visit_reset_enabled', 'visit_reset_days_met', 'hide_participants_from_users'])
      .then(({ data }) => {
        if (!data) return
        data.forEach((row) => {
          if (row.key === 'visit_reset_enabled') setResetEnabled(row.value === 'true')
          if (row.key === 'visit_reset_days_met') setResetDays(Number(row.value) || 90)
          if (row.key === 'hide_participants_from_users') setHideParticipants(row.value === 'true')
        })
        setResetSettingsLoaded(true)
      })
    supabase.from('app_settings').select('key, value').in('key', [
      'retention_enabled', 'retention_chat_days', 'retention_notif_read_days',
      'retention_service_logs_days', 'retention_login_logs_days',
    ]).then(({ data }) => {
      if (data) {
        data.forEach((row) => {
          if (row.key === 'retention_enabled') setRetEnabled(row.value === 'true')
          if (row.key === 'retention_chat_days') setRetChat(Number(row.value) || 90)
          if (row.key === 'retention_notif_read_days') setRetNotif(Number(row.value) || 30)
          if (row.key === 'retention_service_logs_days') setRetSvc(Number(row.value) || 60)
          if (row.key === 'retention_login_logs_days') setRetLogin(Number(row.value) || 180)
        })
      }
      setRetentionLoaded(true)
    })
  }, [])

  const saveRetentionSettings = async () => {
    setRetSaving(true)
    await supabase.from('app_settings').upsert([
      { key: 'retention_enabled', value: String(retEnabled) },
      { key: 'retention_chat_days', value: String(retChat) },
      { key: 'retention_notif_read_days', value: String(retNotif) },
      { key: 'retention_service_logs_days', value: String(retSvc) },
      { key: 'retention_login_logs_days', value: String(retLogin) },
    ])
    setRetSaving(false)
    setRetPreview(null)
    void alertDialog({ message: t(currentLang(), 'toast.saved') })
  }

  const loadRetentionPreview = async () => {
    setRetPreview(null)
    const { data, error } = await supabase.rpc('preview_data_cleanup')
    if (error || !data) {
      console.error('[retention] preview error:', error)
      void alertDialog({ message: '미리보기에 실패했습니다. v3_data_retention.sql 을 먼저 실행했는지 확인해 주세요.' })
      return
    }
    const d = data as Record<string, number>
    setRetPreview({
      chat: d.chat_to_delete ?? 0,
      notif: d.notifications_to_delete ?? 0,
      svc: d.service_logs_to_delete ?? 0,
      login: d.login_logs_to_delete ?? 0,
    })
  }

  const runRetentionCleanup = async () => {
    const total = retPreview ? retPreview.chat + retPreview.notif + retPreview.svc + retPreview.login : null
    // msg 는 번역 헬퍼 이름이라 지역 변수명으로 쓰지 않는다
    const question = total != null
      ? msg('오래된 데이터 {total}건(채팅 {chat} · 알림 {notif} · 운영로그 {svc} · 로그인 {login})을 지금 영구 삭제할까요?', {
          total: total.toLocaleString(), chat: retPreview!.chat, notif: retPreview!.notif,
          svc: retPreview!.svc, login: retPreview!.login,
        })
      : msg('현재 보존 기간 기준으로 오래된 데이터를 지금 영구 삭제할까요?')
    if (!(await confirmDialog({ message: question, danger: true, confirmLabel: '정리 실행' }))) return
    setRetRunning(true)
    const { data, error } = await supabase.rpc('cleanup_old_data')
    setRetRunning(false)
    if (error || !data) {
      console.error('[retention] cleanup error:', error)
      void alertDialog({ message: '정리 실행에 실패했습니다.' })
      return
    }
    const d = data as Record<string, number | boolean>
    const deleted = (Number(d.chat_deleted) || 0) + (Number(d.notifications_deleted) || 0) + (Number(d.service_logs_deleted) || 0) + (Number(d.login_logs_deleted) || 0)
    setRetPreview(null)
    void alertDialog({ message: msg('정리 완료: 총 {v1}건 삭제됨', { v1: deleted.toLocaleString() }) })
  }

  const saveResetSettings = async () => {
    setResetSaving(true)
    await supabase.from('app_settings').upsert([
      { key: 'visit_reset_enabled',  value: String(resetEnabled) },
      { key: 'visit_reset_days_met', value: String(resetDays) },
      { key: 'hide_participants_from_users', value: String(hideParticipants) },
    ])
    setResetSaving(false)
    void alertDialog({ message: t(currentLang(), 'toast.saved') })
  }

  const runManualReset = async () => {
    if (!(await confirmDialog({ message: '만남 상태인 모든 세대를 지금 즉시 미방문으로 초기화할까요?\n방문 기록은 유지됩니다.', danger: true, confirmLabel: '초기화' }))) return
    setManualResetting(true)
    setManualResetResult(null)
    const { data } = await supabase.rpc('manual_reset_met_units')
    setManualResetResult(typeof data === 'number' ? data : null)
    setManualResetting(false)
  }

  const runDemoReset = async () => {
    const confirmed = await confirmDialog({
      message: '테스트 앱에서 만든 계정·구역·건물·일정·기록을 모두 지우고 기본 데모 자료로 되돌릴까요?\n현재 개발자 계정과 전역 설정은 유지됩니다.',
      danger: true,
      confirmLabel: '데모 데이터 초기화',
    })
    if (!confirmed) return
    setDemoResetting(true)
    const result = await resetDemoEnvironment()
    setDemoResetting(false)
    if (!result.ok) {
      void alertDialog({ message: result.error ?? '데모 데이터를 초기화하지 못했습니다.' })
      return
    }
    await alertDialog({ message: '기본 데모 자료로 초기화했습니다.' })
    window.location.reload()
  }

  const purgeCutoffStr = `${purgeCutoffYear}-${String(purgeCutoffMonth).padStart(2, '0')}-01`

  const loadPurgePreview = async () => {
    setPurgePreviewLoading(true)
    setPurgePreview(null)
    setPurgeError(false)
    const { data, error } = await supabase.rpc('count_old_visit_histories', { cutoff_date: purgeCutoffStr })
    if (error || typeof data !== 'number') {
      console.error('[purge] error:', error)
      setPurgeError(true)
    } else {
      setPurgePreview(data)
    }
    setPurgePreviewLoading(false)
    setShowPurgeModal(true)
  }

  const runPurge = async () => {
    if (purgePreview === null || purgePreview === 0) return
    setPurging(true)
    setPurgeResult(null)
    const { data } = await supabase.rpc('delete_old_visit_histories', { cutoff_date: purgeCutoffStr })
    setPurgeResult(typeof data === 'number' ? data : null)
    setPurgePreview(null)
    setPurging(false)
    setShowPurgeModal(false)
  }

  return (
    <div className="desk-settings-subpage" style={{ maxWidth: 640 }}>
      <h2 style={{ fontSize: 22, fontWeight: 800, color: 'var(--gray-900)', marginBottom: 24 }}>데이터 관리</h2>
      <div className="desktop-profile-stack" style={{ display: 'grid', gap: 24 }}>
        {isDeveloper && import.meta.env.VITE_DEMO_MODE === 'true' && (
          <section className="desk-card ds-card">
            <h2 className="desk-card__title" style={{ marginBottom: 12 }}>테스트 앱 초기화</h2>
            <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--gray-500)', lineHeight: 1.6 }}>
              시연 중 바뀐 자료를 지우고 계정·구역·건물·일정을 기본 데모 상태로 되돌립니다.
              이 기능은 테스트 앱의 개발자 계정에서만 실행됩니다.
            </p>
            <button
              className="ds-btn ds-btn-danger"
              onClick={runDemoReset}
              disabled={demoResetting}
              type="button"
              style={{ opacity: demoResetting ? 0.6 : 1 }}
            >
              {demoResetting ? '초기화 중…' : '기본 데모 자료로 초기화'}
            </button>
          </section>
        )}

        {/* 방문 기록 / 세대 속성 엑셀 왕복 편집 */}
        <PhoneSurveyPanel currentVisitor={getCurrentVisitor()} />
        <DataRoundTrip />
        {resetSettingsLoaded && (
          <section className="desk-card ds-card">
            <h2 className="desk-card__title" style={{ marginBottom: 12 }}>만남 자동 초기화</h2>
            <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--gray-500)', lineHeight: 1.6 }}>
              만남 기록 후 설정한 일수가 지나면 자동으로 미방문으로 초기화됩니다. 방문 기록은 보존됩니다.
            </p>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, cursor: 'pointer' }}>
              <input type="checkbox" checked={resetEnabled} onChange={(e) => setResetEnabled(e.target.checked)}
                style={{ width: 15, height: 15, accentColor: 'var(--ink)' }} />
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--gray-800)' }}>자동 초기화 활성화</span>
            </label>
            {resetEnabled && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                <span style={{ fontSize: 13, color: 'var(--gray-600)', whiteSpace: 'nowrap' }}>만남 후</span>
                <input type="number" min={7} max={730} value={resetDays}
                  onChange={(e) => setResetDays(Math.max(7, Math.min(730, Number(e.target.value))))}
                  style={{ width: 68, padding: '6px 10px', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', fontSize: 13, fontFamily: 'inherit', background: 'var(--bg-card)', color: 'var(--gray-900)' }} />
                <span style={{ fontSize: 13, color: 'var(--gray-600)' }}>일 후 자동 초기화</span>
              </label>
            )}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="ds-btn ds-btn-primary" onClick={saveResetSettings} disabled={resetSaving} type="button" style={{ opacity: resetSaving ? 0.6 : 1 }}>
                {resetSaving ? '저장 중…' : '설정 저장'}
              </button>
              <button className="ds-btn" onClick={runManualReset} disabled={manualResetting} type="button" style={{ opacity: manualResetting ? 0.6 : 1 }}>
                {manualResetting ? '초기화 중…' : '지금 즉시 초기화'}
              </button>
            </div>
            {manualResetResult !== null && (
              <p style={{ marginTop: 10, fontSize: 13, color: 'var(--success-600)', display: 'flex', alignItems: 'center', gap: 4 }}>
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                {manualResetResult}개 세대가 미방문으로 초기화됐습니다
              </p>
            )}
          </section>
        )}


        <section className="desk-card ds-card">
          <h2 className="desk-card__title" style={{ marginBottom: 12 }}>봉사자 참가 권한 설정</h2>
          <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--gray-500)', lineHeight: 1.6 }}>
            봉사자에게 일정의 참가자 목록과 참가 인원을 숨길 수 있습니다. (인도자/관리자는 항상 볼 수 있습니다)
          </p>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, cursor: 'pointer' }}>
            <input type="checkbox" checked={hideParticipants} onChange={(e) => setHideParticipants(e.target.checked)}
              style={{ width: 15, height: 15, accentColor: 'var(--ink)' }} />
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--gray-800)' }}>봉사자에게 참가자 목록 및 인원 숨기기</span>
          </label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="ds-btn ds-btn-primary" onClick={saveResetSettings} disabled={resetSaving} type="button" style={{ opacity: resetSaving ? 0.6 : 1 }}>
              {resetSaving ? '저장 중…' : '설정 저장'}
            </button>
          </div>
        </section>

        <section className="desk-card ds-card">
          <h2 className="desk-card__title" style={{ marginBottom: 12 }}>방문기록 영구 삭제</h2>
          <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--gray-500)', lineHeight: 1.6 }}>
            선택한 날짜 이전 방문기록을 영구 삭제합니다. 기록이 모두 삭제된 세대는 <strong>미방문</strong>으로 자동 초기화되고, 잔여 기록이 있는 세대는 최신 기록 기준으로 상태가 보정됩니다.
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 16 }}>
            <select value={purgeCutoffYear} onChange={(e) => setPurgeCutoffYear(Number(e.target.value))}
              style={{ width: 80, padding: '6px 10px', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', fontSize: 13, background: 'var(--bg-card)', color: 'var(--gray-900)' }}>
              {[...Array(5)].map((_, i) => {
                const y = new Date().getFullYear() - i
                return <option key={y} value={y}>{y}년</option>
              })}
            </select>
            <select value={purgeCutoffMonth} onChange={(e) => setPurgeCutoffMonth(Number(e.target.value))}
              style={{ width: 70, padding: '6px 10px', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', fontSize: 13, background: 'var(--bg-card)', color: 'var(--gray-900)' }}>
              {[...Array(12)].map((_, i) => (
                <option key={i + 1} value={i + 1}>{i + 1}월</option>
              ))}
            </select>
            <span style={{ fontSize: 13, color: 'var(--gray-600)', fontWeight: 600 }}>1일 이전 기록</span>
          </div>
          <button className="ds-btn ds-btn-danger" onClick={loadPurgePreview} disabled={purgePreviewLoading} type="button">
            {purgePreviewLoading ? '조회 중…' : '삭제 건수 확인'}
          </button>
          {purgeResult !== null && (
            <p style={{ marginTop: 10, fontSize: 13, color: 'var(--success-600)', display: 'flex', alignItems: 'center', gap: 4 }}>
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
              {purgeResult}건이 삭제됐습니다
            </p>
          )}
        </section>

        {retentionLoaded && (
          <section className="desk-card ds-card">
            <h2 className="desk-card__title" style={{ marginBottom: 12 }}>데이터 자동 정리 (용량 관리)</h2>
            <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--gray-500)', lineHeight: 1.6 }}>
              무료 용량(500MB) 관리를 위해 오래된 채팅·알림·로그를 매일 새벽 자동으로 정리합니다.
              방문기록·구역·건물 등 핵심 데이터는 정리 대상이 아닙니다. (영구 삭제이므로 백업 후 사용 권장)
            </p>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, cursor: 'pointer' }}>
              <input type="checkbox" checked={retEnabled} onChange={(e) => setRetEnabled(e.target.checked)}
                style={{ width: 15, height: 15, accentColor: 'var(--ink)' }} />
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--gray-800)' }}>자동 정리 활성화</span>
            </label>
            <div style={{ display: 'grid', gap: 10, marginBottom: 16 }}>
              {([
                ['채팅 메시지', retChat, setRetChat, 7, 730],
                ['읽은 알림', retNotif, setRetNotif, 3, 365],
                ['운영 로그', retSvc, setRetSvc, 7, 365],
                ['로그인 기록', retLogin, setRetLogin, 30, 730],
              ] as const).map(([label, val, setter, min, max]) => (
                <label key={label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 13, color: 'var(--gray-600)', width: 92 }}>{label}</span>
                  <input type="number" min={min} max={max} value={val} disabled={!retEnabled}
                    onChange={(e) => setter(Math.max(min, Math.min(max, Number(e.target.value))))}
                    style={{ width: 68, padding: '6px 10px', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', fontSize: 13, fontFamily: 'inherit', background: 'var(--bg-card)', color: 'var(--gray-900)', opacity: retEnabled ? 1 : 0.5 }} />
                  <span style={{ fontSize: 13, color: 'var(--gray-600)' }}>일 지나면 삭제</span>
                </label>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="ds-btn ds-btn-primary" onClick={saveRetentionSettings} disabled={retSaving} type="button" style={{ opacity: retSaving ? 0.6 : 1 }}>
                {retSaving ? '저장 중…' : '설정 저장'}
              </button>
              <button className="ds-btn" onClick={loadRetentionPreview} type="button">
                삭제 예정 건수 확인
              </button>
              <button className="ds-btn ds-btn-danger" onClick={runRetentionCleanup} disabled={retRunning} type="button" style={{ opacity: retRunning ? 0.6 : 1 }}>
                {retRunning ? '정리 중…' : '지금 정리'}
              </button>
            </div>
            {retPreview && (
              <div style={{ marginTop: 12, padding: '12px 14px', background: 'var(--bg-subtle)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
                <p style={{ margin: 0, fontSize: 13, color: 'var(--gray-700)', lineHeight: 1.8 }}>
                  현재 기준 삭제 예정:<br />
                  · 채팅 <strong>{retPreview.chat.toLocaleString()}</strong>건 · 읽은 알림 <strong>{retPreview.notif.toLocaleString()}</strong>건<br />
                  · 운영 로그 <strong>{retPreview.svc.toLocaleString()}</strong>건 · 로그인 기록 <strong>{retPreview.login.toLocaleString()}</strong>건
                </p>
              </div>
            )}
          </section>
        )}
      </div>

      {showPurgeModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'grid', placeItems: 'center', padding: 20 }}>
          <div style={{ background: 'var(--bg-card)', width: '100%', maxWidth: 400, borderRadius: 'var(--radius-xl)', overflow: 'hidden', boxShadow: 'var(--shadow-xl)' }}>
            <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
              {purgeError ? (
                <div style={{ textAlign: 'center', padding: '16px 0', color: 'var(--danger-500)' }}>
                  <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 8 }}>
                    <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
                  </div>
                  <p style={{ fontSize: 15, fontWeight: 700, margin: '0 0 4px', color: 'var(--gray-900)' }}>조회에 실패했습니다</p>
                  <p style={{ fontSize: 13, color: 'var(--gray-500)', margin: '0 0 6px' }}>서버에 함수가 등록되지 않았을 수 있습니다.</p>
                </div>
              ) : purgePreview === 0 ? (
                <div style={{ textAlign: 'center', padding: '16px 0', color: 'var(--gray-400)' }}>
                  <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 8 }}>
                    <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                  </div>
                  <p style={{ fontSize: 15, fontWeight: 700, margin: '0 0 4px', color: 'var(--gray-900)' }}>{t(currentLang(), 'toast.noRecords')}</p>
                  <p style={{ fontSize: 13, color: 'var(--gray-500)', margin: 0 }}>{purgeCutoffStr} 이전 방문기록이 없어요</p>
                </div>
              ) : (
                <>
                  <div style={{ padding: '14px 16px', background: 'var(--bg-card)', border: '1px solid var(--danger-300)', borderRadius: 'var(--radius-lg)' }}>
                    <p style={{ margin: '0 0 5px', fontSize: 13, fontWeight: 700, color: 'var(--danger-600)' }}>삭제 후 복구 불가</p>
                    <p style={{ margin: 0, fontSize: 13, color: 'var(--gray-800)', lineHeight: 1.6 }}>
                      <strong>{purgeCutoffStr}</strong> 이전 방문기록 <strong>{purgePreview?.toLocaleString()}건</strong>이 영구 삭제됩니다.
                      기록이 모두 삭제되는 세대는 미방문으로 자동 초기화됩니다.
                    </p>
                  </div>
                  <div style={{ padding: '12px 14px', background: 'var(--bg-subtle)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
                    <p style={{ margin: 0, fontSize: 12, color: 'var(--gray-600)', lineHeight: 1.7 }}>
                      • 방문 날짜·결과·방문자 기록이 삭제됩니다<br />
                      • 세대 상세 히스토리 목록에서 사라집니다<br />
                      • 과거 봉사 통계에는 영향을 주지 않습니다
                    </p>
                  </div>
                </>
              )}
            </div>
            <div style={{ display: 'flex', borderTop: '1px solid var(--border-subtle)' }}>
              <button
                onClick={() => setShowPurgeModal(false)}
                style={{ flex: 1, padding: 16, border: 'none', background: 'transparent', fontSize: 15, fontWeight: 600, color: 'var(--gray-600)', cursor: 'pointer' }}
                type="button"
              >
                닫기
              </button>
              {!purgeError && purgePreview! > 0 && (
                <button
                  onClick={runPurge}
                  disabled={purging}
                  style={{ flex: 1, padding: 16, border: 'none', background: 'var(--danger-500)', fontSize: 15, fontWeight: 700, color: '#fff', cursor: 'pointer', opacity: purging ? 0.7 : 1 }}
                  type="button"
                >
                  {purging ? '삭제 중…' : '영구 삭제 실행'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
