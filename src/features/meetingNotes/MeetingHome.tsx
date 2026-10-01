import type { ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { t } from '../../i18n'
import type { AppLanguage } from '../../i18n'
import { useMeetingHome } from './context'
import { homeCollectionVisible, koreaDate, localizedMeeting, readNoteVersion, meetingDateLabel } from './model'

export function MeetingHome({ language, position }: { language: AppLanguage; position: 'top' | 'after_service' }) {
  const context = useMeetingHome()
  const [, setParams] = useSearchParams()
  if (!context) return null
  return <>{context.data.collections.filter(c => c.homePosition === position && homeCollectionVisible(c, koreaDate())).map(collection => {
    const notes = context.data.notes.filter(note => note.collectionId === collection.id)
    if (!notes.length) return null
    const unread = notes.filter(note => readNoteVersion(context.userId, note.id) !== note.updatedAt)
    const open = (date?: string) => setParams(previous => { const next = new URLSearchParams(previous); next.set('meetingCollection', String(collection.id)); if (date) next.set('meetingDate', date); else next.delete('meetingDate'); return next })
    return <section className="meeting-home mobile-home-section" key={collection.id}>
      <div className="meeting-heading"><h2>{localizedMeeting(collection.nameKo, collection.nameZh, language)}</h2><button type="button" onClick={() => open()}>{t(language, 'meeting.all')} <span aria-hidden>›</span></button></div>
      <p className="meeting-meta">{t(language, 'meeting.count', { n: notes.length })}{unread.length > 0 && <span> · {t(language, 'meeting.unread', { n: unread.length })}</span>}</p>
      <button className="meeting-latest" type="button" onClick={() => setParams(previous => { const next = new URLSearchParams(previous); next.set('meetingCollection', String(collection.id)); next.set('meetingNote', String(notes[0].id)); return next })}>
        <span className="meeting-meta">{meetingDateLabel(notes[0].date, language)} · {notes[0].time}</span>
        <strong>{localizedMeeting(notes[0].titleKo, notes[0].titleZh, language)}</strong>
      </button>
      {new Set(notes.map(note => note.date)).size > 1 && <div className="meeting-dates">{[...new Set(notes.map(note => note.date))].sort().map(date => <button type="button" key={date} onClick={() => open(date)}>{meetingDateLabel(date, language)}{unread.some(note => note.date === date) && <span className="meeting-unread" aria-label={t(language, 'meeting.new')} />}</button>)}</div>}
    </section>
  })}</>
}

export function MeetingSuggestions({ language, children }: { language: AppLanguage; children: ReactNode }) {
  const context = useMeetingHome()
  const collapse = context?.data.collections.some(c => c.collapseSuggestions && homeCollectionVisible(c, koreaDate()) && context.data.notes.some(n => n.collectionId === c.id))
  return collapse ? <details className="meeting-suggestions"><summary>{t(language, 'suggestion.sectionTitle')}</summary>{children}</details> : children
}
