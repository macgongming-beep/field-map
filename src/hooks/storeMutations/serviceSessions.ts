import type { Building, Role, ServiceSession, ServiceSessionStatus, TimeSlot } from '../../types'
import { supabase, showToast, reportMutationError, getLocalDateString, getCurrentVisitor } from './shared'
import { logServiceAction } from './serviceLog'
import { msg } from '../../lib/msg'

export function makeServiceSessionMutations(deps: {
  fetchAll: () => Promise<void>
  serviceSessions: ServiceSession[]
  buildings: Building[]
  narrowSessionRead?: boolean
}) {
  const { fetchAll, serviceSessions, buildings } = deps

  /** 방문 기록 시 연결할 봉사 세션 반환 (없으면 undefined) */
  const getRecordServiceSession = (
    buildingId?: number,
    visitedAt: string = getLocalDateString(),
  ): ServiceSession | undefined => {
    if (visitedAt !== getLocalDateString()) return undefined

    const visitor = getCurrentVisitor()
    const buildingCardId = buildingId
      ? buildings.find((building) => building.id === buildingId)?.cardId
      : undefined
    const todaySessions = serviceSessions
      .filter((session) => session.userName === visitor && session.serviceDate === visitedAt)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))

    if (buildingCardId) {
      const activeSameCard = todaySessions.find((session) =>
        session.status === 'active' &&
        !session.endedAt &&
        session.primaryCardId === buildingCardId,
      )
      if (activeSameCard) return activeSameCard

      const endedSameCard = todaySessions.find((session) =>
        session.status === 'ended' &&
        session.primaryCardId === buildingCardId,
      )
      if (endedSameCard) return endedSameCard

      return undefined
    }

    return todaySessions.find((session) => session.status === 'active' && !session.endedAt)
  }

  const startServiceSession = async (input: {
    role: Role
    timeSlot: TimeSlot
    primaryCardId?: number | null
    calendarEventId?: number | null
    assignedCardId?: number | null
    assignmentId?: number | null
    source?: ServiceSession['source']
    memo?: string
  }) => {
    const serviceDate = getLocalDateString()
    const visitor = getCurrentVisitor()
    let sameSessionQuery = supabase
      .from('service_sessions')
      .select('id')
      .eq('user_name', visitor)
      .eq('service_date', serviceDate)
      .eq('time_slot', input.timeSlot)
      .eq('status', 'active')
      .limit(1)

    sameSessionQuery = input.primaryCardId
      ? sameSessionQuery.eq('primary_card_id', input.primaryCardId)
      : sameSessionQuery.is('primary_card_id', null)

    const existingResult = await sameSessionQuery
    if (existingResult.error) {
      reportMutationError(msg('봉사 시작을 저장하지 못했습니다. service_sessions SQL을 먼저 실행해 주세요.'), existingResult.error)
      return null
    }

    const existingId = existingResult.data?.[0]?.id
    const activeSessionsToEnd = serviceSessions.filter((session) =>
      session.userName === visitor &&
      session.serviceDate === serviceDate &&
      session.status === 'active' &&
      !session.endedAt &&
      session.id !== existingId,
    )

    if (activeSessionsToEnd.length > 0) {
      const endResult = await supabase
        .from('service_sessions')
        .update({ status: 'ended', ended_at: new Date().toISOString() })
        .in('id', activeSessionsToEnd.map((session) => session.id))

      if (endResult.error) {
        reportMutationError(msg('기존 봉사 세션을 종료하지 못했습니다.'), endResult.error)
        return null
      }
    }

    const payload = {
      user_name: visitor,
      role: input.role,
      calendar_event_id: input.calendarEventId ?? null,
      service_date: serviceDate,
      time_slot: input.timeSlot,
      primary_card_id: input.primaryCardId ?? null,
      assigned_card_id: input.assignedCardId ?? null,
      assignment_id: input.assignmentId ?? null,
      source: input.source ?? 'manual',
      memo: input.memo?.trim() || '',
      status: 'active' as ServiceSessionStatus,
      ended_at: null,
    }

    const result = existingId
      ? await supabase.from('service_sessions').update(payload).eq('id', existingId).select('id').single()
      : await supabase.from('service_sessions').insert(payload).select('id').single()

    if (result.error) {
      reportMutationError(msg('봉사 시작을 저장하지 못했습니다.'), result.error)
      return null
    }

    // 시스템 채팅 메시지 ("봉사를 시작했습니다") 제거 — 불필요 알림 줄이기

    // 봉사 로그 기록
    const newSessionId = result.data?.id ?? existingId ?? null
    await logServiceAction({
      sessionId: newSessionId,
      eventId: input.calendarEventId ?? null,
      cardId: input.primaryCardId ?? null,
      action: 'session_started',
      details: { time_slot: input.timeSlot, role: input.role },
    })

    await fetchAll()
    showToast(
      activeSessionsToEnd.length > 0
        ? `이전 봉사를 종료하고 ${input.timeSlot} 봉사를 시작했습니다`
        : `${input.timeSlot} 봉사를 시작했습니다`,
    )
    return newSessionId
  }

  const endServiceSession = async (sessionId: number) => {
    let targetSession: Pick<ServiceSession, 'calendarEventId' | 'primaryCardId' | 'timeSlot'> | undefined = serviceSessions.find((session) => session.id === sessionId)
    // An explicit old-session action still needs its logging metadata even when
    // ordinary screens no longer keep that session's history in memory.
    if (!targetSession && deps.narrowSessionRead) {
      const { data, error } = await supabase.from('service_sessions')
        .select('id, calendar_event_id, primary_card_id, time_slot').eq('id', sessionId).single()
      if (error || data?.id !== sessionId) {
        reportMutationError(msg('봉사 세션을 종료하지 못했습니다.'), error ?? new Error('Session unavailable'))
        return
      }
      targetSession = { calendarEventId: data.calendar_event_id, primaryCardId: data.primary_card_id, timeSlot: data.time_slot }
    }
    const result = await supabase
      .from('service_sessions')
      .update({ status: 'ended', ended_at: new Date().toISOString() })
      .eq('id', sessionId)

    if (result.error) {
      reportMutationError(msg('봉사 세션을 종료하지 못했습니다.'), result.error)
      return
    }

    // 시스템 채팅 메시지 ("봉사를 종료했습니다") 제거 — 불필요 알림 줄이기

    // 봉사 로그 기록
    await logServiceAction({
      sessionId,
      eventId: targetSession?.calendarEventId ?? null,
      cardId: targetSession?.primaryCardId ?? null,
      action: 'session_ended',
      details: { time_slot: targetSession?.timeSlot ?? null },
    })

    await fetchAll()
    showToast(msg('봉사 세션을 종료했습니다'))
  }

  return { getRecordServiceSession, startServiceSession, endServiceSession }
}
