// 글로벌 채팅 목록 모달 (헤더 💬 클릭 시 슬라이드 다운)
// 메시지 미리보기 X (사생활 보호 결정)
import { useState, type ComponentProps } from 'react'
import { chatDisabled } from '../lib/chatRetirement'
import { t, formatPeriod, weekdayShortLabels } from '../i18n'
import type { AppLanguage } from '../i18n'
import { useUserChats, type UserChat } from '../hooks/useUserChats'
import type { Role } from '../types'
import { ChatRoom } from './ChatRoom'
import type { MentionUser } from './CommentSection'

function formatChatDate(iso: string | null, eventDate: string, language: AppLanguage = 'ko'): string {
  if (!iso) {
    // 메시지 없으면 일정 날짜
    const d = new Date(eventDate)
    return `${d.getMonth() + 1}/${d.getDate()}`
  }
  const ts = new Date(iso).getTime()
  const now = Date.now()
  const diff = Math.max(0, now - ts)
  const sec = Math.floor(diff / 1000)
  if (sec < 60) return t(language, 'common.justNow')
  const min = Math.floor(sec / 60)
  if (min < 60) return t(language, 'common.minutesAgo', { n: min })
  const hr = Math.floor(min / 60)
  if (hr < 24) {
    const d = new Date(iso)
    const h = d.getHours()
    const period = formatPeriod(language, h)
    return `${period} ${h % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')}`
  }
  const d = new Date(iso)
  return `${d.getMonth() + 1}/${d.getDate()}`
}

function formatEventLabel(eventDate: string, eventTime: string | null, language: AppLanguage = 'ko'): string {
  const d = new Date(eventDate)
  const weekdays = weekdayShortLabels[language]
  const dateLabel = `${d.getMonth() + 1}/${d.getDate()} (${weekdays[d.getDay()]})`
  return eventTime ? `${dateLabel} ${eventTime}` : dateLabel
}

function ChatEmptyIcon() {
  return (
    <span className="header-action-panel__empty-icon" aria-hidden="true">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
        <path
          d="M5.5 16.5L4 20l4-1.4c1.1.5 2.4.8 3.8.8 4.4 0 8-2.9 8-6.7S16.2 6 11.8 6 4 8.9 4 12.7c0 1.4.5 2.7 1.5 3.8Z"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M8.5 12.7h.01M12 12.7h.01M15.5 12.7h.01"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
        />
      </svg>
    </span>
  )
}

export function GlobalChatModal(props: ComponentProps<typeof EnabledGlobalChatModal>) {
  return chatDisabled() ? null : <EnabledGlobalChatModal {...props} />
}

function EnabledGlobalChatModal({
  language = 'ko',
  userId,
  userName,
  role = 'user',
  users = [],
  selectedChat: controlledSelectedChat,
  onSelectChat,
  onBackToList,
  onClose,
  onChatRead,
}: {
  language?: string
  userId: number | null
  userName: string
  role?: Role
  users?: MentionUser[]
  selectedChat?: Pick<UserChat, 'eventId' | 'eventTitle' | 'eventDate' | 'eventTime'> | null
  onSelectChat?: (chat: Pick<UserChat, 'eventId' | 'eventTitle' | 'eventDate' | 'eventTime'>) => void
  onBackToList?: () => void
  onClose: () => void
  onChatRead?: (eventId: number) => void
}) {
  const lang = (language ?? 'ko') as AppLanguage
  const [localSelectedChat, setLocalSelectedChat] = useState<UserChat | null>(null)
  const [pastExpanded, setPastExpanded] = useState(false)
  const { activeChats, lockedChats, loading, markAllChatsRead, totalUnread } = useUserChats(userId, userName, { realtime: false })
  const selectedChat = controlledSelectedChat ?? localSelectedChat

  const handleClick = (chat: UserChat) => {
    const next = {
      eventId: chat.eventId,
      eventTitle: chat.eventTitle,
      eventDate: chat.eventDate,
      eventTime: chat.eventTime,
    }
    if (onSelectChat) onSelectChat(next)
    else setLocalSelectedChat(chat)
  }

  const handleBackToList = () => {
    if (onBackToList) onBackToList()
    else setLocalSelectedChat(null)
  }

  const mentionUsers = users.length > 0
    ? users
    : userId
      ? [{ id: userId, name: userName, role }]
      : []

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
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0, flex: 1 }}>
            {selectedChat && (
              <button
                aria-label="채팅 목록으로 돌아가기"
                onClick={handleBackToList}
                style={{
                  width: 30, height: 30, minHeight: 30, borderRadius: 8,
                  border: 'none', background: 'transparent',
                  color: 'var(--text)', cursor: 'pointer',
                  display: 'grid', placeItems: 'center', padding: 0,
                  marginLeft: -8,
                }}
                type="button"
              >
                <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="15 6 9 12 15 18" />
                </svg>
              </button>
            )}
            <span style={{ fontSize: 17, fontWeight: 700, color: 'var(--ink)', letterSpacing: '-0.01em' }}>
              {selectedChat ? selectedChat.eventTitle || t(lang, 'chat.chatRoom') : t(lang, 'chat.title')}
            </span>
            {!selectedChat && (
              <span style={{ fontSize: 13, color: 'var(--muted)' }}>{t(lang, 'header.chatSubtitle')}</span>
            )}
            {selectedChat && (
              <span style={{
                fontSize: 12, color: 'var(--muted)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {formatEventLabel(selectedChat.eventDate, selectedChat.eventTime, lang)}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
            {!selectedChat && totalUnread > 0 && (
              <button
                onClick={markAllChatsRead}
                style={{
                  height: 28, padding: '0 10px',
                  background: 'transparent', border: '1px solid var(--line-2, var(--line))',
                  color: 'var(--text)', cursor: 'pointer',
                  borderRadius: 6, fontSize: 12, fontWeight: 600,
                }}
                type="button"
              >{t(lang, 'header.markAllRead')}</button>
            )}
            <button
              onClick={onClose}
              style={{
                width: 30, height: 30, minHeight: 30,
                background: 'transparent', border: 'none',
                color: 'var(--text)', cursor: 'pointer',
                display: 'grid', placeItems: 'center',
                borderRadius: 8, flexShrink: 0,
              }}
              aria-label="닫기"
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
        <div
          className={`header-action-panel__body${selectedChat ? ' header-action-panel__body--chat' : ''}`}
          style={{ flex: 1, overflowY: selectedChat ? 'hidden' : 'auto' }}
        >
          {selectedChat ? (
            <ChatRoom
              canAccess
              compact
              currentUserId={userId}
              currentVisitor={userName}
              eventId={selectedChat.eventId}
              eventTitle={selectedChat.eventTitle || formatEventLabel(selectedChat.eventDate, selectedChat.eventTime, lang)}
              language={lang}
              role={role}
              users={mentionUsers}
              onRead={onChatRead}
            />
          ) : !userId ? (
            <div className="header-action-panel__empty" style={{ padding: '60px 20px', textAlign: 'center', color: '#94a3b8' }}>
              <ChatEmptyIcon />
              <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: '#475569' }}>{t(lang, 'header.notiLoginTitle')}</p>
              <p style={{ margin: '6px 0 0', fontSize: 12 }}>{t(lang, 'header.notiLoginDesc')}</p>
            </div>
          ) : loading && activeChats.length === 0 && lockedChats.length === 0 && (
            <div style={{ padding: '40px 20px', textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>
              {t(lang, 'common.loading')}
            </div>
          )}

          {!selectedChat && userId && !loading && activeChats.length === 0 && lockedChats.length === 0 && (
            <div className="header-action-panel__empty" style={{ padding: '60px 20px', textAlign: 'center', color: '#94a3b8' }}>
              <ChatEmptyIcon />
              <p style={{ margin: 0, fontSize: 14 }}>{t(lang, 'header.chatEmpty')}</p>
              <p style={{ margin: '6px 0 0', fontSize: 12 }}>{t(lang, 'header.chatEmptyDesc')}</p>
            </div>
          )}

          {/* 활성 채팅 */}
          {!selectedChat && activeChats.length > 0 && (
            <div>
              <p style={{
                margin: 0, padding: '4px 8px 6px', fontSize: 12, fontWeight: 600,
                color: 'var(--muted)',
              }}>{t(lang, 'header.chatActive')}</p>
              {activeChats.map((chat) => (
                <ChatRow key={chat.eventId} chat={chat} language={lang} onClick={handleClick} />
              ))}
            </div>
          )}

          {/* 이전 대화 — 기본 접힘 */}
          {!selectedChat && lockedChats.length > 0 && (
            <div>
              <button
                onClick={() => setPastExpanded((v) => !v)}
                type="button"
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  width: '100%', padding: '12px 8px 6px',
                  background: 'transparent', border: 'none',
                  cursor: 'pointer', textAlign: 'left',
                }}
              >
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', flex: 1 }}>
                  {t(lang, 'header.chatPast')} ({lockedChats.length})
                </span>
                <svg
                  width={14} height={14} viewBox="0 0 24 24" fill="none"
                  stroke="var(--muted)" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"
                  style={{ transition: 'transform 0.2s', transform: pastExpanded ? 'rotate(180deg)' : 'rotate(0deg)' }}
                >
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
              {pastExpanded && lockedChats.map((chat) => (
                <ChatRow key={chat.eventId} chat={chat} language={lang} onClick={handleClick} />
              ))}
            </div>
          )}
        </div>
      </div>

    </div>
  )
}

function ChatRow({ chat, language = 'ko', onClick }: { chat: UserChat; language?: AppLanguage; onClick: (c: UserChat) => void }) {
  const isUnread = chat.unreadCount > 0
  const isLocked = chat.isLocked
  const initial = (chat.eventTitle || chat.eventDate)?.slice(0, 1) ?? '?'

  return (
    <button
      onClick={() => onClick(chat)}
      style={{
        display: 'flex', gap: 12, alignItems: 'center',
        width: '100%', padding: '12px 10px',
        background: isUnread ? 'rgba(26,26,24,0.04)' : 'transparent',
        border: 'none', borderRadius: 10,
        cursor: 'pointer', textAlign: 'left',
        minHeight: 0,
      }}
      type="button"
    >
      <span style={{
        width: isLocked ? 32 : 36, height: isLocked ? 32 : 36,
        borderRadius: '50%',
        background: isLocked ? 'var(--tint)' : 'var(--ink)',
        color: isLocked ? 'var(--muted)' : '#fff',
        display: 'grid', placeItems: 'center',
        fontSize: isLocked ? 12 : 13, fontWeight: 700, flexShrink: 0,
      }}>{initial}</span>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
        <div style={{
          display: 'flex', alignItems: 'baseline', gap: 8, justifyContent: 'space-between',
        }}>
          <span style={{
            fontSize: 14, fontWeight: isLocked ? 500 : 600,
            color: isLocked ? 'var(--muted)' : 'var(--ink)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1,
          }}>{chat.eventTitle || formatEventLabel(chat.eventDate, chat.eventTime, language)}</span>
          <span style={{ fontSize: 12, color: 'var(--muted)', flexShrink: 0 }}>
            {formatChatDate(chat.lastMessageAt, chat.eventDate, language)}
          </span>
        </div>
        <span style={{
          fontSize: 12, color: 'var(--muted)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {formatEventLabel(chat.eventDate, chat.eventTime, language)} · {t(language, 'common.nPeople', { n: chat.participantCount })}
        </span>
      </div>
      {isUnread && (
        <span style={{
          minWidth: 18, padding: '2px 6px', borderRadius: 99,
          background: 'var(--status-danger)', color: '#fff',
          fontSize: 10, fontWeight: 700,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          fontVariantNumeric: 'tabular-nums', flexShrink: 0,
        }}>
          {chat.unreadCount > 99 ? '99+' : chat.unreadCount}
        </span>
      )}
    </button>
  )
}
