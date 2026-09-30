// 사용자별 알림 함 + 안 읽음 카운트 + Realtime
import { useCallback, useEffect, useMemo, useState } from 'react'
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
    title: raw.title,
    body: raw.body,
    link: raw.link,
    relatedId: raw.related_id,
    isRead: raw.is_read,
    createdAt: raw.created_at,
  }
}

const PAGE_SIZE = 50

async function markReadSilently(notificationId: number) {
  const token = getAuthToken()
  if (!token) return
  const { error } = await supabase.rpc('mark_notification_read', {
    p_token: token,
    p_notification_id: notificationId,
  })
  if (error) {
    console.warn('[notifications] silent markRead failed:', error)
  }
}

export function useNotifications(userId: number | null | undefined) {
  const [notifications, setNotifications] = useState<AppNotification[]>([])
  const [loading, setLoading] = useState(false)

  const fetchAll = useCallback(async () => {
    if (!userId) return
    const token = getAuthToken()
    if (!token) {
      setNotifications([])
      return
    }
    setLoading(true)
    const { data, error } = await supabase.rpc('get_my_notifications', {
      p_token: token,
      p_limit: PAGE_SIZE,
    })
    setLoading(false)
    if (error) {
      console.warn('[notifications] fetch failed:', error)
      return
    }
    setNotifications((data as RawNotification[]).map((raw) => {
      if (!raw.is_read && (raw.type === 'chat' || raw.type === 'mention') && isActiveChatLink(raw.link)) {
        void markReadSilently(raw.id)
        return toNotification({ ...raw, is_read: true })
      }
      return toNotification(raw)
    }))
  }, [userId])

  // 초기 로드
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Initial authenticated RPC load.
    fetchAll()
  }, [fetchAll])

  // This private table is RPC-only; direct subscriptions fail the column filter.
  useVisibleRefresh(Boolean(userId), fetchAll)

  // 안 읽음 카운트
  const unreadCount = useMemo(
    () => notifications.filter((n) => !n.isRead).length,
    [notifications]
  )

  // 단일 알림 읽음 처리
  const markRead = useCallback(
    async (notificationId: number) => {
      // 낙관적 갱신 먼저 — 토큰 여부와 무관하게 UI 즉시 반영
      setNotifications((prev) =>
        prev.map((n) => (n.id === notificationId ? { ...n, isRead: true } : n))
      )
      const token = getAuthToken()
      if (!token) return
      const { error } = await supabase.rpc('mark_notification_read', {
        p_token: token,
        p_notification_id: notificationId,
      })
      if (error) {
        // RPC 실패 시 즉각 되돌리지 않고 3초 후 DB 재동기화
        console.warn('[notifications] markRead failed:', error)
        setTimeout(() => { void fetchAll() }, 3000)
      }
    },
    [fetchAll]
  )

  // 모두 읽음
  const markAllRead = useCallback(async () => {
    if (!userId || notifications.every((n) => n.isRead)) return
    // 낙관적 갱신 먼저
    setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })))
    const token = getAuthToken()
    if (!token) return
    const { error } = await supabase.rpc('mark_all_notifications_read', {
      p_token: token,
    })
    if (error) {
      console.warn('[notifications] markAllRead failed:', error)
      setTimeout(() => { void fetchAll() }, 3000)
    }
  }, [userId, notifications, fetchAll])

  // 읽음 처리된 알림 전체 삭제
  const clearReadNotifications = useCallback(async () => {
    const token = getAuthToken()
    if (!userId || notifications.every((n) => !n.isRead)) return
    if (!token) return
    // 낙관적 갱신
    setNotifications((prev) => prev.filter((n) => !n.isRead))
    const { error } = await supabase.rpc('clear_read_notifications', {
      p_token: token,
    })
    if (error) {
      console.error('[notifications] clearRead failed:', JSON.stringify(error))
      await fetchAll()
    }
  }, [userId, notifications, fetchAll])

  return {
    notifications,
    unreadCount,
    loading,
    markRead,
    markAllRead,
    clearReadNotifications,
    refetch: fetchAll,
  }
}
