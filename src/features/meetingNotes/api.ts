import { supabase } from '../../lib/supabase'
import { getAuthToken } from '../../lib/authToken'
import type { MeetingCollection, MeetingNote, MeetingNoteMeta, NoteDraft } from './model'

export const NOTE_META_COLUMNS = 'id,event_id,collection_id,title_ko,title_zh,excerpt_ko,excerpt_zh,reading_minutes_ko,reading_minutes_zh,event_date_snapshot,event_time_snapshot,event_place_snapshot,event_leader_snapshot,updated_at,archived_at'
type Row = Record<string, unknown>
function collection(row: Row): MeetingCollection {
  return { id: Number(row.id), nameKo: String(row.name_ko), nameZh: String(row.name_zh), startDate: String(row.start_date), endDate: String(row.end_date), homeVisibleUntil: String(row.home_visible_until), homePosition: row.home_position as MeetingCollection['homePosition'], collapseSuggestions: Boolean(row.collapse_suggestions), updatedAt: String(row.updated_at) }
}
function meta(row: Row): MeetingNoteMeta {
  return { id: Number(row.id), eventId: row.event_id == null ? null : Number(row.event_id), collectionId: Number(row.collection_id), titleKo: String(row.title_ko), titleZh: String(row.title_zh), excerptKo: String(row.excerpt_ko), excerptZh: String(row.excerpt_zh), readingMinutesKo: Number(row.reading_minutes_ko), readingMinutesZh: Number(row.reading_minutes_zh), date: String(row.event_date_snapshot), time: String(row.event_time_snapshot), place: String(row.event_place_snapshot), leader: String(row.event_leader_snapshot), updatedAt: String(row.updated_at), archivedAt: row.archived_at as string | null }
}
function full(row: Row): MeetingNote { return { ...meta(row), bodyKo: String(row.body_ko), bodyZh: String(row.body_zh) } }
export async function fetchMeetingCollections(date?: string): Promise<MeetingCollection[]> {
  let query = supabase.from('service_meeting_collections').select('id,name_ko,name_zh,start_date,end_date,home_visible_until,home_position,collapse_suggestions,updated_at').is('archived_at', null).order('start_date', { ascending: false })
  if (date) query = query.lte('start_date', date).gte('home_visible_until', date)
  const { data, error } = await query
  if (error) throw error
  return (data ?? []).map(collection)
}
export async function fetchMeetingNoteMetas(collectionIds: number[]): Promise<MeetingNoteMeta[]> {
  if (!collectionIds.length) return []
  const { data, error } = await supabase.from('service_meeting_notes').select(NOTE_META_COLUMNS).in('collection_id', collectionIds).is('archived_at', null).order('event_date_snapshot', { ascending: false }).order('event_time_snapshot', { ascending: false }).order('id')
  if (error) throw error
  return (data ?? []).map(meta)
}
export async function fetchMeetingNote(id: number): Promise<MeetingNote> {
  const { data, error } = await supabase.from('service_meeting_notes').select(`${NOTE_META_COLUMNS},body_ko,body_zh`).eq('id', id).is('archived_at', null).single()
  if (error) throw error
  return full(data)
}
export async function fetchEventMeetingNote(eventId: number): Promise<MeetingNote | null> {
  const { data, error } = await supabase.from('service_meeting_notes').select(`${NOTE_META_COLUMNS},body_ko,body_zh`).eq('event_id', eventId).maybeSingle()
  if (error) throw error
  return data ? full(data) : null
}
export class MeetingConflict extends Error { constructor() { super('meeting.conflict') } }
async function saveResult(name: string, args: Row): Promise<number> {
  const token = getAuthToken()
  if (!token) throw new Error('meeting.signIn')
  const { data, error } = await supabase.rpc(name, { ...args, p_token: token })
  if (error) throw error
  if (data?.conflict) throw new MeetingConflict()
  if (!data?.ok || !data.id) throw new Error('meeting.failed')
  return Number(data.id)
}
export function saveMeetingCollection(draft: Omit<MeetingCollection, 'id' | 'updatedAt'>, existing?: MeetingCollection, archive = false) {
  return saveResult('save_service_meeting_collection', { p_id: existing?.id ?? null, p_expected_updated_at: existing?.updatedAt ?? null,
    p_data: { name_ko: draft.nameKo, name_zh: draft.nameZh, start_date: draft.startDate, end_date: draft.endDate, home_visible_until: draft.homeVisibleUntil, home_position: draft.homePosition, collapse_suggestions: draft.collapseSuggestions, archive } })
}
export function saveMeetingNote(eventId: number | null, collectionId: number, draft: NoteDraft, existing?: MeetingNote | null, archive = false) {
  return saveResult('save_service_meeting_note', { p_id: existing?.id ?? null, p_event_id: eventId, p_collection_id: collectionId, p_expected_updated_at: existing?.updatedAt ?? null,
    p_data: { title_ko: draft.titleKo, title_zh: draft.titleZh, body_ko: draft.bodyKo, body_zh: draft.bodyZh, archive } })
}
