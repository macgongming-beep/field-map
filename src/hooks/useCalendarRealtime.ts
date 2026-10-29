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
import { calendarNavigationReuseEnabled } from './calendarNavigationCache'

export function useCalendarRealtime(
  onChange: () => void,
  options?: { enabled?: boolean; debounceMs?: number; invalidate?: () => void;
    onParticipants?: (eventIds: number[] | null) => void },
) {
  const enabled = options?.enabled !== false
  const debounceMs = options?.debounceMs ?? 2000  // 연속 이벤트 묶음 처리

  // 콜백 ref로 클로저 갱신 비용 줄임
  const cbRef = useRef(onChange)
  useEffect(() => { cbRef.current = onChange }, [onChange])
  const optionsRef = useRef(options)
  useEffect(() => { optionsRef.current = options }, [options])

  useEffect(() => {
    if (!enabled) return

    let pending: ReturnType<typeof setTimeout> | null = null
    let broad = false
    let unknownParticipant = false
    const participantIds = new Set<number>()
    const schedule = () => {
      if (calendarNavigationReuseEnabled()) optionsRef.current?.invalidate?.()
      if (pending) clearTimeout(pending)
      pending = setTimeout(() => {
        pending = null
        const all = broad
        const ids = unknownParticipant ? null : [...participantIds]
        broad = false
        unknownParticipant = false
        participantIds.clear()
        if (all) cbRef.current()
        else optionsRef.current?.onParticipants?.(ids)
      }, debounceMs)
    }
    const trigger = () => { broad = true; schedule() }
    const participants = (payload: { new?: { event_id?: unknown }; old?: { event_id?: unknown } }) => {
      const ids = [payload?.new?.event_id, payload?.old?.event_id]
        .filter((id): id is number => typeof id === 'number' && Number.isSafeInteger(id) && id > 0)
      // DELETE may expose only the primary key. Refresh loaded participants,
      // never guess the parent or expand to territory reads.
      if (!ids.length) unknownParticipant = true
      ids.forEach(id => participantIds.add(id))
      schedule()
    }

    let channel = supabase
      .channel(`calendar_sync:${Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'calendar_events' }, trigger)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'event_card_assignments' }, trigger)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'event_card_assignment_cards' }, trigger)
    if (calendarNavigationReuseEnabled()) {
      channel = channel
        .on('postgres_changes', { event: '*', schema: 'public', table: 'event_restaurant_assignments' }, trigger)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'event_participants' }, participants)
    }
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
