import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useSearchParams } from 'react-router-dom'
import type { AppLanguage } from '../../i18n'
import { t } from '../../i18n'
import { getOverlayRoot } from '../../lib/overlayRoot'
import { fetchMeetingCollections, fetchMeetingNote, fetchMeetingNoteMetas } from './api'
import { localizedMeeting, markNoteRead, readNoteVersion } from './model'
import type { MeetingCollection, MeetingNote, MeetingNoteMeta } from './model'
import { MeetingText } from './MeetingText'
import { MeetingEditor } from './MeetingEditor'
import { useMeetingDialog } from './useMeetingDialog'

export function MeetingReader({ language, userId, revision = 0 }: { language: AppLanguage; userId: number; revision?: number }) {
  const [params, setParams] = useSearchParams()
  const collectionId = Number(params.get('meetingCollection'))
  const noteId = Number(params.get('meetingNote'))
  const date = params.get('meetingDate')
  const [collection, setCollection] = useState<MeetingCollection | null>(null)
  const [notes, setNotes] = useState<MeetingNoteMeta[]>([])
  const [note, setNote] = useState<MeetingNote | null>(null)
  const [error, setError] = useState(false)
  const [retry, setRetry] = useState(0)
  const [bodyLanguage, setBodyLanguage] = useState<AppLanguage>(language)
  const cache = useRef(new Map<number, MeetingNote>())
  const bodyRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!collectionId) return
    let active = true
    void Promise.all([fetchMeetingCollections(), fetchMeetingNoteMetas([collectionId])]).then(([collections, metas]) => {
      if (!active) return
      setCollection(collections.find(c => c.id === collectionId) ?? null); setNotes(metas); setError(false)
    }).catch(() => { if (active) setError(true) })
    return () => { active = false }
  }, [collectionId, retry, revision])
  useEffect(() => {
    if (!collectionId || !noteId || !notes.some(n => n.id === noteId && n.collectionId === collectionId)) return
    let active = true
    const cached = cache.current.get(noteId)
    const meta = notes.find(n => n.id === noteId)!
    void (cached?.updatedAt === meta.updatedAt ? Promise.resolve(cached) : fetchMeetingNote(noteId)).then(result => {
      if (!active || result.collectionId !== collectionId) return
      cache.current.set(noteId, result); setNote(result); setError(false)
      markNoteRead(userId, result)
      bodyRef.current?.scrollTo?.(0, 0)
    }).catch(() => { if (active) setError(true) })
    return () => { active = false }
  }, [collectionId, noteId, notes, userId, retry])
  const close = () => setParams(previous => { const next = new URLSearchParams(previous); for (const key of ['meetingCollection', 'meetingNote', 'meetingDate']) next.delete(key); return next }, { replace: true })
  const dialogRef = useMeetingDialog(Boolean(collectionId), close)
  if (!collectionId) return null
  const root = getOverlayRoot()
  if (!root) return null
  const openNote = (id: number) => setParams(previous => { const next = new URLSearchParams(previous); next.set('meetingNote', String(id)); return next })
  const current = note?.id === noteId && note.collectionId === collectionId ? note : null
  const sorted = [...notes].sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`) || a.id - b.id)
  const index = sorted.findIndex(n => n.id === noteId)
  return createPortal(<section ref={dialogRef} className="meeting-screen" role="dialog" aria-modal="true" aria-label={t(language, 'meeting.title')}>
    <header className="meeting-screen-head"><button autoFocus type="button" aria-label={t(language, 'meeting.back')} onClick={() => noteId ? setParams(previous => { const next = new URLSearchParams(previous); next.delete('meetingNote'); return next }, { replace: true }) : close()}>‹</button><h1>{collection?.id === collectionId ? localizedMeeting(collection.nameKo, collection.nameZh, language) : t(language, 'meeting.title')}</h1><button type="button" aria-label={t(language, 'meeting.close')} onClick={close}>×</button></header>
    <div className="meeting-scroll" ref={bodyRef}>
      {error ? <p role="alert">{t(language, 'meeting.failed')} <button onClick={() => setRetry(n => n + 1)}>{t(language, 'meeting.retry')}</button></p> : noteId ? current ? <article>
        <div className="meeting-language" role="group" aria-label={t(language, 'meeting.title')}><button aria-pressed={bodyLanguage !== 'zh'} onClick={() => setBodyLanguage('ko')}>한국어</button><button aria-pressed={bodyLanguage === 'zh'} onClick={() => setBodyLanguage('zh')}>中文</button></div>
        <h2>{localizedMeeting(current.titleKo, current.titleZh, bodyLanguage)}</h2><p className="meeting-meta">{current.date} · {current.time} · {current.leader}</p><p className="meeting-meta">{current.place}{current.eventId === null && ` · ${t(language, 'meeting.detached')}`}</p>
        <MeetingText text={localizedMeeting(current.bodyKo, current.bodyZh, bodyLanguage)} />
        <MeetingEditor eventId={current.eventId} noteId={current.id} language={language} />
        <nav className="meeting-prev-next"><button disabled={index <= 0} onClick={() => openNote(sorted[index - 1].id)}>{t(language, 'meeting.previous')}</button><button disabled={index < 0 || index >= sorted.length - 1} onClick={() => openNote(sorted[index + 1].id)}>{t(language, 'meeting.next')}</button></nav>
      </article> : <p>{collection?.id === collectionId && !notes.some(n => n.id === noteId) ? t(language, 'meeting.empty') : t(language, 'meeting.loading')}</p> : <>
        {notes.filter(n => n.collectionId === collectionId && (!date || n.date === date)).length === 0 && <p>{t(language, 'meeting.empty')}</p>}
        {[...new Set(notes.filter(n => n.collectionId === collectionId && (!date || n.date === date)).map(n => n.date))].map(day => <section className="meeting-list-day" key={day}><h2>{day}</h2>{notes.filter(n => n.date === day && n.collectionId === collectionId).map(n => <button className="meeting-list-row" key={n.id} onClick={() => openNote(n.id)}>
          <strong>{localizedMeeting(n.titleKo, n.titleZh, language)}</strong>{readNoteVersion(userId, n.id) !== n.updatedAt && <span className="meeting-new">{t(language, 'meeting.new')}</span>}
          <span className="meeting-meta">{n.time} · {n.leader} · {t(language, 'meeting.minutes', { n: language === 'zh' && n.excerptZh ? n.readingMinutesZh : n.readingMinutesKo })}</span>
          <span className="meeting-excerpt">{localizedMeeting(n.excerptKo, n.excerptZh, language)}</span>
        </button>)}</section>)}
      </>}
    </div>
  </section>, root)
}
