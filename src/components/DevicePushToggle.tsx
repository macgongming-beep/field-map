// 이 기기 푸시 알림 on/off — 알림 설정 화면 최상단에 두는 "대문" 스위치
//
// 왜 분리했나: 기기 구독이 꺼져 있으면 종류별 알림 설정을 아무리 켜도
// 알림이 오지 않는다. 두 곳(설정 첫 화면 / 알림 설정)에 흩어져 있어
// 사용자가 헷갈렸으므로, 알림 설정 화면 한 곳으로 모은다.
//
// onStateChange 로 부모(알림 설정)가 "기기 알림 꺼짐" 상태를 알 수 있고,
// 그때 종류별 목록을 흐리게 처리해 설정이 무시된다는 것을 보여준다.
import { useEffect, useState } from 'react'
import { t, type AppLanguage } from '../i18n'
import { isPWAInstalled, isIOS } from '../lib/pwa'
import { alertDialog } from '../lib/confirm'
import {
  isPushSupported,
  isCurrentDeviceSubscribed,
  requestNotificationPermission,
  subscribeToPush,
  unsubscribeFromPush,
} from '../lib/push'
import { useSharedAuth } from '../hooks/AuthContext'

export type DevicePushState = 'on' | 'off' | 'denied' | 'unsupported' | 'needs-install'

export function DevicePushToggle({
  language = 'ko',
  onStateChange,
  onOpenInstallGuide,
}: {
  language?: string
  onStateChange?: (state: DevicePushState) => void
  onOpenInstallGuide?: () => void
}) {
  const lang = (language ?? 'ko') as AppLanguage
  const { user } = useSharedAuth()
  const [installed, setInstalled] = useState(isPWAInstalled())
  const [notifPermission, setNotifPermission] = useState<NotificationPermission | 'unsupported'>(
    typeof Notification !== 'undefined' ? Notification.permission : 'unsupported',
  )
  const [subscribed, setSubscribed] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const interval = setInterval(() => setInstalled(isPWAInstalled()), 3000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    isCurrentDeviceSubscribed().then(setSubscribed)
  }, [notifPermission])

  // iOS 는 홈 화면에 추가(PWA)해야만 웹 푸시를 받을 수 있다
  const needsInstall = isIOS() && !installed
  const state: DevicePushState =
    !isPushSupported() ? 'unsupported'
    : needsInstall ? 'needs-install'
    : notifPermission === 'denied' ? 'denied'
    : subscribed ? 'on'
    : 'off'

  useEffect(() => {
    onStateChange?.(state)
  }, [state, onStateChange])

  async function handleEnable() {
    if (!user) return
    setBusy(true)
    try {
      let perm = notifPermission as NotificationPermission
      if (perm !== 'granted') {
        perm = await requestNotificationPermission()
        setNotifPermission(perm)
        if (perm !== 'granted') return
      }
      const result = await subscribeToPush(user.id)
      if (result.ok) setSubscribed(true)
      else {
        console.warn('[push] subscribe failed:', result.reason)
        void alertDialog({ message: t(lang, 'settings.pushEnableFailed') + ' (' + (result.reason ?? 'unknown') + ')' })
      }
    } finally {
      setBusy(false)
    }
  }

  async function handleDisable() {
    setBusy(true)
    try {
      await unsubscribeFromPush()
      setSubscribed(false)
    } finally {
      setBusy(false)
    }
  }

  const subtitle =
    state === 'unsupported' ? t(lang, 'settings.pushUnsupported')
    : state === 'needs-install' ? t(lang, 'settings.pushNeedsInstall')
    : state === 'denied' ? t(lang, 'settings.pushDenied')
    : state === 'on' ? t(lang, 'settings.pushEnabled')
    : t(lang, 'settings.pushDisabled')

  return (
    <div style={{
      padding: '14px 16px',
      background: 'var(--surface)',
      border: `1px solid ${state === 'on' ? 'var(--line)' : 'var(--status-warn, #B8862A)'}`,
      borderRadius: 12,
      marginBottom: 12,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--ink)' }}>
            {t(lang, 'settings.deviceNotification')}
          </span>
          <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>{subtitle}</span>
        </div>

        {state === 'needs-install' ? (
          <button
            onClick={() => onOpenInstallGuide?.()}
            type="button"
            style={{
              flexShrink: 0, height: 32, minHeight: 32, padding: '0 12px',
              border: '1px solid var(--line-2)', borderRadius: 8,
              background: 'var(--surface)', color: 'var(--text)',
              fontSize: 13, fontWeight: 600, cursor: 'pointer',
            }}
          >
            {t(lang, 'pwa.guideBtn')}
          </button>
        ) : (state === 'on' || state === 'off') && user ? (
          <button
            onClick={() => (state === 'on' ? void handleDisable() : void handleEnable())}
            disabled={busy}
            type="button"
            style={{
              flexShrink: 0, height: 32, minHeight: 32, padding: '0 14px',
              border: state === 'on' ? '1px solid var(--line-2)' : 'none', borderRadius: 8,
              background: state === 'on' ? 'var(--surface)' : 'var(--ink)',
              color: state === 'on' ? 'var(--text)' : '#fff',
              fontSize: 13, fontWeight: 700, cursor: busy ? 'default' : 'pointer',
              opacity: busy ? 0.6 : 1,
            }}
          >
            {busy ? t(lang, 'common.processing')
              : state === 'on' ? t(lang, 'settings.pushTurnOff')
              : t(lang, 'settings.pushTurnOn')}
          </button>
        ) : null}
      </div>

      {/* 꺼져 있으면 아래 설정이 무시된다는 점을 명시 */}
      {state !== 'on' && (
        <p style={{ margin: '10px 0 0', fontSize: 12, color: 'var(--muted)', lineHeight: 1.5 }}>
          {t(lang, 'settings.pushOffHelp')}
        </p>
      )}
    </div>
  )
}
