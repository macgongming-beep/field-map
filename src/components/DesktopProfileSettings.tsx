import { useEffect, useState } from 'react'
import { FontScalePicker } from './FontScalePicker'
import type { AuthUser, LoginLogRecord } from '../hooks/useAuth'
import type { Role } from '../types'
import { roleLabels } from '../types'
import { alertDialog } from '../lib/confirm'
import { supabase } from '../lib/supabase'
import { languageLabels, t, type AppLanguage } from '../i18n'

export function DesktopProfileSettings({
  user,
  language = 'ko',
  onChangeLanguage,
  onChangePin,
  onUpdateProfile,
  onFetchLoginLogs,
}: {
  user: AuthUser
  language?: AppLanguage
  onChangeLanguage: (language: AppLanguage) => void
  onChangePin: (newPin: string) => Promise<boolean>
  onUpdateProfile: (input: { name: string; phone?: string | null }) => Promise<boolean>
  onFetchLoginLogs?: (limit?: number) => Promise<LoginLogRecord[]>
}) {
  
  const [name, setName] = useState(user.name)
  const [phone, setPhone] = useState(user.phone ?? '')
  const [newPin, setNewPin] = useState('')
  const [newPinConfirm, setNewPinConfirm] = useState('')
  const [savingProfile, setSavingProfile] = useState(false)
  const [savingPin, setSavingPin] = useState(false)
  const [loginLogs, setLoginLogs] = useState<LoginLogRecord[]>([])
  const [loadingLoginLogs, setLoadingLoginLogs] = useState(false)
  const [groupName, setGroupName] = useState<string | null>(null)

  // 내 소속 집단 (사용자 관리에서 지정됨 — 여기선 표시만)
  useEffect(() => {
    let cancelled = false
    void supabase.from('app_users').select('group_name').eq('id', user.id).maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setGroupName((data as { group_name?: string | null } | null)?.group_name ?? null)
      })
    return () => { cancelled = true }
  }, [user.id])
  const [loginLogsExpanded, setLoginLogsExpanded] = useState(false)

  useEffect(() => {
    setName(user.name)
    setPhone(user.phone ?? '')
  }, [user.name, user.phone])

  useEffect(() => {
    let cancelled = false
    const loadLogs = async () => {
      if (!onFetchLoginLogs) return
      setLoadingLoginLogs(true)
      try {
        const logs = await onFetchLoginLogs(10)
        if (!cancelled) setLoginLogs(logs)
      } finally {
        if (!cancelled) setLoadingLoginLogs(false)
      }
    }
    void loadLogs()
    return () => {
      cancelled = true
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.id])

  const canUsePhone = user.role === 'leader' || user.role === 'admin' || user.role === 'developer'
  const roleLabel = user.role === 'user' ? t(language, 'role.user') : roleLabels[user.role as Role]
  const visibleLoginLogs = loginLogsExpanded ? loginLogs : loginLogs.slice(0, 3)

  return (
    <div className="desk-settings-subpage" style={{ maxWidth: 640 }}>
      <h2 style={{ fontSize: 22, fontWeight: 800, color: 'var(--gray-900)', marginBottom: 24 }}>내 정보</h2>
      <div className="desktop-profile-stack" style={{ display: 'grid', gap: 24 }}>
        <section className="desk-card ds-card" style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div className="ds-avatar" style={{ width: 64, height: 64, fontSize: 24 }} aria-hidden="true">
            {user.name.slice(0, 1)}
          </div>
          <div style={{ display: 'grid', gap: 4 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <strong style={{ fontSize: 18, fontWeight: 800, color: 'var(--gray-900)' }}>{user.name}</strong>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--gray-500)', background: 'var(--gray-100)', padding: '2px 8px', borderRadius: 999 }}>
                {roleLabel}
              </span>
              {groupName && (
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--gray-500)', background: 'var(--gray-100)', padding: '2px 8px', borderRadius: 999 }}>
                  {groupName}
                </span>
              )}
            </div>
            <span style={{ fontSize: 13, color: 'var(--gray-500)' }}>{user.loginId}</span>
          </div>
        </section>

        {/* ⚠ 글씨 크기는 PC 에도 있어야 한다. 확대는 화면 폭과 무관하게 걸리는데
            설정이 모바일에만 있으면, 태블릿을 돌려 폭이 980px 을 넘는 순간
            **확대된 PC 화면에서 끄지 못한다.** (리뷰에서 잡혔다) */}
        <section className="desk-card ds-card" style={{ display: 'grid', gap: 12 }}>
          <h2 className="desk-card__title">{t(language, 'settings.fontScale')}</h2>
          <FontScalePicker userId={user.id} language={language} />
        </section>

        <section className="desk-card ds-card desktop-language-settings">
          <div>
            <h2 className="desk-card__title">{t(language, 'settings.language')}</h2>
            <p>{t(language, 'settings.languageHelp')}</p>
          </div>
          <div className="desktop-language-grid" aria-label={t(language, 'settings.language')}>
            {(['ko', 'zh', 'en'] as AppLanguage[]).map((item) => (
              <button
                aria-pressed={language === item}
                className={language === item ? 'active' : ''}
                key={item}
                onClick={() => onChangeLanguage(item)}
                type="button"
              >
                {languageLabels[item]}
              </button>
            ))}
          </div>
        </section>

        <section className="desk-card ds-card" style={{ display: 'grid', gap: 16 }}>
          <h2 className="desk-card__title">개인 정보</h2>
          <label style={{ display: 'grid', gap: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--gray-700)' }}>닉네임</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={{ height: 44, padding: '0 12px', border: '1px solid var(--border-default)', borderRadius: 8, background: 'var(--bg-card)', color: 'var(--gray-900)', fontSize: 14 }}
            />
          </label>
          {canUsePhone && (
            <label style={{ display: 'grid', gap: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--gray-700)' }}>핸드폰 번호</span>
              <input
                inputMode="tel"
                placeholder="010-0000-0000"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                style={{ height: 44, padding: '0 12px', border: '1px solid var(--border-default)', borderRadius: 8, background: 'var(--bg-card)', color: 'var(--gray-900)', fontSize: 14 }}
              />
            </label>
          )}
          <div style={{ marginTop: 8 }}>
            <button
              className="ds-btn ds-btn-primary"
              disabled={savingProfile || !name.trim()}
              onClick={async () => {
                setSavingProfile(true)
                try {
                  await onUpdateProfile({ name, phone: canUsePhone ? phone : undefined })
                } finally {
                  setSavingProfile(false)
                }
              }}
              type="button"
              style={{ width: '100%', height: 44, fontSize: 14 }}
            >
              저장
            </button>
          </div>
        </section>

        <section className="desk-card ds-card" style={{ display: 'grid', gap: 16 }}>
          <h2 className="desk-card__title">비밀번호 변경</h2>
          <label style={{ display: 'grid', gap: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--gray-700)' }}>새 비밀번호</span>
            <input
              type="password"
              placeholder="새 비밀번호를 입력하세요"
              value={newPin}
              onChange={(e) => setNewPin(e.target.value)}
              style={{ height: 44, padding: '0 12px', border: '1px solid var(--border-default)', borderRadius: 8, background: 'var(--bg-card)', color: 'var(--gray-900)', fontSize: 14 }}
            />
          </label>
          <label style={{ display: 'grid', gap: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--gray-700)' }}>새 비밀번호 확인</span>
            <input
              type="password"
              placeholder="다시 입력하세요"
              value={newPinConfirm}
              onChange={(e) => setNewPinConfirm(e.target.value)}
              style={{ height: 44, padding: '0 12px', border: '1px solid var(--border-default)', borderRadius: 8, background: 'var(--bg-card)', color: 'var(--gray-900)', fontSize: 14 }}
            />
          </label>
          <div style={{ marginTop: 8 }}>
            <button
              className="ds-btn"
              disabled={savingPin || !newPin.trim() || !newPinConfirm.trim()}
              onClick={async () => {
                if (newPin !== newPinConfirm) {
                  void alertDialog({ message: '비밀번호가 일치하지 않습니다.' })
                  return
                }
                setSavingPin(true)
                try {
                  const ok = await onChangePin(newPin)
                  if (ok) {
                    setNewPin('')
                    setNewPinConfirm('')
                  }
                } finally {
                  setSavingPin(false)
                }
              }}
              type="button"
              style={{ width: '100%', height: 44, fontSize: 14 }}
            >
              비밀번호 변경
            </button>
          </div>
        </section>

        <section className="desk-card ds-card" style={{ display: 'grid', gap: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <h2 className="desk-card__title">로그인 기록</h2>
            <span style={{ color: 'var(--gray-500)', fontSize: 12, fontWeight: 600 }}>
              {loginLogsExpanded ? `${loginLogs.length}건` : `최근 ${Math.min(loginLogs.length, 3)}건`}
            </span>
          </div>
          {loadingLoginLogs ? (
            <p className="mobile-login-empty">로그인 기록을 불러오는 중입니다.</p>
          ) : loginLogs.length === 0 ? (
            <p className="mobile-login-empty">아직 로그인 기록이 없습니다.</p>
          ) : (
            <div className={`mobile-login-list${loginLogsExpanded ? ' is-expanded' : ''}`}>
              {visibleLoginLogs.map((log) => (
                <div className="mobile-login-row" key={log.id}>
                  <span>로그인</span>
                  <strong>{formatLoginDateTime(log.logged_in_at)}</strong>
                </div>
              ))}
              {loginLogs.length > 3 && (
                <button
                  className="mobile-login-toggle"
                  onClick={() => setLoginLogsExpanded((value) => !value)}
                  type="button"
                >
                  {loginLogsExpanded ? '접기' : `더 보기 ${loginLogs.length - 3}건`}
                </button>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

function formatLoginDateTime(value?: string | null) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  const pad = (num: number) => String(num).padStart(2, '0')
  return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}
