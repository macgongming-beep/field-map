import type { AppLanguage } from '../../i18n'

export type MeetingCollection = {
  id: number; nameKo: string; nameZh: string; startDate: string; endDate: string
  homeVisibleUntil: string; homePosition: 'top' | 'after_service'; collapseSuggestions: boolean
  updatedAt: string
}
export type MeetingNoteMeta = {
  id: number; eventId: number | null; collectionId: number; titleKo: string; titleZh: string
  excerptKo: string; excerptZh: string; readingMinutesKo: number; readingMinutesZh: number
  date: string; time: string; place: string; leader: string; updatedAt: string; archivedAt: string | null
}
export type MeetingNote = MeetingNoteMeta & { bodyKo: string; bodyZh: string }
export type NoteDraft = Pick<MeetingNote, 'titleKo' | 'titleZh' | 'bodyKo' | 'bodyZh'>
export const meetingNotesEnabled = import.meta.env.VITE_SERVICE_MEETING_NOTES_ENABLED === 'true'

export function koreaDate(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}
export function homeCollectionVisible(collection: MeetingCollection, date: string) {
  return collection.startDate <= date && date <= collection.homeVisibleUntil
}
export function localizedMeeting(ko: string, zh: string, language: AppLanguage) {
  return language === 'zh' && zh.trim() ? zh : ko
}
export function addDays(date: string, days: number): string {
  return new Date(new Date(`${date}T00:00:00Z`).getTime() + days * 86400000).toISOString().slice(0, 10)
}
export function readNoteVersion(userId: number, noteId: number): string | null {
  try { return localStorage.getItem(`meetingRead:${userId}:${noteId}`) } catch { return null }
}
export function markNoteRead(userId: number, note: MeetingNoteMeta) {
  try { localStorage.setItem(`meetingRead:${userId}:${note.id}`, note.updatedAt) } catch { /* Reading works with storage disabled. */ }
}
