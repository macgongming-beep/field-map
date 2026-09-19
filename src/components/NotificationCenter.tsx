import { t, type AppLanguage } from '../i18n'
// 알림 센터 (헤더 🔔 클릭 시 슬라이드 다운)
import { useLocation, useNavigate } from 'react-router-dom'
import type { AppNotification, NotificationType } from '../hooks/useNotifications'
import { useUserChats } from '../hooks/useUserChats'
import { normalizeAppLink } from '../utils/appNavigation'
import { translateNotificationText } from '../lib/notificationText'
import { msg } from '../lib/msg'
import { eventDetailNavigationState } from '../lib/eventDetailNavigation'

const TYPE_LABEL: Record<NotificationType, { icon: NotificationIconName; color: string; bg: string }> = {
  notice: { icon: 'notice', color: '#2563eb', bg: '#eff4fe' },
  event_change: { icon: 'calendar', color: '#d97706', bg: '#fffbeb' },
  comment: { icon: 'message', color: '#0891b2', bg: '#ecfeff' },
  mention: { icon: 'mention', color: '#7c3aed', bg: '#f5f3ff' },
  chat: { icon: 'chat', color: '#0891b2', bg: '#ecfeff' },
  service_started: { icon: 'play', color: '#059669', bg: '#ecfdf5' },
  service_ended: { icon: 'stop', color: '#64748b', bg: '#f3f4f6' },
  assignment: { icon: 'mention', color: '#0d9488', bg: '#ccfbf1' },
  daily_service: { icon: 'calendar', color: '#0d9488', bg: '#ccfbf1' },
}

// 채팅 알림 → 카톡 스타일 그룹 (event_id 기준)
function extractEventIdFromLink(link: string | null): number | null {
  if (!link) return null
  const m = link.match(/openChat=(\d+)/)
  return m ? Number(m[1]) : null
}

// 알림 타입별 클릭 동선 결정
// - event_change: 일정 상세 시트 (openEvent)
// - assignment / service_started / service_ended: 활동 (/territory)
//   ⚠️ leader/user 화면 리디자인 후 더 정확한 위치로 deep-link 예정
// - chat / mention / comment / notice: 기본 link 그대로 (normalizeAppLink)
function resolveNotificationLink(n: AppNotification): string | null {
  if (n.type === 'event_change') {
    const eventId = n.relatedId ?? extractEventIdFromLink(n.link)
    return eventId ? `/calendar?openEvent=${eventId}` : normalizeAppLink(n.link)
  }
  if (n.type === 'assignment' || n.type === 'service_started' || n.type === 'service_ended') {
    return '/territory'
  }
  return normalizeAppLink(n.link)
}

type ChatGroup = {
  eventId: number
  notifications: AppNotification[]
  latest: AppNotification
  unreadCount: number
}

function groupChatNotifications(items: AppNotification[]): {
  groups: ChatGroup[]
  others: AppNotification[]
} {
  const map = new Map<number, AppNotification[]>()
  const others: AppNotification[] = []
  for (const n of items) {
    const isChatKind = n.type === 'chat' || n.type === 'mention'
    const eventId = isChatKind ? extractEventIdFromLink(n.link) : null
    if (eventId !== null) {
      const arr = map.get(eventId) ?? []
      arr.push(n)
      map.set(eventId, arr)
    } else {
      others.push(n)
    }
  }
  const groups: ChatGroup[] = Array.from(map.entries()).map(([eventId, list]) => {
    // 최신순 정렬
    const sorted = [...list].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    )
    const unread = sorted.filter((n) => !n.isRead)
    return {
      eventId,
      notifications: sorted,
      latest: sorted[0],
      unreadCount: unread.length,
    }
  })
  // 그룹은 최신 알림 시각으로 정렬
  groups.sort(
    (a, b) => new Date(b.latest.createdAt).getTime() - new Date(a.latest.createdAt).getTime()
  )
  return { groups, others }
}

type NotificationIconName = 'notice' | 'calendar' | 'message' | 'mention' | 'chat' | 'play' | 'stop' | 'bell'

const notificationIconProps = {
  width: 18,
  height: 18,
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  style: { display: 'block', flexShrink: 0 },
} as const

function NotificationIcon({ name }: { name: NotificationIconName }) {
  if (name === 'notice') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" {...notificationIconProps}>
        <path d="M4 12h3l8-5v10l-8-5H4Z" />
        <path d="M7 12v5a2 2 0 0 0 2 2h1" />
      </svg>
    )
  }
  if (name === 'calendar') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" {...notificationIconProps}>
        <path d="M7 3v4M17 3v4M4 9h16" />
        <rect x="4" y="5" width="16" height="16" rx="3" />
      </svg>
    )
  }
  if (name === 'message' || name === 'chat') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" {...notificationIconProps}>
        <path d="M21 12a8 8 0 0 1-8 8H7l-4 2 1.4-4.2A8 8 0 1 1 21 12Z" />
        <path d="M8 12h.01M12 12h.01M16 12h.01" />
      </svg>
    )
  }
  if (name === 'mention') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" {...notificationIconProps}>
        <path d="M16 8v5a3 3 0 1 1-1.1-2.3" />
        <path d="M16 13a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8" />
      </svg>
    )
  }
  if (name === 'play') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" {...notificationIconProps}>
        <path d="M8 5v14l11-7Z" />
      </svg>
    )
  }
  if (name === 'stop') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" {...notificationIconProps}>
        <rect x="6" y="6" width="12" height="12" rx="2" />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...notificationIconProps}>
      <path d="M18 9a6 6 0 1 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
      <path d="M10 21a2 2 0 0 0 4 0" />
    </svg>
  )
}

function formatRelativeTime(iso: string, language: AppLanguage = 'ko'): string {
  const now = Date.now()
  const ts = new Date(iso).getTime()
  const diff = Math.max(0, now - ts)
  const sec = Math.floor(diff / 1000)
  if (sec < 60) return t(language, 'common.secondsAgo', { n: sec })
  const min = Math.floor(sec / 60)
  if (min < 60) return t(language, 'common.minutesAgo', { n: min })
  const hr = Math.floor(min / 60)
  if (hr < 24) return t(language, 'common.hoursAgo', { n: hr })
  const days = Math.floor(hr / 24)
  if (days < 7) return t(language, 'common.daysAgo', { n: days })
  // 1주 이상은 날짜
  const d = new Date(iso)
  return `${d.getMonth() + 1}/${d.getDate()}`
}


// 알림 제목·본문 번역은 서비스 워커(푸시)와 공유한다 — 같은 문구가 두 곳에서
// 다르게 번역되지 않도록 lib/notificationText 한 곳에 모아 둔다
const translateNotiTitle = translateNotificationText

export function NotificationCenter({
  language = 'ko',
  userId,
  userName,
  onClose,
  notifications,
  markRead,
  markAllRead,
  clearReadNotifications,
}: {
  language?: AppLanguage
  userId: number | null
  userName?: string | null
  onClose: () => void
  notifications: AppNotification[]
  markRead: (id: number) => Promise<void>
  markAllRead: () => Promise<void>
  clearReadNotifications?: () => Promise<void>
}) {
  const navigate = useNavigate()
  const location = useLocation()
  const { chats: userChats } = useUserChats(userId, userName ?? null, { realtime: false })

  const chatInfoMap = new Map<number, { title: string; participantCount: number; eventDate: string; eventTime: string | null }>()
  userChats.forEach((c) =>
    chatInfoMap.set(c.eventId, { title: c.eventTitle, participantCount: c.participantCount, eventDate: c.eventDate, eventTime: c.eventTime })
  )

  // 카톡 스타일: 채팅 알림 그룹화, 나머지는 그대로
  const { groups: chatGroups, others } = groupChatNotifications(notifications)

  // 표시 순서: 채팅 그룹 → 기타 알림 (안 읽음 우선)
  const unreadOthers = others.filter((n) => !n.isRead)
  const readOthers = others.filter((n) => n.isRead)
  const unreadChatGroups = chatGroups.filter((g) => g.unreadCount > 0)
  const readChatGroups = chatGroups.filter((g) => g.unreadCount === 0)

  const totalUnread =
    unreadOthers.length + chatGroups.reduce((sum, g) => sum + g.unreadCount, 0)
  const hasAny = notifications.length > 0

  async function handleClickItem(n: AppNotification) {
    // 읽음 처리 — 백그라운드 (await 없이 낙관적 반영)
    if (!n.isRead) void markRead(n.id)

    // chat/mention 타입은 globalChatModal 이벤트로 처리
    if (n.type === 'chat' || n.type === 'mention') {
      const eventId = extractEventIdFromLink(n.link)
      if (eventId) {
        const info = chatInfoMap.get(eventId)
        onClose()
        window.dispatchEvent(new CustomEvent('app:open-event-chat', {
          detail: {
            eventId,
            eventTitle: info?.title ?? n.title ? translateNotiTitle(n.title, language) : t(language, 'calendar.chatRoomTitle'),
            eventDate: info?.eventDate ?? '',
            eventTime: info?.eventTime ?? null,
          },
        }))
        return
      }
    }

    onClose()
    const targetLink = resolveNotificationLink(n)
    if (targetLink) {
      navigate(targetLink, targetLink.includes('openEvent=')
        ? { state: eventDetailNavigationState(location) }
        : undefined)
    }
  }

  async function handleClickChatGroup(group: ChatGroup) {
    // 그룹 내 안 읽음 모두 읽음 처리 (백그라운드)
    const unreadIds = group.notifications.filter((n) => !n.isRead).map((n) => n.id)
    void Promise.all(unreadIds.map((id) => markRead(id)))
    onClose()
    // globalChatModal 이벤트 dispatch (AppHeader 에서 수신)
    const info = chatInfoMap.get(group.eventId)
    window.dispatchEvent(new CustomEvent('app:open-event-chat', {
      detail: {
        eventId: group.eventId,
        eventTitle: info?.title ?? t(language, 'calendar.chatRoomTitle'),
        eventDate: info?.eventDate ?? '',
        eventTime: info?.eventTime ?? null,
      },
    }))
  }

  return (
    <div
      className="header-action-panel-backdrop"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 50000,
        background: 'rgba(26,26,24,0.28)',
      }}
      onClick={onClose}
    >
      <div
        className="header-action-panel"
        style={{
          position: 'absolute',
          top: 'calc(8px + var(--safe-top, env(safe-area-inset-top, 0px)))',
          left: '50%',
          transform: 'translateX(-50%)',
          width: 'calc(100% - 16px)',
          maxWidth: 480,
          maxHeight: 'calc(100% - 16px - var(--safe-top, env(safe-area-inset-top, 0px)) - var(--safe-bottom, env(safe-area-inset-bottom, 0px)))',
          background: 'var(--bg)',
          border: '1px solid var(--line)',
          borderRadius: 14,
          boxShadow: '0 16px 48px rgba(0,0,0,0.18)',
          display: 'flex',
          flexDirection: 'column',
          boxSizing: 'border-box',
          overflow: 'hidden',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 16px', borderBottom: '1px solid var(--line)',
        }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ fontSize: 17, fontWeight: 700, color: 'var(--ink)', letterSpacing: '-0.01em' }}>{t(language, 'header.notifications')}</span>
            {totalUnread > 0 && (
              <span style={{
                fontSize: 11.5, fontWeight: 700,
                color: 'var(--status-danger)',
                background: 'var(--status-danger-bg)',
                borderRadius: 999, padding: '2px 9px',
                fontVariantNumeric: 'tabular-nums',
              }}>{totalUnread}</span>
            )}
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {totalUnread > 0 && (
              <button
                onClick={markAllRead}
                style={{
                  height: 28, minHeight: 28, padding: '0 10px',
                  borderRadius: 8, border: '1px solid var(--line-2)',
                  background: 'var(--surface)', color: 'var(--text)',
                  fontSize: 12, fontWeight: 600, cursor: 'pointer',
                }}
                type="button"
              >{t(language, 'header.markAllRead')}</button>
            )}
            <button
              onClick={onClose}
              style={{
                width: 30, height: 30, minHeight: 30,
                background: 'transparent', border: 'none',
                color: 'var(--text)', cursor: 'pointer',
                display: 'grid', placeItems: 'center',
                borderRadius: 8,
              }}
              aria-label={msg('닫기')}
              type="button"
            >
              <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                <line x1="6" y1="6" x2="18" y2="18" />
                <line x1="18" y1="6" x2="6" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        {/* 본문 */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 12px', display: 'flex', flexDirection: 'column', gap: 2 }}>
          {!userId ? (
            <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--muted)' }}>
              <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>{t(language, 'header.notiLoginTitle')}</p>
              <p style={{ margin: '6px 0 0', fontSize: 12.5 }}>{t(language, 'header.notiLoginDesc')}</p>
            </div>
          ) : !hasAny ? (
            <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--muted)' }}>
              <p style={{ margin: 0, fontSize: 14 }}>{t(language, 'header.notiEmpty')}</p>
            </div>
          ) : (
            <>
              {(unreadOthers.length > 0 || unreadChatGroups.length > 0) && (
                <>
                  <span style={{
                    fontSize: 12, fontWeight: 600, color: 'var(--muted)',
                    padding: '0 4px 6px',
                  }}>{t(language, 'header.newNoti')}</span>
                  {unreadChatGroups.map((g) => (
                    <ChatGroupItem
                      key={`chatgroup-${g.eventId}`}
                      group={g}
                      info={chatInfoMap.get(g.eventId)}
                      language={language}
                      onClick={handleClickChatGroup}
                    />
                  ))}
                  {unreadOthers.map((n) => (
                    <NotificationItem key={n.id} notification={n} language={language} onClick={handleClickItem} />
                  ))}
                </>
              )}
              {(readOthers.length > 0 || readChatGroups.length > 0) && (
                <>
                  <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '12px 4px 6px',
                  }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)' }}>
                      {t(language, 'header.oldNoti')}
                    </span>
                    {clearReadNotifications && (
                      <button
                        onClick={clearReadNotifications}
                        type="button"
                        style={{
                          height: 24, padding: '0 8px',
                          borderRadius: 6, border: '1px solid var(--line-2)',
                          background: 'var(--surface)', color: 'var(--muted)',
                          fontSize: 11.5, fontWeight: 600, cursor: 'pointer',
                          lineHeight: 1,
                        }}
                      >{t(language, 'header.clearOldNoti')}</button>
                    )}
                  </div>
                  {readChatGroups.map((g) => (
                    <ChatGroupItem
                      key={`chatgroup-${g.eventId}`}
                      group={g}
                      info={chatInfoMap.get(g.eventId)}
                      language={language}
                      onClick={handleClickChatGroup}
                    />
                  ))}
                  {readOthers.map((n) => (
                    <NotificationItem key={n.id} notification={n} language={language} onClick={handleClickItem} />
                  ))}
                </>
              )}
            </>
          )}
        </div>
      </div>

    </div>
  )
}

function ChatGroupItem({
  group,
  info,
  language = 'ko',
  onClick,
}: {
  group: ChatGroup
  info?: { title: string; participantCount: number }
  language?: AppLanguage
  onClick: (group: ChatGroup) => void
}) {
  const meta = TYPE_LABEL.chat
  const eventTitle = info?.title ?? t(language, 'calendar.chatRoomTitle')
  const participantCount = info?.participantCount ?? 0
  const isAllRead = group.unreadCount === 0
  // 최신 메시지 body 에서 author 분리: "author: content" 형태
  const latestBody = group.latest.body ?? ''
  return (
    <button
      className={`notification-row${isAllRead ? '' : ' notification-row--unread'}`}
      onClick={() => onClick(group)}
      type="button"
    >
      <div className="notification-row__icon notification-row__icon--dark">
        <NotificationIcon name={meta.icon} />
      </div>
      <div className="notification-row__content">
        <div className="notification-row__top">
          <div className="notification-row__title-wrap">
            {group.unreadCount > 0 && (
              <span className="notification-row__unread-dot" />
            )}
            <span className="notification-row__title">{eventTitle}</span>
          </div>
          {participantCount > 0 && (
            <span className="notification-row__side-meta">{t(language, 'common.nPeople', { n: participantCount })}</span>
          )}
        </div>
        {latestBody && (
          <span className="notification-row__body">{latestBody}</span>
        )}
        <span className="notification-row__time">
          {formatRelativeTime(group.latest.createdAt, language)}
        </span>
      </div>
      {group.unreadCount > 0 && (
        <span className="notification-row__badge">
          {group.unreadCount > 99 ? '99+' : group.unreadCount}
        </span>
      )}
    </button>
  )
}

function NotificationItem({
  notification: n,
  language = 'ko',
  onClick,
}: {
  notification: AppNotification
  language?: AppLanguage
  onClick: (n: AppNotification) => void
}) {
  const meta = TYPE_LABEL[n.type] ?? { icon: 'bell' as const, color: 'var(--text)', bg: 'var(--tint)' }
  const isChat = n.type === 'chat'

  return (
    <button
      className={`notification-row${n.isRead ? '' : ' notification-row--unread'}`}
      onClick={() => onClick(n)}
      type="button"
    >
      <div className={`notification-row__icon${isChat ? ' notification-row__icon--dark' : ''}`}>
        <NotificationIcon name={meta.icon} />
      </div>
      <div className="notification-row__content">
        <div className="notification-row__top">
          <div className="notification-row__title-wrap">
          {!n.isRead && (
            <span className="notification-row__unread-dot" />
          )}
          <span className="notification-row__title">
            {translateNotiTitle(n.title ?? '', language)}
          </span>
          </div>
        </div>
        {n.body && (
          <span className="notification-row__body">{translateNotificationText(n.body, language)}</span>
        )}
        <span className="notification-row__time">
          {formatRelativeTime(n.createdAt, language)}
        </span>
      </div>
    </button>
  )
}
