import type { CalendarEvent } from '../../types'
import { supabase, showToast, reportMutationError, getCurrentVisitor, ensureAffectedRows } from './shared'
import { logServiceAction } from './serviceLog'
import { msg } from '../../lib/msg'
import { getAuthToken } from '../../lib/authToken'
import { eventParticipantNameKey, normalizeEventParticipantName } from '../../utils/eventParticipantUsers'

/** 일정 입력 공통 타입 */
export type CalendarEventInput = {
  time: string
  endTime?: string
  title: string
  place: string
  mapLink?: string
  leader: string
  memo: string
  hasMeeting: boolean
  allowApplications: boolean
}

/** DB payload 변환 (mapLink 옵셔널 처리 포함) */
function buildEventPayload(input: CalendarEventInput): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    time: input.time,
    end_time: input.endTime?.trim() || null,
    title: input.title,
    place: input.place,
    leader_name: input.leader,
    memo: input.memo,
    has_meeting: input.hasMeeting,
    allow_applications: input.allowApplications,
  }
  if (input.mapLink?.trim()) payload.meeting_map_url = input.mapLink.trim()
  return payload
}

export function makeCalendarMutations(deps: {
  fetchAll: () => Promise<void>
  refetchAfterParticipantRemoval?: () => Promise<void>
  calendarEvents: CalendarEvent[]
}) {
  const { fetchAll, refetchAfterParticipantRemoval, calendarEvents } = deps

  // ─── 일정 CRUD ───────────────────────────────────────────────
  const createCalendarEvent = async (input: { date: string } & CalendarEventInput) => {
    const payload = { ...buildEventPayload(input), event_date: input.date }
    const result = await supabase.from('calendar_events').insert(payload).select('id').single()
    if (result.error) {
      reportMutationError(msg('일정을 등록하지 못했습니다.'), result.error)
      return
    }
    // 시스템 채팅 메시지 ("채팅방이 생성되었습니다") 제거 — 불필요 알림 줄이기
    await fetchAll()
    showToast(msg('일정이 등록됐습니다'))
  }

  const createRepeatCalendarEvents = async (dates: string[], input: CalendarEventInput) => {
    // 종료일이 시작일보다 이전이면 dates 가 비어 0개 등록되는 사고 방지
    if (!dates || dates.length === 0) {
      showToast(msg('반복 종료일을 시작일 이후로 정해 주세요.'), 'error')
      return
    }
    const seriesId = crypto.randomUUID()
    const basePayload = buildEventPayload(input)
    const result = await supabase.from('calendar_events').insert(
      dates.map((date) => ({ ...basePayload, event_date: date, series_id: seriesId })),
    ).select('id')
    if (result.error) {
      reportMutationError(msg('반복 일정을 등록하지 못했습니다.'), result.error)
      return
    }
    // 시스템 채팅 메시지 ("채팅방이 생성되었습니다") 제거 — 불필요 알림 줄이기
    await fetchAll()
    showToast(msg('{length}개 일정이 등록됐습니다', { length: dates.length }))
  }

  // notify: 참가자에게 알림을 보낼지. 화면이 물어본 답을 넘긴다.
  // (안 보냄으로 고치면 RPC 안에서 트리거를 끈 채 고친다)
  // ⚠ **직접 쓰기로 물러서지 않는다.** 예전에는 RPC 가 실패하면 레거시 update 로
  //   떨어졌는데, 그 경로에는 권한 검사도 알림 억제도 없다. 그래서
  //   '권한 없음' 을 우회하고, '보내지 않기' 를 골라도 알림이 나갔다.
  //   실패하면 실패로 끝낸다.
  const updateCalendarEvent = async (eventId: number, input: CalendarEventInput, notify = true): Promise<boolean> => {
    const token = getAuthToken()
    if (!token) {
      showToast(msg('로그인 정보가 없습니다. 다시 로그인해 주세요.'), 'error')
      return false
    }
    const rpc = await supabase.rpc('update_calendar_event_tx', {
      p_token: token, p_event_id: eventId,
      p_payload: buildEventPayload(input), p_notify: notify,
    })
    if (rpc.error) {
      reportMutationError(msg('일정을 수정하지 못했습니다.'), rpc.error)
      return false
    }
    const r = rpc.data as { ok?: boolean } | null
    if (!r?.ok) {
      showToast(msg('일정을 수정하지 못했습니다.'), 'error')
      return false
    }
    await fetchAll()
    showToast(msg('일정이 수정됐습니다'))
    return true
  }

  // 반복 일정은 줄마다 트리거가 돌아 알림이 일정 수만큼 나갔다 (한 번에 92건 나간 적 있다).
  // RPC 안에서 트리거를 끈 채 전부 고치고 **끝나고 한 번만** 보낸다.
  const updateCalendarEventSeries = async (
    seriesId: string,
    fromDate: string,
    input: CalendarEventInput,
    notify = true,
  ): Promise<boolean> => {
    // ⚠ 여기도 직접 쓰기로 물러서지 않는다. 레거시 경로로 떨어지면
    //   줄마다 트리거가 돌아 **알림이 다시 폭주한다.** 실패하면 실패로 끝낸다.
    const token = getAuthToken()
    if (!token) {
      showToast(msg('로그인 정보가 없습니다. 다시 로그인해 주세요.'), 'error')
      return false
    }
    const rpc = await supabase.rpc('update_calendar_event_series_tx', {
      p_token: token, p_series_id: seriesId, p_from_date: fromDate,
      p_payload: buildEventPayload(input), p_notify: notify,
    })
    if (rpc.error) {
      reportMutationError(msg('반복 일정을 수정하지 못했습니다.'), rpc.error)
      return false
    }
    const r = rpc.data as { ok?: boolean; updated?: number } | null
    if (!r?.ok) {
      showToast(msg('반복 일정을 수정하지 못했습니다.'), 'error')
      return false
    }
    await fetchAll()
    showToast(msg('이후 반복 일정 {n}개가 수정됐습니다', { n: r.updated ?? 0 }))
    return true
  }

  const deleteCalendarEvent = async (eventId: number) => {
    const result = await supabase.from('calendar_events').delete().eq('id', eventId).select('id')
    if (result.error) {
      reportMutationError(msg('일정을 삭제하지 못했습니다.'), result.error)
      return
    }
    if (!ensureAffectedRows(result.data, msg('일정을 삭제하지 못했습니다.'))) return
    await fetchAll()
    showToast(msg('일정이 삭제됐습니다'))
  }

  const deleteCalendarEventSeries = async (seriesId: string, fromDate: string) => {
    const result = await supabase.from('calendar_events')
      .delete()
      .eq('series_id', seriesId)
      .gte('event_date', fromDate)
      .select('id')
    if (result.error) {
      reportMutationError(msg('반복 일정 삭제에 실패했습니다.'), result.error)
      return
    }
    if (!ensureAffectedRows(result.data, msg('반복 일정 삭제에 실패했습니다.'))) return
    await fetchAll()
    showToast(msg('이후 반복 일정이 모두 삭제됐습니다'))
  }

  const linkEventsToSeries = async (eventIds: number[]) => {
    const seriesId = crypto.randomUUID()
    const result = await supabase.from('calendar_events')
      .update({ series_id: seriesId })
      .in('id', eventIds)
      .select('id')
    if (result.error) {
      reportMutationError(msg('시리즈 묶기에 실패했습니다. series_id 컬럼이 있는지 확인해 주세요.'), result.error)
      return
    }
    const changed = result.data ?? []
    if (!ensureAffectedRows(changed, msg('시리즈 묶기에 실패했습니다.'))) return
    if (changed.length !== new Set(eventIds).size) {
      reportMutationError(msg('시리즈 묶기에 실패했습니다.'), new Error('일부 일정만 변경됐습니다.'))
      return
    }
    await fetchAll()
    showToast(msg('{length}개 일정이 시리즈로 묶였습니다', { length: eventIds.length }))
  }

  // ─── 참가자 / 신청 ───────────────────────────────────────────
  const applyToEvent = async (eventId: number) => {
    const currentVisitor = getCurrentVisitor()
    const event = calendarEvents.find((e) => e.id === eventId)
    const isApplied = event?.applicants.includes(currentVisitor)
    if (event && !event.allowApplications && !isApplied) {
      showToast(msg('이 일정은 봉사 신청을 받지 않습니다.'), 'info')
      return
    }
    if (isApplied) {
      const result = await supabase.from('event_participants')
        .delete()
        .eq('event_id', eventId)
        .eq('user_name', currentVisitor)
        .eq('role', '신청')
        .select('id')
      if (result.error) {
        reportMutationError(msg('봉사 신청을 취소하지 못했습니다.'), result.error)
        return
      }
      if (!ensureAffectedRows(result.data, msg('봉사 신청을 취소하지 못했습니다.'))) return
      await logServiceAction({
        eventId,
        action: 'left',
        targetType: 'event_participant',
        details: { user_name: currentVisitor, source: 'self_cancel' },
      })
    } else {
      const result = await supabase.from('event_participants').upsert(
        { event_id: eventId, user_name: currentVisitor, role: '신청' },
        { onConflict: 'event_id,user_name', ignoreDuplicates: true },
      ).select('id')
      if (result.error) {
        reportMutationError(msg('봉사 신청을 저장하지 못했습니다.'), result.error)
        return
      }
      if ((result.data?.length ?? 0) > 0) {
        await logServiceAction({
          eventId,
          action: 'joined',
          targetType: 'event_participant',
          details: { user_name: currentVisitor, source: 'self_apply' },
        })
      }
    }
    await fetchAll()
    showToast(isApplied ? '신청이 취소됐습니다' : '일정에 신청됐습니다')
  }

  const removeParticipantFromEvent = async (eventId: number, userName: string) => {
    const multiCardResult = await supabase.from('event_card_assignment_cards')
      .delete()
      .eq('event_id', eventId)
      .eq('user_name', userName)
    if (multiCardResult.error) {
      reportMutationError(msg('참가자의 추가 카드 배정을 정리하지 못했습니다.'), multiCardResult.error)
      return
    }

    const cardAssignmentResult = await supabase.from('event_card_assignments')
      .delete()
      .eq('event_id', eventId)
      .eq('user_name', userName)
    if (cardAssignmentResult.error) {
      reportMutationError(msg('참가자의 카드 배정을 정리하지 못했습니다.'), cardAssignmentResult.error)
      return
    }

    const informalResult = await supabase.from('event_informal_assignments')
      .delete()
      .eq('event_id', eventId)
      .eq('user_name', userName)
    if (informalResult.error) {
      reportMutationError(msg('참가자의 비공식 배정을 정리하지 못했습니다.'), informalResult.error)
      return
    }

    const restaurantResult = await supabase.from('event_restaurant_assignments')
      .delete()
      .eq('event_id', eventId)
      .eq('user_name', userName)
    if (restaurantResult.error) {
      reportMutationError(msg('참가자의 식당 배정을 정리하지 못했습니다.'), restaurantResult.error)
      return
    }

    const sessionResult = await supabase.from('service_sessions')
      .delete()
      .eq('calendar_event_id', eventId)
      .eq('user_name', userName)
      .eq('source', 'assigned')
    if (sessionResult.error) {
      reportMutationError(msg('참가자의 자동 봉사 세션을 정리하지 못했습니다.'), sessionResult.error)
      return
    }

    const participantResult = await supabase.from('event_participants')
      .delete()
      .eq('event_id', eventId)
      .eq('user_name', userName)
    if (participantResult.error) {
      reportMutationError(msg('참가자를 제외하지 못했습니다.'), participantResult.error)
      return
    }

    await logServiceAction({
      eventId,
      action: 'left',
      targetType: 'event_participant',
      details: { user_name: userName, source: 'admin_remove' },
    })
    await (refetchAfterParticipantRemoval ?? fetchAll)()
    showToast(msg('{userName}님을 참가자와 배정에서 제외했습니다', { userName: userName }))
  }

  /**
   * @param role '신청' = 본인이 신청 · '게스트' = 앱 계정이 없는 손님
   *   게스트도 같은 표에 들어간다. user_name 이 app_users 를 참조하지 않아
   *   계정 없는 이름을 넣을 수 있다.
  */
  const addParticipantToEvent = async (eventId: number, userName: string, role: '신청' | '게스트' = '신청') => {
    const normalizedName = normalizeEventParticipantName(userName)
    const event = calendarEvents.find((e) => e.id === eventId)
    if (!event || !normalizedName) return false
    if (event.applicants.some((name) => eventParticipantNameKey(name) === eventParticipantNameKey(normalizedName))) {
      showToast(msg('이미 이 일정에 있는 이름입니다.'), 'info')
      return false
    }
    const result = await supabase.from('event_participants').upsert(
      { event_id: eventId, user_name: normalizedName, role },
      { onConflict: 'event_id,user_name' },
    ).select('id')
    if (result.error) {
      reportMutationError(msg('참가자를 추가하지 못했습니다.'), result.error)
      return false
    }
    if (!ensureAffectedRows(result.data, msg('참가자를 추가하지 못했습니다.'))) return false
    // 시스템 채팅 메시지 ("합류했습니다") 제거 — 불필요 알림 줄이기
    await logServiceAction({
      eventId,
      action: 'joined',
      targetType: 'event_participant',
      details: { user_name: normalizedName, source: role === '게스트' ? 'admin_add_guest' : 'admin_add' },
    })
    await fetchAll()
    showToast(msg(
      role === '게스트' ? '{userName}님을 게스트로 추가했습니다' : '{userName}님을 신청자로 추가했습니다',
      { userName: normalizedName },
    ))
    return true
  }

  return {
    createCalendarEvent,
    createRepeatCalendarEvents,
    updateCalendarEvent,
    updateCalendarEventSeries,
    deleteCalendarEvent,
    deleteCalendarEventSeries,
    linkEventsToSeries,
    applyToEvent,
    removeParticipantFromEvent,
    addParticipantToEvent,
  }
}
