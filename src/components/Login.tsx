import { useState } from 'react'
import type { AppLanguage } from '../i18n'
import { languageLabels, t } from '../i18n'
import { PrivacyPolicy } from './PrivacyPolicy'
import './Login.css'

type LoginProps = {
  language: AppLanguage
  onChangeLanguage: (language: AppLanguage) => void
  onLogin: (loginId: string, pin: string, rememberMe: boolean) => Promise<boolean>
  onSignup: (loginId: string, nickname: string, pin: string) => Promise<boolean>
}

const LANGUAGES: AppLanguage[] = ['ko', 'zh', 'en']
const IS_DEMO = import.meta.env.VITE_DEMO_MODE === 'true'
const APP_LABEL = import.meta.env.VITE_APP_LABEL?.trim()

export function Login({ language, onChangeLanguage, onLogin, onSignup }: LoginProps) {
  const [isSignup, setIsSignup] = useState(false)
  const [loginId, setLoginId] = useState('')
  const [nickname, setNickname] = useState('')
  const [pin, setPin] = useState('')
  const [rememberMe, setRememberMe] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [signupCompleted, setSignupCompleted] = useState<{ loginId: string; nickname: string } | null>(null)
  const [agreedPrivacy, setAgreedPrivacy] = useState(false)
  const [showPolicy, setShowPolicy] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!loginId.trim() || !pin.trim() || (isSignup && !nickname.trim())) return
    if (isSignup && !agreedPrivacy) return

    setIsSubmitting(true)
    let success = false

    if (isSignup) {
      success = await onSignup(loginId.trim(), nickname.trim(), pin.trim())
    } else {
      success = await onLogin(loginId.trim(), pin.trim(), rememberMe)
    }

    if (!success) {
      setIsSubmitting(false)
      return
    }

    if (isSignup) {
      // 가입 성공 → 안내 모달 표시 (사용자가 인지 후 닫아야 로그인 화면 복귀)
      setSignupCompleted({ loginId: loginId.trim(), nickname: nickname.trim() })
      setIsSubmitting(false)
      setNickname('')
      setPin('')
    }
  }

  const closeSignupModal = () => {
    setSignupCompleted(null)
    setIsSignup(false)
  }

  return (
    <div className="login-container">
      <div className="login-card">
        <div className="login-header">
          <div className="login-logo">
            <img src="/icons/icon-192.png" alt="" />
          </div>
          <h1>{isSignup ? t(language, 'login.signupTitle') : t(language, 'login.appName')}</h1>
          <p className={!isSignup ? 'login-yongin' : ''}>
            {isSignup ? t(language, 'login.signupSubtitle') : IS_DEMO ? 'DEMO' : APP_LABEL || t(language, 'login.subtitle')}
          </p>
          <div className="login-language-switcher" aria-label={t(language, 'settings.language')}>
            {LANGUAGES.map((item) => (
              <button
                className={language === item ? 'active' : ''}
                key={item}
                onClick={() => onChangeLanguage(item)}
                type="button"
              >
                {languageLabels[item]}
              </button>
            ))}
          </div>
        </div>

        <form onSubmit={handleSubmit} className="login-form">
          <div className="form-group">
            <label htmlFor="login-id">{t(language, 'login.id')}</label>
            <input
              id="login-id"
              type="text"
              value={loginId}
              onChange={(e) => setLoginId(e.target.value)}
              placeholder={IS_DEMO && !isSignup ? t(language, 'login.demoIdPlaceholder') : t(language, 'login.idPlaceholder')}
              required
              disabled={isSubmitting}
              enterKeyHint="next"
              autoComplete="username"
            />
          </div>

          {isSignup && (
            <div className="form-group">
              <label htmlFor="nickname">{t(language, 'login.nickname')}</label>
              <input
                id="nickname"
                type="text"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                placeholder={t(language, 'login.nicknamePlaceholder')}
                required
                disabled={isSubmitting}
                enterKeyHint="next"
                autoComplete="nickname"
              />
            </div>
          )}

          <div className="form-group">
            <label htmlFor="pin">{t(language, 'login.password')}</label>
            <input
              id="pin"
              type="password"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              placeholder={isSignup ? t(language, 'login.newPasswordPlaceholder') : t(language, 'login.passwordPlaceholder')}
              required
              disabled={isSubmitting}
              enterKeyHint={isSignup ? "done" : "go"}
              autoComplete={isSignup ? "new-password" : "current-password"}
            />
          </div>

          {!isSignup && (
            <div className="form-group checkbox-group">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  disabled={isSubmitting}
                />
                {t(language, 'login.rememberMe')}
              </label>
            </div>
          )}

          {isSignup && (
            <div className="form-group checkbox-group">
              <label className="checkbox-label" style={{ display: 'flex', alignItems: 'flex-start', gap: 8, lineHeight: 1.5 }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', height: '1.5em', flexShrink: 0 }}>
                  <input
                    type="checkbox"
                    checked={agreedPrivacy}
                    onChange={(e) => setAgreedPrivacy(e.target.checked)}
                    disabled={isSubmitting}
                    style={{ margin: 0 }}
                  />
                </span>
                <span>
                  {t(language, 'privacy.consent')}{' '}
                  <button type="button" className="text-btn" onClick={() => setShowPolicy(true)}>{t(language, 'privacy.viewFull')}</button>
                </span>
              </label>
            </div>
          )}

          <button
            type="submit"
            className="login-submit-btn"
            disabled={isSubmitting || !loginId.trim() || !pin.trim() || (isSignup && (!nickname.trim() || !agreedPrivacy))}
          >
            {isSubmitting ? t(language, 'common.processing') : isSignup ? t(language, 'login.signup') : t(language, 'login.login')}
          </button>
        </form>

        <div className="login-footer">
          {isSignup ? (
            <p>{t(language, 'login.hasAccount')} <button type="button" onClick={() => setIsSignup(false)} className="text-btn">{t(language, 'login.login')}</button></p>
          ) : (
            <p>{t(language, 'login.noAccount')} <button type="button" onClick={() => setIsSignup(true)} className="text-btn">{t(language, 'login.signupTitle')}</button></p>
          )}
        </div>
      </div>

      {signupCompleted && (
        <div className="login-modal-backdrop" onClick={closeSignupModal}>
          <div className="login-modal" onClick={(e) => e.stopPropagation()}>
            <div className="login-modal-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="38" height="38" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="9" />
                <path d="M9 12l2 2 4-4" />
              </svg>
            </div>
            <h2>가입 신청이 접수되었어요</h2>
            <p className="login-modal-sub">
              <strong>{signupCompleted.nickname}</strong> 님,<br />
              관리자 승인 후 로그인할 수 있습니다.
            </p>
            <div className="login-modal-info">
              <div className="login-modal-info-row">
                <span>아이디</span>
                <strong>{signupCompleted.loginId}</strong>
              </div>
              <div className="login-modal-info-row">
                <span>상태</span>
                <strong className="login-modal-pending">승인 대기 중</strong>
              </div>
            </div>
            <p className="login-modal-hint">
              승인이 완료되면 이 아이디와 비밀번호로 로그인할 수 있어요. <br />
              담당 관리자에게 신청 사실을 알려주세요.
            </p>
            <button type="button" className="login-modal-btn" onClick={closeSignupModal}>
              확인
            </button>
          </div>
        </div>
      )}

      {showPolicy && (
        <div
          onClick={() => setShowPolicy(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: 'var(--bg, #fff)', width: '100%', maxWidth: 560, maxHeight: 'calc(85vh / var(--app-zoom, 1))', borderRadius: 16, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
          >
            <div style={{ overflowY: 'auto', padding: '20px 18px' }}>
              <PrivacyPolicy language={language} />
            </div>
            <div style={{ padding: 12, borderTop: '1px solid var(--line, #e5e7eb)' }}>
              <button
                type="button"
                onClick={() => { setAgreedPrivacy(true); setShowPolicy(false) }}
                style={{ width: '100%', minHeight: 0, padding: '12px', borderRadius: 10, border: 'none', background: 'var(--ink, #1c1c1a)', color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer' }}
              >
                {t(language, 'privacy.agreeClose')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
