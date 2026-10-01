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
    const open = () => setParams(previous => { const next = new URLSearchParams(previous); next.set('meetingCollection', String(collection.id)); next.delete('meetingDate'); next.delete('meetingNote'); return next })
    return <section className="meeting-home mobile-home-section" key={collection.id}>
      <button className="meeting-collection-entry" type="button" onClick={open}>
        <span><strong>{localizedMeeting(collection.nameKo, collection.nameZh, language)}</strong>
          <span className="meeting-meta">{meetingDateLabel(collection.startDate, language)}–{meetingDateLabel(collection.endDate, language)} · {t(language, 'meeting.count', { n: notes.length })}</span>
        </span>
        <span className="meeting-entry-end">{unread.length > 0 && <span className="meeting-unread" aria-label={t(language, 'meeting.new')} />}<span aria-hidden>›</span></span>
      </button>
    </section>
  })}</>
}

export function MeetingSuggestions({ language, children }: { language: AppLanguage; children: ReactNode }) {
  const context = useMeetingHome()
  const collapse = context?.data.collections.some(c => c.collapseSuggestions && homeCollectionVisible(c, koreaDate()) && context.data.notes.some(n => n.collectionId === c.id))
  return collapse ? <details className="meeting-suggestions"><summary>{t(language, 'suggestion.sectionTitle')}</summary>{children}</details> : children
}
