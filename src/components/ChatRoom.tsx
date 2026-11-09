import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { showToast } from '../lib/toast'
import { confirmDialog } from '../lib/confirm'
import { getAuthToken } from '../lib/authToken'
import { getActiveChatEventId, setActiveChatEventId } from '../lib/activeChat'
import { t, type AppLanguage, currentLang } from '../i18n'
import type { MentionUser } from './CommentSection'
import type { Role } from '../types'
import { LinkifiedText } from './LinkifiedText'
import { msg } from '../lib/msg'
import { chatDisabled } from '../lib/chatRetirement'

type ChatMessage = {
  id: number
  event_id: number
  author_id: number | null
  author_name: string
  message_type: 'text' | 'image' | 'system'
  content: string | null
  image_url: string | null
  image_expired?: boolean
  mention_ids: number[] | null
  mention_names: string[] | null
  created_at: string
  deleted_at: string | null
}

type ChatRoomProps = {
  eventId: number
  eventTitle: string
  currentVisitor: string
  currentUserId?: number | null
  users?: MentionUser[]
  compact?: boolean
  canAccess?: boolean
  role?: Role
  language?: AppLanguage
  onRead?: (eventId: number) => void
}

function getMentionQuery(value: string) {
  const match = value.match(/(^|\s)@([^\s@]*)$/)
  return match ? match[2] : null
}

function insertMention(value: string, userName: string) {
  return value.replace(/(^|\s)@([^\s@]*)$/, `$1@${userName} `)
}

function getMentionPayload(value: string, users: MentionUser[]) {
  const mentioned = users.filter((user) => value.includes(`@${user.name}`))
  return {
    ids: mentioned.map((user) => user.id),
    names: mentioned.map((user) => user.name),
  }
}

function formatChatTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function createUploadPath(eventId: number, file: File) {
  const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg'
  const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `event-${eventId}/${id}.${ext}`
}

function translateSystemContent(content: string, language: AppLanguage): string {
  if (language === 'ko') return content
  const zh = language === 'zh'
  if (content === '채팅방이 생성되었습니다.') return zh ? '聊天室已创建。' : 'Chat room created.'
  const matchJoin = content.match(/^(.+)님이 합류했습니다\.$/)
  if (matchJoin) return zh ? `${matchJoin[1]} 已加入。` : `${matchJoin[1]} joined.`
  const matchLeft = content.match(/^(.+)님이 나갔습니다\.$/)
  if (matchLeft) return zh ? `${matchLeft[1]} 已离开。` : `${matchLeft[1]} left.`
  return content
}

export function ChatRoom(props: ChatRoomProps) {
  return chatDisabled() ? null : <EnabledChatRoom {...props} />
}

function EnabledChatRoom({
  eventId,
  eventTitle,
  currentVisitor,
  currentUserId,
  users = [],
  compact = false,
  canAccess = true,
  role = 'user',
  language = 'ko',
  onRead,
}: ChatRoomProps) {
  const lang = language
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(false)
  const [missingTable, setMissingTable] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [selectMode, setSelectMode] = useState(false)
  const [selectedMessageIds, setSelectedMessageIds] = useState<Set<number>>(new Set())
  const [isMuted, setIsMuted] = useState(false)
  const [muteBusy, setMuteBusy] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const atBottomRef = useRef(true)
  const lastMessageIdRef = useRef<number | null>(null)

  // 자동 스크롤: 사용자가 맨 아래 근처거나 본인이 보낸 메시지일 때만
  useEffect(() => {
    const el = messagesContainerRef.current
    if (!el || messages.length === 0) return
    const last = messages[messages.length - 1]
    const isNewMessage = last.id !== lastMessageIdRef.current
    const isInitialLoad = lastMessageIdRef.current === null
    const isMine = last.author_name === currentVisitor
    if (isNewMessage && (isInitialLoad || atBottomRef.current || isMine)) {
      // 다음 프레임에 스크롤 (DOM 갱신 후)
      requestAnimationFrame(() => {
        el.scrollTop = el.scrollHeight
      })
    }
    lastMessageIdRef.current = last.id
  }, [messages, currentVisitor])

  // 음소거 상태 로드 (event_id + 본인)
  useEffect(() => {
    if (!currentUserId) { setIsMuted(false); return }
    let cancelled = false
    void supabase
      .from('chat_room_mutes')
      .select('event_id')
      .eq('event_id', eventId)
      .eq('user_id', currentUserId)
      .maybeSingle()
      .then(({ data }) => { if (!cancelled) setIsMuted(!!data) })
    return () => { cancelled = true }
  }, [eventId, currentUserId])

  const toggleMute = async () => {
    if (!currentUserId || muteBusy) return
    setMuteBusy(true)
    const next = !isMuted
    setIsMuted(next) // 낙관적 업데이트
    try {
      if (next) {
        const { error } = await supabase
          .from('chat_room_mutes')
          .upsert({ event_id: eventId, user_id: currentUserId }, { onConflict: 'event_id,user_id' })
        if (error) throw error
        showToast(msg('이 채팅방 알림을 껐어요'), 'info')
      } else {
        const { error } = await supabase
          .from('chat_room_mutes')
          .delete()
          .eq('event_id', eventId)
          .eq('user_id', currentUserId)
        if (error) throw error
        showToast(msg('이 채팅방 알림을 다시 받아요'), 'info')
      }
    } catch (err) {
      console.warn('채팅 음소거 토글 실패:', err)
      setIsMuted(!next) // 롤백
      showToast(msg('알림 설정 변경에 실패했어요'), 'error')
    } finally {
      setMuteBusy(false)
    }
  }

  const handleMessagesScroll = () => {
    const el = messagesContainerRef.current
    if (!el) return
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight
    atBottomRef.current = distance < 100
  }

  const mentionQuery = getMentionQuery(draft)
  const mentionSuggestions = useMemo(() => {
    if (mentionQuery === null) return []
    return users
      .filter((user) => user.name !== currentVisitor && user.name.includes(mentionQuery))
      .slice(0, 6)
  }, [currentVisitor, mentionQuery, users])

  const fetchMessages = async () => {
    if (!canAccess) {
      setMessages([])
      setLoading(false)
      return
    }
    setLoading(true)
    const token = getAuthToken()
    let data: ChatMessage[] | null = null
    let error: unknown = null

    if (token) {
      const rpcResult = await supabase.rpc('get_chat_messages', {
        p_token: token,
        p_event_id: eventId,
      })
      if (rpcResult.error) {
        console.warn('채팅 메시지 RPC 조회 실패:', rpcResult.error)
        error = rpcResult.error
      } else {
        data = (rpcResult.data as ChatMessage[]) ?? []
        error = null
      }
    }

    if (error || !data) {
      console.warn('채팅 메시지를 불러오지 못했습니다. chat_messages 테이블이 아직 없을 수 있습니다.', error)
      setMissingTable(true)
      setMessages([])
      setLoading(false)
      return
    }

    setMissingTable(false)
    setMessages(data)
    setLoading(false)
  }

  // 읽음 처리 (진입 시 + 이탈 시)
  const markChatRead = async () => {
    if (!canAccess) return
    const token = getAuthToken()
    if (!token) return
    await supabase.rpc('update_chat_read', {
      p_token: token,
      p_event_id: eventId,
    })
  }

  useEffect(() => {
    const syncActiveChat = () => {
      if (document.hidden || !canAccess) {
        if (getActiveChatEventId() === eventId) setActiveChatEventId(null)
        return
      }
      setActiveChatEventId(eventId)
    }

    syncActiveChat()
    void fetchMessages()
    void markChatRead() // 진입 시 즉시 읽음 처리 (DB)
    onRead?.(eventId)    // 부모 뱃지 낙관적 즉시 반영

    const refreshActiveChat = () => {
      if (document.hidden) return
      void fetchMessages()
      void markChatRead()
    }

    const channel = supabase
      .channel(`chat_signal:${eventId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'chat_message_signals',
          filter: `event_id=eq.${eventId}`,
        },
        refreshActiveChat,
      )
      .subscribe()

    const interval = window.setInterval(refreshActiveChat, 15_000)
    document.addEventListener('visibilitychange', refreshActiveChat)
    document.addEventListener('visibilitychange', syncActiveChat)

    return () => {
      void supabase.removeChannel(channel)
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', refreshActiveChat)
      document.removeEventListener('visibilitychange', syncActiveChat)
      if (getActiveChatEventId() === eventId) setActiveChatEventId(null)
      void markChatRead() // 이탈 시 한 번 더 (안전)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId])

  const sendTextMessage = async () => {
    if (!canAccess) {
      showToast(t(lang, 'chat.accessError'), 'error')
      return
    }
    const content = draft.trim()
    if (!content) return

    const token = getAuthToken()
    if (!token) {
      showToast(t(lang, 'chat.accessError'), 'error')
      return
    }

    const mentions = getMentionPayload(content, users)

    const { error } = await supabase.rpc('send_chat_message', {
      p_token: token,
      p_event_id: eventId,
      p_content: content,
      p_mention_ids: mentions.ids,
      p_mention_names: mentions.names,
    })

    if (error) {
      console.error('send_chat_message RPC 실패', error)
      // FK 위반 = 삭제된 일정 or 참여 오류
      const text = (() => {
        const m = (error as { message?: string }).message ?? ''
        if (m.includes('foreign key') || m.includes('violates')) return t(currentLang(), 'chat.accessError')
        if (m.includes('참여자가 아닙니다')) return msg('채팅방 참여자만 메시지를 보낼 수 있습니다.')
        if (m.includes('잠겼습니다')) return m
        return msg('메시지를 보내지 못했습니다.')
      })()
      showToast(text, 'error')
      return
    }

    setDraft('')
    await fetchMessages()
  }

  const uploadPhoto = async (file: File) => {
    if (!canAccess) {
      showToast(t(lang, 'chat.accessError'), 'error')
      return
    }
    if (!file.type.startsWith('image/')) {
      showToast(t(lang, 'chat.accessError'), 'error')
      return
    }

    const token = getAuthToken()
    if (!token) {
      showToast(t(lang, 'chat.accessError'), 'error')
      return
    }

    setUploading(true)
    const path = createUploadPath(eventId, file)
    const { error: uploadError } = await supabase.storage
      .from('chat-attachments')
      .upload(path, file, { cacheControl: '3600', contentType: file.type, upsert: false })

    if (uploadError) {
      console.error('사진 업로드 실패', uploadError)
      showToast(msg('사진을 업로드하지 못했습니다. chat-attachments Storage 버킷을 확인해 주세요.'), 'error')
      setUploading(false)
      return
    }

    const { data } = supabase.storage.from('chat-attachments').getPublicUrl(path)
    const caption = draft.trim() || null
    const captionMentions = caption ? getMentionPayload(caption, users) : { ids: [], names: [] }

    const { error } = await supabase.rpc('send_chat_image', {
      p_token: token,
      p_event_id: eventId,
      p_image_url: data.publicUrl,
      p_caption: caption,
      p_mention_ids: captionMentions.ids,
      p_mention_names: captionMentions.names,
    })

    if (error) {
      console.error('send_chat_image RPC 실패', error)
      const { error: removeError } = await supabase.storage.from('chat-attachments').remove([path])
      if (removeError) {
        console.warn('사진 메시지 저장 실패 후 업로드 파일 정리에 실패했습니다.', removeError)
      }
      showToast(error.message ?? msg('사진 메시지를 저장하지 못했습니다.'), 'error')
      setUploading(false)
      return
    }

    setDraft('')
    setUploading(false)
    await fetchMessages()
  }

  const canDeleteMessage = (message: ChatMessage) => {
    if (message.message_type === 'system') return false
    if (role === 'leader' || role === 'admin' || role === 'developer') return true
    if (message.author_id !== currentUserId && message.author_name !== currentVisitor) return false
    return Date.now() - new Date(message.created_at).getTime() <= 5 * 60 * 1000
  }

  const deleteMessage = async (message: ChatMessage) => {
    const token = getAuthToken()
    if (!token) {
      showToast(msg('로그인 정보가 만료되었습니다. 다시 로그인해주세요.'), 'error')
      return
    }

    const { error } = await supabase.rpc('delete_chat_message', {
      p_token: token,
      p_message_id: message.id,
    })

    if (error) {
      showToast(error.message ?? msg('메시지를 삭제하지 못했습니다.'), 'error')
      return
    }

    await fetchMessages()
  }

  const selectableMessages = messages.filter(canDeleteMessage)
  const selectedMessages = messages.filter((message) => selectedMessageIds.has(message.id) && canDeleteMessage(message))
  const enterSelectMode = () => {
    if (selectableMessages.length === 0) {
      showToast(t(lang, 'chat.noDeleteable'), 'info')
      return
    }
    setSelectedMessageIds(new Set())
    setSelectMode(true)
  }
  const cancelSelectMode = () => {
    setSelectedMessageIds(new Set())
    setSelectMode(false)
  }
  const toggleMessageSelected = (message: ChatMessage) => {
    if (!canDeleteMessage(message)) return
    setSelectedMessageIds((current) => {
      const next = new Set(current)
      if (next.has(message.id)) next.delete(message.id)
      else next.add(message.id)
      return next
    })
  }
  const deleteSelectedMessages = async () => {
    if (selectedMessages.length === 0) return
    const confirmed = await confirmDialog({ message: t(lang, 'chat.deleteConfirm', { n: selectedMessages.length }), danger: true, confirmLabel: msg('삭제') })
    if (!confirmed) return
    for (const message of selectedMessages) {
      await deleteMessage(message)
    }
    cancelSelectMode()
    await fetchMessages()
  }

  if (missingTable) {
    return (
      <section className={`chat-room${compact ? ' chat-room--compact' : ''}`}>
        <div className="chat-empty">
          {t(lang, 'chat.cannotLoad')}<br />
          <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--muted-2)' }}>
            {msg('Supabase 에 V1+ 채팅 SQL 미적용 또는 권한 문제')}
          </span>
        </div>
      </section>
    )
  }

  if (!canAccess) {
    return (
      <section className={`chat-room${compact ? ' chat-room--compact' : ''}`}>
        <div className="chat-empty">{t(lang, 'chat.noAccess')}</div>
      </section>
    )
  }

  return (
    <section className={`chat-room${compact ? ' chat-room--compact' : ''}`}>
      <div className="chat-room__head">
        <div>
          <strong>{t(lang, 'chat.title')}</strong>
          <span>{eventTitle}</span>
        </div>
        {selectMode ? (
          <div className="chat-select-actions">
            <button onClick={cancelSelectMode} type="button">{t(lang, 'common.cancel')}</button>
            <em>{t(lang, 'chat.selectCount', { n: selectedMessages.length })}</em>
            <button disabled={selectedMessages.length === 0} onClick={deleteSelectedMessages} type="button">{t(lang, 'common.delete')}</button>
          </div>
        ) : (
          <div className="chat-room__tools">
            <em>{t(lang, 'chat.countMsg', { n: messages.length })}</em>
            {currentUserId != null && (
              <button
                className={`chat-mute-btn${isMuted ? ' is-muted' : ''}`}
                aria-label={isMuted ? msg('알림 켜기') : msg('알림 끄기')}
                title={isMuted ? msg('이 채팅방 알림이 꺼져 있어요') : msg('이 채팅방 알림 끄기')}
                onClick={toggleMute}
                disabled={muteBusy}
                type="button"
              >
                {/* 이모지(종 그림)는 폰마다 다르게 그려져 앱의 다른 아이콘과 따로 논다.
                    헤더의 다른 아이콘과 같은 선(stroke) svg 로 그린다. */}
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none"
                     stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"
                     aria-hidden>
                  <path d="M18 8a6 6 0 0 0-12 0c0 6-2.5 7-2.5 7h17S18 14 18 8z" />
                  <path d="M13.7 19a2 2 0 0 1-3.4 0" />
                  {isMuted && <line x1="3.5" y1="3.5" x2="20.5" y2="20.5" />}
                </svg>
              </button>
            )}
            {selectableMessages.length > 0 && (
              <button aria-label={msg('메시지 선택')} onClick={enterSelectMode} type="button">⋯</button>
            )}
          </div>
        )}
      </div>

      <div className="chat-messages" ref={messagesContainerRef} onScroll={handleMessagesScroll}>
        {loading && messages.length === 0 ? (
          <div className="chat-empty">{t(lang, 'chat.loading')}</div>
        ) : messages.length === 0 ? (
          <div className="chat-empty">{t(lang, 'chat.emptyMsg')}</div>
        ) : (
          messages.map((message) => {
            const mine = message.author_name === currentVisitor
            const system = message.message_type === 'system'
            const selectable = canDeleteMessage(message)
            const selected = selectedMessageIds.has(message.id)
            return (
              <article
                className={[
                  'chat-message',
                  mine ? 'is-mine' : '',
                  system ? 'is-system' : '',
                  selectMode ? 'is-selecting' : '',
                  selected ? 'is-selected' : '',
                ].filter(Boolean).join(' ')}
                key={message.id}
              >
                {selectMode && !system && (
                  <button
                    aria-label={msg('메시지 선택')}
                    className="chat-message__check"
                    disabled={!selectable}
                    onClick={() => toggleMessageSelected(message)}
                    type="button"
                  >
                    {selected ? '✓' : ''}
                  </button>
                )}
                {!mine && !system && <div className="chat-message__avatar">{message.author_name.slice(0, 1)}</div>}
                <div className="chat-message__bubble">
                  {!system && (
                    <div className="chat-message__meta">
                      <strong>{message.author_name}</strong>
                      <span>{formatChatTime(message.created_at)}</span>
                    </div>
                  )}
                  {message.image_url && !message.image_expired && (
                    <a href={message.image_url} rel="noreferrer" target="_blank">
                      <img alt={msg('채팅 첨부 이미지')} src={message.image_url} />
                    </a>
                  )}
                  {message.message_type === 'image' && message.image_expired && (
                    <div style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: 6,
                      padding: '14px 16px',
                      background: '#f1f5f9',
                      border: '1px dashed #cbd5e1',
                      borderRadius: 10,
                    }}>
                      <span style={{ fontSize: 24, lineHeight: 1 }} aria-hidden="true">🗂️</span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: '#475569' }}>{t(lang, 'chat.photoExpired')}</span>
                      <span style={{ fontSize: 11, color: '#94a3b8', textAlign: 'center', lineHeight: 1.4 }}>
                        {t(lang, 'chat.photoExpiredDesc')}
                      </span>
                      {mine && (
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          style={{
                            marginTop: 4,
                            padding: '6px 12px',
                            border: '1px solid #cbd5e1',
                            borderRadius: 8,
                            background: '#ffffff',
                            color: '#334155',
                            fontSize: 12,
                            fontWeight: 700,
                            cursor: 'pointer',
                          }}
                        >
                          📷 {t(lang, 'chat.reupload')}
                        </button>
                      )}
                    </div>
                  )}
                  {message.content && <p>{message.message_type === 'system' ? translateSystemContent(message.content, lang) : <LinkifiedText text={message.content} />}</p>}
                </div>
              </article>
            )
          })
        )}
      </div>

      <div className="chat-composer">
        <input
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) void sendTextMessage()
          }}
          placeholder={t(lang, 'chat.placeholder')}
          value={draft}
        />
        {mentionSuggestions.length > 0 && (
          <div className="mention-menu mention-menu--chat">
            {mentionSuggestions.map((user) => (
              <button
                key={user.id}
                onClick={() => setDraft((value) => insertMention(value, user.name))}
                type="button"
              >
                <span>{user.name.slice(0, 1)}</span>
                {user.name}
              </button>
            ))}
          </div>
        )}
        <input
          accept="image/*"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) void uploadPhoto(file)
            event.target.value = ''
          }}
          ref={fileInputRef}
          type="file"
        />
        <button
          className="chat-composer__photo"
          disabled={uploading}
          onClick={() => fileInputRef.current?.click()}
          type="button"
        >
          {uploading ? '...' : t(lang, 'chat.photo')}
        </button>
        <button disabled={!draft.trim()} onClick={sendTextMessage} type="button">{t(lang, 'chat.send')}</button>
      </div>
    </section>
  )
}
