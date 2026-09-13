// Phase 2: 캘린더·배정 Realtime 전담 hook
//
// 이전: useUserChats가 calendar_events, event_card_assignments,
//       event_card_assignment_cards 까지 구독하면서 N×6 증폭 발생
// 이후: 전용 hook이 변경 신호를 받아 useStore.refetchSlices(['calendar']) 만 호출
//       (전체 fetchAll 대신 calendar slice만 refetch)
//
// 채팅 hook(useUserChats)은 자기 도메인(채팅) 신호만 받음.

import { useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { subscribeWithRecovery } from '../lib/realtimeRecovery'
import { CART_APPLICATIONS_ENABLED } from '../config/features'

export function useCalendarRealtime(
  onChange: () => void,
  options?: { enabled?: boolean; debounceMs?: number },
) {
  const enabled = options?.enabled !== false
  const debounceMs = options?.debounceMs ?? 2000  // 연속 이벤트 묶음 처리

  // 콜백 ref로 클로저 갱신 비용 줄임
  const cbRef = useRef(onChange)
  useEffect(() => { cbRef.current = onChange }, [onChange])

  useEffect(() => {
    if (!enabled) return

    let pending: ReturnType<typeof setTimeout> | null = null
    const trigger = () => {
      if (pending) clearTimeout(pending)
      pending = setTimeout(() => cbRef.current(), debounceMs)
    }

    let channel = supabase
      .channel(`calendar_sync:${Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'calendar_events' }, trigger)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'event_card_assignments' }, trigger)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'event_card_assignment_cards' }, trigger)
    if (CART_APPLICATIONS_ENABLED) {
      channel = channel.on('postgres_changes', { event: '*', schema: 'public', table: 'event_cart_applications' }, trigger)
    }
    // 재연결 시 끊긴 동안 놓친 일정 변경 catch-up
    subscribeWithRecovery(channel, () => cbRef.current())

    return () => {
      if (pending) clearTimeout(pending)
      supabase.removeChannel(channel)
    }
  }, [enabled, debounceMs])
}
