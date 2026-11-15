import { supabase } from '../../lib/supabase'
import { getAuthToken } from '../../lib/authToken'
import { confirmDialog } from '../../lib/confirm'
import { msg } from '../../lib/msg'
import type { MeetingAccess, ServicePlan } from './model'

export async function applyServiceActivity(eventId: number, activity: 'service'|'return_visit') {
  const token = getAuthToken()
  if (!token) throw new Error(msg('다시 로그인해 주세요.'))
  const {data,error}=await supabase.rpc('apply_service_activity_tx',{p_token:token,p_event_id:eventId,p_activity:activity})
  if(error || !data?.ok) throw new Error(error?.code==='PT409'
    ? msg('이미 신청한 종류를 변경하려면 먼저 신청을 취소해 주세요.')
    : msg('봉사 신청을 저장하지 못했습니다.'))
  return data as {ok:true;created:boolean}
}

export async function saveServicePlan(plan: ServicePlan) {
  const token = getAuthToken()
  if (!token) throw new Error(msg('다시 로그인해 주세요.'))
  const { data, error } = await supabase.rpc('save_service_events_tx', {
    p_token: token, p_rows: plan.rows, p_request_id: plan.requestId, p_notify: plan.notify,
  })
  if (error) throw new Error(error.code === 'PT409' ? msg('일정이 변경되었습니다. 다시 열어 확인해 주세요.') : error.message)
  if (!data?.ok) throw new Error(msg('일정을 저장하지 못했습니다.'))
  return data as { ok: true; ids: number[] }
}
export async function readMeetingAccess(eventId: number) {
  const token = getAuthToken()
  const { data,error } = await supabase.rpc('get_event_meeting_access',{ p_event_id: eventId })
  if (error) throw new Error(msg('화상 모임 정보를 불러오지 못했습니다.'))
  if (!token || token !== getAuthToken()) throw new Error(msg('다시 로그인해 주세요.'))
  return data as (MeetingAccess & { version: string }) | null
}
export async function confirmOverlappingApplication(eventId: number) {
  const { data,error } = await supabase.rpc('get_event_application_overlaps',{ p_event_id: eventId })
  if (error) throw new Error(msg('신청 시간을 확인하지 못했습니다. 다시 시도해 주세요.'))
  const overlaps = data as Array<{ id: number; title: string; time: string; endTime: string | null; unknown: boolean }>
  if (!Array.isArray(overlaps)) throw new Error('Invalid overlap response')
  if (!overlaps.length) return true
  const message = overlaps.some(e => !e.unknown)
    ? msg('같은 시간대에 신청한 봉사가 있습니다. 추가로 신청하시겠어요?')
    : msg('시간이 비어 있는 신청 일정이 있어 중복 여부를 확인할 수 없습니다. 추가로 신청하시겠어요?')
  return confirmDialog({ message: `${message}\n\n${overlaps.map(e => `${e.time || '—'}${e.endTime ? `–${e.endTime}` : ''} ${e.title}`).join('\n')}`,
    confirmLabel: msg('추가 신청'), cancelLabel: msg('돌아가기') })
}
