// 사용자별 알림 함 + 안 읽음 카운트 + Realtime
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { getAuthToken } from '../lib/authToken'
import { isActiveChatLink } from '../lib/activeChat'
import { useVisibleRefresh } from './useVisibleRefresh'

export type NotificationType =
  | 'notice'
  | 'event_change'
  | 'comment'
  | 'mention'
  | 'chat'
  | 'service_started'
  | 'service_ended'
  | 'assignment'
  | 'daily_service'

export type AppNotification = {
  id: number
  userId: number
  type: NotificationType
  title: string
  body: string | null
  link: string | null
  relatedId: number | null
  isRead: boolean
  createdAt: string
}

type RawNotification = {
  id: number
  user_id: number
  type: string
  title: string
  body: string | null
  link: string | null
  related_id: number | null
  is_read: boolean
  created_at: string
}

function toNotification(raw: RawNotification): AppNotification {
  return {
    id: raw.id,
    userId: raw.user_id,
    type: raw.type as NotificationType,
    title: raw.title ?? '',
    body: raw.body ?? null,
    link: raw.link,
    relatedId: raw.related_id,
    isRead: raw.is_read,
    createdAt: raw.created_at,
  }
}

const PAGE_SIZE = 50
export const NOTIFICATION_BADGE_COLUMNS = 'id,user_id,type,link,related_id,is_read,created_at'

async function markReadSilently(notificationId: number, token: string) {
  const { error } = await supabase.rpc('mark_notification_read', {
    p_token: token,
    p_notification_id: notificationId,
  })
  if (error) {
    console.warn('[notifications] silent markRead failed:', error)
  }
}

export function useNotifications(userId: number | null | undefined, options: { badgeOnly?: boolean } = {}) {
  const badgeOnly = options.badgeOnly === true
  const token = getAuthToken()
  const identity = JSON.stringify([userId ?? null, token])
  const key = JSON.stringify([identity, badgeOnly])
  const activeKey = useRef<string | null>(null)
  const generation = useRef(0)
  const pendingWrites = useRef(new Set<Promise<unknown>>())
  const [snapshot, setSnapshot] = useState<{ identity: string; full: boolean; rows: AppNotification[] } | null>(null)
  const [status, setStatus] = useState<{ key: string; loading: boolean; error: boolean } | null>(null)
  const notifications = useMemo(() => snapshot?.identity === identity ? snapshot.rows : [], [snapshot, identity])
  const detailsReady = snapshot?.identity === identity && snapshot.full
  const error = status?.key === key && status.error
  const loading = Boolean(userId && token && (status?.key !== key || status.loading))

  const setNotifications = useCallback((update: (rows: AppNotification[]) => AppNotification[]) => {
    setSnapshot((previous) => previous?.identity === identity ? { ...previous, rows: update(previous.rows) } : previous)
  }, [identity])

  const fetchAll = useCallback(async () => {
    if (!userId || !token || activeKey.current !== key || getAuthToken() !== token) return
    const request = ++generation.current
    const current = () => activeKey.current === key && request === generation.current && getAuthToken() === token
    setStatus({ key, loading: true, error: false })
    try {
      // Closing the panel can start a badge read before mark-read commits.
      while (pendingWrites.current.size > 0) {
        await Promise.allSettled([...pendingWrites.current])
        if (!current()) return
      }
      const query = supabase.rpc('get_my_notifications', { p_token: token, p_limit: PAGE_SIZE })
      const { data, error: readError } = await (badgeOnly ? query.select(NOTIFICATION_BADGE_COLUMNS) : query)
      if (!current()) return
      if (readError) throw readError
      const rows = (data as RawNotification[]).map((raw) => {
        if (!raw.is_read && (raw.type === 'chat' || raw.type === 'mention') && isActiveChatLink(raw.link)) {
          void markReadSilently(raw.id, token)
          return toNotification({ ...raw, is_read: true })
        }
        return toNotification(raw)
      })
      setSnapshot({ identity, full: !badgeOnly, rows })
      setStatus({ key, loading: false, error: false })
    } catch (cause) {
      if (!current()) return
      console.warn('[notifications] fetch failed:', cause)
      setStatus({ key, loading: false, error: true })
    }
  }, [userId, token, key, identity, badgeOnly])

  // 초기 로드
  useEffect(() => {
    activeKey.current = key
    void fetchAll()
    return () => { activeKey.current = null; generation.current += 1 }
  }, [fetchAll, key])

  // This private table is RPC-only; direct subscriptions fail the column filter.
  useVisibleRefresh(Boolean(userId), fetchAll)

  // 안 읽음 카운트
  const unreadCount = useMemo(
    () => notifications.filter((n) => !n.isRead).length,
    [notifications]
  )

  const beginMutation = useCallback(() => {
    if (activeKey.current !== key || getAuthToken() !== token) return false
    // An older read must not undo an optimistic read/delete action.
    generation.current += 1
    setStatus({ key, loading: false, error: false })
    return true
  }, [key, token])

  const write = useCallback(async (name: string, args: Record<string, unknown>) => {
    const pending = Promise.resolve(supabase.rpc(name, args))
    pendingWrites.current.add(pending)
    try { return await pending }
    finally { pendingWrites.current.delete(pending) }
  }, [])

  // 단일 알림 읽음 처리
  const markRead = useCallback(
    async (notificationId: number) => {
      if (!beginMutation()) return
      // 낙관적 갱신 먼저 — 토큰 여부와 무관하게 UI 즉시 반영
      setNotifications((prev) =>
        prev.map((n) => (n.id === notificationId ? { ...n, isRead: true } : n))
      )
      const token = getAuthToken()
      if (!token) return
      const { error } = await write('mark_notification_read', {
        p_token: token,
        p_notification_id: notificationId,
      })
      if (error) {
        // RPC 실패 시 즉각 되돌리지 않고 3초 후 DB 재동기화
        console.warn('[notifications] markRead failed:', error)
        setTimeout(() => { void fetchAll() }, 3000)
      }
    },
    [fetchAll, beginMutation, setNotifications, write]
  )

  // 모두 읽음
  const markAllRead = useCallback(async () => {
    if (!userId || notifications.every((n) => n.isRead)) return
    if (!beginMutation()) return
    // 낙관적 갱신 먼저
    setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })))
    const token = getAuthToken()
    if (!token) return
    const { error } = await write('mark_all_notifications_read', {
      p_token: token,
    })
    if (error) {
      console.warn('[notifications] markAllRead failed:', error)
      setTimeout(() => { void fetchAll() }, 3000)
    }
  }, [userId, notifications, fetchAll, beginMutation, setNotifications, write])

  // 읽음 처리된 알림 전체 삭제
  const clearReadNotifications = useCallback(async () => {
    const token = getAuthToken()
    if (!userId || notifications.every((n) => !n.isRead)) return
    if (!token) return
    if (!beginMutation()) return
    // 낙관적 갱신
    setNotifications((prev) => prev.filter((n) => !n.isRead))
    const { error } = await write('clear_read_notifications', {
      p_token: token,
    })
    if (error) {
      console.error('[notifications] clearRead failed:', JSON.stringify(error))
      await fetchAll()
    }
  }, [userId, notifications, fetchAll, beginMutation, setNotifications, write])

  return {
    notifications,
    unreadCount,
    loading,
    error,
    detailsReady,
    markRead,
    markAllRead,
    clearReadNotifications,
    refetch: fetchAll,
  }
}
