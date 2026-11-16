import type { AppLanguage } from '../../i18n'
import type { CalendarEvent } from '../../types'

// Never enable this demo implementation against a production database.
export function groupServiceEnabled() {
  return import.meta.env.VITE_DEMO_MODE === 'true'
    && import.meta.env.VITE_GROUP_SERVICE_ENABLED !== 'false'
    && import.meta.env.VITE_SUPABASE_URL === 'https://itjlykpjmlcvanqpmkmc.supabase.co'
}
export const serviceGroups = [
  { code: 'dongtan', ko: '동탄', zh: '东滩', en: 'Dongtan' },
  { code: 'singal', ko: '신갈', zh: '新葛', en: 'Singal' },
  { code: 'cheoin', ko: '처인', zh: '处仁', en: 'Cheoin' },
  { code: 'dongbaek', ko: '동백', zh: '东柏', en: 'Dongbaek' },
] as const
export type GroupCode = typeof serviceGroups[number]['code']
export function territoryApplicants(event: CalendarEvent) {
  const returns = new Set(event.returnVisitApplicants ?? [])
  return Array.from(new Set([...event.applicants,...event.assigned])).filter(name=>!returns.has(name))
}
export type MeetingAccess = { joinUrl: string; meetingNumber: string; passcode: string }
export type ServiceFields = {
  groupServiceScope?: boolean
  serviceKind?: 'congregation' | 'group'
  targetGroups?: GroupCode[]
  primaryLeaderUserId?: number | null
  meetingMode?: 'none' | 'in_person' | 'virtual'
  editVersion?: string
}
export type ServicePayload = {
  event_date: string; time: string; end_time: string; title: string; place: string;
  leader_name: string; memo: string; meeting_map_url: string; allow_applications: boolean;
  service_kind: 'congregation' | 'group'; target_groups: GroupCode[];
  primary_leader_user_id: number | null; meeting_mode: 'none' | 'in_person' | 'virtual';
  access: MeetingAccess; series_id?: string;
  group_service_scope?: boolean;
}
export type ServiceRow = { id?: number; version?: string; payload: ServicePayload }
export type ServicePlan = { rows: ServiceRow[]; requestId: string; notify: boolean }
export const emptyAccess: MeetingAccess = { joinUrl: '', meetingNumber: '', passcode: '' }
export function groupLabel(codes: readonly string[], language: AppLanguage) {
  return serviceGroups.filter(g => codes.includes(g.code)).map(g => g[language]).join(' · ')
}
export function eventBlocks(events: CalendarEvent[], groupName?: string) {
  const own = serviceGroups.find(g => g.zh === groupName || g.ko === groupName || g.code === groupName)?.code
  const blocks = new Map<string, CalendarEvent[]>()
  for (const e of [...events].sort((a,b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time) || a.id-b.id)) {
    const key = e.groupServiceScope ? `groups:${e.date}:${e.time}:${e.endTime ?? ''}` : e.serviceKind === 'group' && e.targetGroups?.length
      ? `${e.date}:${[...e.targetGroups].sort().join(',')}` : `event:${e.id}`
    blocks.set(key, [...(blocks.get(key) ?? []),e])
  }
  return [...blocks.values()].sort((a,b) => a[0].date.localeCompare(b[0].date)
    || Number(!!own && !!b[0].targetGroups?.includes(own))-Number(!!own && !!a[0].targetGroups?.includes(own)))
}
export function sameServiceDay(a: CalendarEvent,b: CalendarEvent) {
  return a.serviceKind === 'group' && b.serviceKind === 'group' && a.date === b.date
    && Boolean(a.groupServiceScope) === Boolean(b.groupServiceScope)
    && [...(a.targetGroups ?? [])].sort().join(',') === [...(b.targetGroups ?? [])].sort().join(',')
}

export function groupSlotEvents(event: CalendarEvent, events: CalendarEvent[]) {
  return events.filter(e=>e.groupServiceScope && e.date===event.date && e.time===event.time && e.endTime===event.endTime)
}

export function visibleServiceEventCount(events: CalendarEvent[]) {
  return eventBlocks(events).reduce((count,block)=>count+(block[0].groupServiceScope?1:block.length),0)
}
