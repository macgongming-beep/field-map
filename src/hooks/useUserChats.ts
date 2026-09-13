// 사용자가 참여한 일정 + 각 채팅방의 안 읽음 카운트
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { getAuthToken } from '../lib/authToken'
import { subscribeWithRecovery } from '../lib/realtimeRecovery'
import { CART_APPLICATIONS_ENABLED } from '../config/features'
import {
  USER_CHATS_CACHE_TTL,
  clearInflightUserChats,
  getCachedUserChats,
  getInflightUserChats,
  getUserChatsCacheKey,
  setCachedUserChats,
  setInflightUserChats,
  type UserChat,
} from '../lib/userChatsCache'

export type { UserChat } from '../lib/userChatsCache'

type EventRow = {
  id: number
  event_date: string
  time: string | null
  title: string
}

type ParticipantRow = {
  event_id: number
  events?: EventRow | null
}

type ReadStatusRow = {
  event_id: number
  last_read_at: string
}

type MessageMetaRow = {
  event_id: number
  created_at: string
  author_id: number | null
}

type SessionRow = {
  calendar_event_id: number | null
  ended_at: string | null
}

function isLockedByEndedAt(latestEnded: number): boolean {
  return Date.now() - latestEnded > 7 * 24 * 60 * 60 * 1000
}

// 이벤트 날짜 기준 잠금: 다음날 자정 이후 → "이전 대화" 섹션으로 이동
// (메시지 읽기/쓰기는 DB 잠금 기준(7일)이 별도 관리 — 위치만 변경)
function isLockedByEventDate(eventDate: string): boolean {
  if (!eventDate) return false
  // 이벤트 당일 자정 + 1일 = 다음날 00:00
  const nextDayMidnight = new Date(eventDate + 'T00:00:00')
  nextDayMidnight.setDate(nextDayMidnight.getDate() + 1)
  if (!Number.isFinite(nextDayMidnight.getTime())) return false
  return Date.now() >= nextDayMidnight.getTime()
}

export function useUserChats(
  userId: number | null | undefined,
  userName: string | null | undefined,
  options?: { realtime?: boolean },
) {
  const realtimeEnabled = options?.realtime !== false
  const cacheKey = getUserChatsCacheKey(userId, userName)
  const [chats, setChats] = useState<UserChat[]>(() => getCachedUserChats(cacheKey)?.chats ?? [])
  const [loading, setLoading] = useState(false)
  const channelIdRef = useRef(
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
  )

  const fetchAll = useCallback(async (options?: { force?: boolean }) => {
    if (!userId || !userName) {
      setChats([])
      return
    }

    const cached = getCachedUserChats(cacheKey)
    const cacheFresh = cached && Date.now() - cached.fetchedAt < USER_CHATS_CACHE_TTL
    if (cached) {
      setChats(cached.chats)
    }
    if (cacheFresh && !options?.force) {
      setLoading(false)
      return
    }

    const existingRequest = getInflightUserChats(cacheKey)
    if (existingRequest) {
      setLoading(!cached)
      try {
        const result = await existingRequest
        setChats(result)
      } finally {
        setLoading(false)
      }
      return
    }

    setLoading(!cached)

    const loadPromise = (async (): Promise<UserChat[]> => {
      // 1. 사용자가 참여한 일정 (event_participants)
      const { data: participants } = await supabase
        .from('event_participants')
        .select('event_id, events:calendar_events(id, event_date, time, title)')
        .eq('user_name', userName)

      const eventsFromParticipants = ((participants ?? []) as unknown as ParticipantRow[])
        .map((p) => p.events)
        .filter((e): e is EventRow => Boolean(e))

      const { data: cartApplications } = CART_APPLICATIONS_ENABLED
        ? await supabase
          .from('event_cart_applications')
          .select('event_id, events:calendar_events(id, event_date, time, title)')
          .eq('user_id', userId)
        : { data: [] }
      const eventsFromCart = ((cartApplications ?? []) as unknown as ParticipantRow[])
        .map((application) => application.events)
        .filter((event): event is EventRow => Boolean(event))

      // 1-b. 인도자가 본인인 일정도 포함 (참가자 명단에 없을 수 있음)
      const { data: leaderEvents } = await supabase
        .from('calendar_events')
        .select('id, event_date, time, title')
        .eq('leader_name', userName)

      // 두 목록 합치기 (id 기준 중복 제거)
      const eventMap = new Map<number, EventRow>()
      eventsFromParticipants.forEach((e) => eventMap.set(e.id, e))
      eventsFromCart.forEach((e) => eventMap.set(e.id, e))
      ;((leaderEvents ?? []) as EventRow[]).forEach((e) => eventMap.set(e.id, e))
      const events = Array.from(eventMap.values())

      if (events.length === 0) {
        return []
      }

      const eventIds = events.map((e) => e.id)

      // 2. 채팅 읽음 상태 (RPC — 본인 것만)
      const token = getAuthToken()
      const readMap = new Map<number, string>()
      if (token) {
        const { data: readRows } = await supabase.rpc('get_my_chat_reads', {
          p_token: token,
        })
        ;((readRows ?? []) as ReadStatusRow[]).forEach((r) => {
          if (eventIds.includes(r.event_id)) {
            readMap.set(r.event_id, r.last_read_at)
          }
        })
      }

      // 3. 채팅 메시지 메타 (참여자 카운트, 최신, 안 읽음 카운트용)
      let messages: MessageMetaRow[] = []
      if (token) {
        const { data: rpcMessages, error: rpcError } = await supabase.rpc('get_chat_message_meta', {
          p_token: token,
          p_event_ids: eventIds,
        })

        if (!rpcError) {
          messages = (rpcMessages ?? []) as MessageMetaRow[]
        } else {
          console.warn('[user_chats] get_chat_message_meta failed:', rpcError)
        }
      }

      const messagesByEvent = new Map<number, MessageMetaRow[]>()
      messages.forEach((m) => {
        const arr = messagesByEvent.get(m.event_id) ?? []
        arr.push(m)
        messagesByEvent.set(m.event_id, arr)
      })

      // 4. 일정별 참여 인원 카운트
      const { data: allParticipants } = await supabase
        .from('event_participants')
        .select('event_id')
        .in('event_id', eventIds)
      const { data: allCartParticipants } = CART_APPLICATIONS_ENABLED
        ? await supabase
          .from('event_cart_applications')
          .select('event_id')
          .in('event_id', eventIds)
        : { data: [] }

      const participantCountByEvent = new Map<number, number>()
      ;((allParticipants ?? []) as { event_id: number }[]).forEach((p) => {
        participantCountByEvent.set(p.event_id, (participantCountByEvent.get(p.event_id) ?? 0) + 1)
      })
      ;((allCartParticipants ?? []) as { event_id: number }[]).forEach((p) => {
        participantCountByEvent.set(p.event_id, (participantCountByEvent.get(p.event_id) ?? 0) + 1)
      })

      // 5. 봉사 세션 (잠금 판단용)
      const { data: sessions } = await supabase
        .from('service_sessions')
        .select('calendar_event_id, ended_at')
        .in('calendar_event_id', eventIds)

      const sessionsByEvent = new Map<number, SessionRow[]>()
      ;((sessions ?? []) as SessionRow[]).forEach((s) => {
        if (!s.calendar_event_id) return
        const arr = sessionsByEvent.get(s.calendar_event_id) ?? []
        arr.push(s)
        sessionsByEvent.set(s.calendar_event_id, arr)
      })

      // 6. 합쳐서 UserChat 생성
      const result: UserChat[] = events.map((event) => {
        const eventMessages = messagesByEvent.get(event.id) ?? []
        const lastReadAt = readMap.get(event.id) ?? '1970-01-01'

        // 안 읽음: 본인 메시지 제외 + last_read_at 이후 메시지
        const unreadCount = eventMessages.filter(
          (m) => m.created_at > lastReadAt && m.author_id !== userId
        ).length

        // 봉사 세션 잠금
        const eventSessions = sessionsByEvent.get(event.id) ?? []
        const allEnded = eventSessions.length > 0 && eventSessions.every((s) => s.ended_at !== null)
        const latestEndedTime = allEnded
          ? Math.max(...eventSessions.map((s) => new Date(s.ended_at!).getTime()))
          : 0
        // 잠금 기준 두 가지:
        // 1) 모든 service_sessions 종료 + 종료 7일 경과 (옛 기준)
        // 2) 일정 날짜가 7일 이상 지남 (신 기준 — 세션이 없거나 안 끝낸 옛 일정 처리)
        const isLocked = (allEnded && isLockedByEndedAt(latestEndedTime))
          || isLockedByEventDate(event.event_date)

        return {
          eventId: event.id,
          eventTitle: event.title,
          eventDate: event.event_date,
          eventTime: event.time,
          participantCount: participantCountByEvent.get(event.id) ?? 0,
          lastMessageAt: eventMessages[0]?.created_at ?? null,
          unreadCount,
          isLocked,
          hasEnded: allEnded || isLockedByEventDate(event.event_date),
        }
      })

      // 활성 (최신 메시지/이벤트 시각 desc) → 잠금 (날짜 desc) 정렬
      // lastMessageAt 가 null 인 경우 eventDate 로 fallback (그래야 옛 일정도 자기 순서 유지)
      const sortKey = (c: UserChat): number => {
        if (c.lastMessageAt) return new Date(c.lastMessageAt).getTime()
        if (c.eventDate) return new Date(c.eventDate + 'T00:00:00').getTime()
        return 0
      }
      result.sort((a, b) => {
        if (a.isLocked !== b.isLocked) return a.isLocked ? 1 : -1
        return sortKey(b) - sortKey(a)
      })

      return result
    })()

    setInflightUserChats(cacheKey, loadPromise)

    try {
      const result = await loadPromise
      setCachedUserChats(cacheKey, result)
      setChats(result)
    } catch (e) {
      console.warn('[user_chats] fetch failed:', e)
      if (cached) setChats(cached.chats)
      else setChats([])
    } finally {
      clearInflightUserChats(cacheKey)
      setLoading(false)
    }
  }, [cacheKey, userId, userName])

  useEffect(() => {
    fetchAll()
  }, [fetchAll])

  // Phase 2: 채팅 도메인만 구독 (캘린더/배정은 useCalendarRealtime이 별도 처리)
  //
  // 채팅에 직접 관련된 신호만 구독:
  //   - chat_read_status: 본인 읽음 상태 변경
  //   - event_participants: 채팅방 참여 여부 변경 (가입·탈퇴·일정 삭제 cascade)
  //   - chat_message_signals: 새 메시지 신호
  //
  // calendar_events / event_card_assignments / event_card_assignment_cards는
  // 채팅과 무관 → useCalendarRealtime이 useStore의 calendar slice만 갱신.
  // 이벤트 제목/날짜 변경은 다음 fetchAll에서 자연스럽게 반영됨 (UX 약간의 지연 허용).
  useEffect(() => {
    if (!userId || !realtimeEnabled) return
    let pending: ReturnType<typeof setTimeout> | null = null
    const trigger = () => {
      if (pending) clearTimeout(pending)
      pending = setTimeout(() => fetchAll({ force: true }), 1500)  // 800→1500ms 디바운스 강화
    }

    let channel = supabase
      .channel(`user_chats:user:${userId}:${channelIdRef.current}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_read_status', filter: `user_id=eq.${userId}` }, trigger)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'event_participants', filter: `user_name=eq.${userName}` }, trigger)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_message_signals' }, trigger)
    if (CART_APPLICATIONS_ENABLED) {
      channel = channel.on('postgres_changes', { event: '*', schema: 'public', table: 'event_cart_applications', filter: `user_id=eq.${userId}` }, trigger)
    }
    // 재연결 시 끊긴 동안 놓친 채팅/참여 변경 즉시 catch-up (2분 폴링보다 빠름)
    subscribeWithRecovery(channel, () => fetchAll({ force: true }))

    // 백그라운드 폴링: 30초 → 2분으로 완화 (Phase 4)
    // Realtime이 살아있으므로 폴링은 fallback 역할만. 채팅 신호는 즉시 받음.
    const interval = window.setInterval(() => {
      if (!document.hidden) fetchAll({ force: true })
    }, 120_000)

    return () => {
      if (pending) clearTimeout(pending)
      window.clearInterval(interval)
      supabase.removeChannel(channel)
    }
  }, [userId, userName, realtimeEnabled, fetchAll])

  // 총 안 읽음 수
  const totalUnread = useMemo(
    () => chats.reduce((sum, c) => sum + c.unreadCount, 0),
    [chats]
  )

  // 활성 / 종료 분리
  const activeChats = useMemo(() => chats.filter((c) => !c.isLocked), [chats])
  const lockedChats = useMemo(() => chats.filter((c) => c.isLocked), [chats])

  // 채팅방 입장 시 낙관적으로 해당 채팅 안 읽음 → 0 (DB 재조회 전에 즉시 반영)
  const markChatReadLocally = useCallback((eventId: number) => {
    setChats((prev) =>
      prev.map((c) => (c.eventId === eventId ? { ...c, unreadCount: 0 } : c))
    )
  }, [])

  // 모든 채팅방 읽음 처리 (활성 + 잠긴 것 모두)
  const markAllChatsRead = useCallback(async () => {
    const token = getAuthToken()
    if (!token) return
    const eventIds = chats.map((c) => c.eventId)
    if (eventIds.length === 0) return

    // 낙관적 즉시 반영
    setChats((prev) => prev.map((c) => ({ ...c, unreadCount: 0 })))

    const { error } = await supabase.rpc('mark_all_chats_read', {
      p_token: token,
      p_event_ids: eventIds,
    })
    if (error) {
      console.warn('[user_chats] mark_all_chats_read failed:', error)
    }
  }, [chats])

  return {
    chats,
    activeChats,
    lockedChats,
    totalUnread,
    loading,
    refetch: fetchAll,
    markChatReadLocally,
    markAllChatsRead,
  }
}
