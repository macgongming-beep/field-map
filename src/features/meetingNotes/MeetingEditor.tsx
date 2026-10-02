import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { t } from '../../i18n'
import type { AppLanguage } from '../../i18n'
import { confirmDialog } from '../../lib/confirm'
import { getOverlayRoot } from '../../lib/overlayRoot'
import { useMeetingHome } from './context'
import { fetchEventMeetingNote, fetchMeetingCollections, fetchMeetingNote, MeetingConflict, saveMeetingCollection, saveMeetingNote } from './api'
import { addDays, koreaDate, localizedMeeting, meetingNotesEnabled } from './model'
import type { MeetingCollection, MeetingNote, NoteDraft } from './model'
import { MeetingText } from './MeetingText'
import { useMeetingDialog } from './useMeetingDialog'

const emptyDraft: NoteDraft = { titleKo: '', titleZh: '', bodyKo: '', bodyZh: '', listTitleKo: '', listTitleZh: '' }
export function MeetingEditor({ eventId, noteId, language }: { eventId: number | null; noteId?: number; language: AppLanguage }) {
  const context = useMeetingHome()
  const [open, setOpen] = useState(false)
  if (!meetingNotesEnabled || !context?.canManage) return null
  return <><button type="button" className="meeting-edit-launch" onClick={() => setOpen(true)}>{t(language, noteId ? 'meeting.edit' : 'meeting.launchEditor')}</button>{open && <NoteEditor eventId={eventId} noteId={noteId} language={language} onClose={() => setOpen(false)} onSaved={context.refresh} />}</>
}
function NoteEditor({ eventId, noteId, language, onClose, onSaved }: { eventId: number | null; noteId?: number; language: AppLanguage; onClose: () => void; onSaved: () => void }) {
  const [note, setNote] = useState<MeetingNote | null>(null)
  const [draft, setDraft] = useState<NoteDraft>(emptyDraft)
  const [collections, setCollections] = useState<MeetingCollection[]>([])
  const [collectionId, setCollectionId] = useState(0)
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [conflict, setConflict] = useState(false)
  const [preview, setPreview] = useState(false)
  const [manage, setManage] = useState(false)
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    let active = true
    void Promise.all([fetchMeetingCollections(), noteId ? fetchMeetingNote(noteId) : eventId ? fetchEventMeetingNote(eventId) : Promise.resolve(null)]).then(([groups, found]) => {
      if (!active) return
      setCollections(groups); setNote(found); setDraft(found ?? emptyDraft); setCollectionId(found?.collectionId ?? 0); setReady(true); setError(''); setConflict(false)
    }).catch(() => { if (active) setError(t(language, 'meeting.failed')) })
    return () => { active = false }
  }, [eventId, noteId, language, revision])
  const dirty = (Object.keys(emptyDraft) as Array<keyof NoteDraft>).some(key => draft[key] !== (note?.[key] ?? '')) || collectionId !== (note?.collectionId ?? 0)
  const close = async () => { if (!busy && (!dirty || await confirmDialog({ message: t(language, 'meeting.discard') }))) onClose() }
  const dialogRef = useMeetingDialog(true, () => { void close() })
  const root = getOverlayRoot()
  if (!root) return null
  const save = async (archive = false) => {
    if (busy || !ready || conflict) return
    if (!collectionId || !draft.titleKo.trim() || !draft.bodyKo.trim()) { setError(t(language, 'meeting.required')); return }
    if (archive && !await confirmDialog({ message: t(language, 'meeting.archiveConfirm'), danger: true })) return
    if (!archive && (!draft.bodyZh.trim() || !draft.titleZh.trim()) && !await confirmDialog({ message: t(language, 'meeting.zhEmpty') })) return
    setBusy(true); setError('')
    try { await saveMeetingNote(eventId, collectionId, draft, note, archive); onSaved(); onClose() }
    catch (cause) { setConflict(cause instanceof MeetingConflict); setError(t(language, cause instanceof MeetingConflict ? 'meeting.conflict' : 'meeting.failed')) }
    finally { setBusy(false) }
  }
  return createPortal(<section ref={dialogRef} className="meeting-screen meeting-editor" role="dialog" aria-modal="true" aria-label={t(language, 'meeting.edit')}>
    <header className="meeting-screen-head"><h1>{t(language, 'meeting.edit')}</h1><button type="button" autoFocus disabled={busy} aria-label={t(language, 'meeting.close')} onClick={() => void close()}>×</button></header>
    <div className="meeting-scroll">
      {error && <p role="alert">{error}{(!ready || conflict) && <button type="button" onClick={async () => { if (!dirty || await confirmDialog({ message: t(language, 'meeting.discard') })) setRevision(n => n + 1) }}>{t(language, 'meeting.reload')}</button>}</p>}
      {!ready ? !error && <p>{t(language, 'meeting.loading')}</p> : note?.archivedAt ? <p>{t(language, 'meeting.archived')}</p> : <>
        {note && <p className="meeting-meta">{note.date} · {note.time} · {note.leader}{note.eventId === null && ` · ${t(language, 'meeting.detached')}`}</p>}
        <div className="meeting-collection-select"><label>{t(language, 'meeting.collection')}<select value={collectionId} disabled={busy} onChange={e => setCollectionId(Number(e.target.value))}><option value={0}>—</option>{collections.map(c => <option key={c.id} value={c.id}>{localizedMeeting(c.nameKo, c.nameZh, language)}</option>)}</select></label><button type="button" disabled={busy} onClick={() => setManage(!manage)}>{t(language, 'meeting.manage')}</button></div>
        {manage && <CollectionEditor language={language} collections={collections} onSaved={async () => { setCollections(await fetchMeetingCollections()); onSaved() }} />}
        <div className="meeting-language"><button type="button" aria-pressed={!preview} onClick={() => setPreview(false)}>{t(language, 'meeting.write')}</button><button type="button" aria-pressed={preview} onClick={() => setPreview(true)}>{t(language, 'meeting.preview')}</button></div>
        <div className="meeting-bilingual">{(['Ko', 'Zh'] as const).map(lang => <section key={lang}>{preview ? <><h2>{draft[`title${lang}`]}</h2><MeetingText text={draft[`body${lang}`]} /></> : <>
          <label>{t(language, lang === 'Ko' ? 'meeting.titleKo' : 'meeting.titleZh')}<input disabled={busy} maxLength={200} value={draft[`title${lang}`]} onChange={e => setDraft({ ...draft, [`title${lang}`]: e.target.value })} /></label>
          <label>{t(language, lang === 'Ko' ? 'meeting.listTitleKo' : 'meeting.listTitleZh')}<input disabled={busy} maxLength={200} value={draft[`listTitle${lang}`] ?? ''} onChange={e => setDraft({ ...draft, [`listTitle${lang}`]: e.target.value })} /></label>
          <label>{t(language, lang === 'Ko' ? 'meeting.bodyKo' : 'meeting.bodyZh')}<textarea disabled={busy} maxLength={30000} rows={18} value={draft[`body${lang}`]} onChange={e => setDraft({ ...draft, [`body${lang}`]: e.target.value })} /></label>
        </>}</section>)}</div>
        <footer className="meeting-actions">{note && <button type="button" disabled={busy || conflict} onClick={() => void save(true)}>{t(language, 'meeting.archive')}</button>}<button className="meeting-primary" type="button" disabled={busy || conflict} onClick={() => void save()}>{busy ? t(language, 'meeting.loading') : t(language, 'meeting.save')}</button></footer>
      </>}
    </div>
  </section>, root)
}
export function CollectionEditor({ language, collections, onSaved }: { language: AppLanguage; collections: MeetingCollection[]; onSaved: () => Promise<void> }) {
  const [selected, setSelected] = useState<MeetingCollection | undefined>()
  const [draft, setDraft] = useState<Omit<MeetingCollection, 'id' | 'updatedAt'>>({ nameKo: '', nameZh: '', startDate: koreaDate(), endDate: koreaDate(), homeVisibleUntil: addDays(koreaDate(), 14), homePosition: 'after_service', collapseSuggestions: true })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const save = async (archive = false) => {
    if (busy) return
    if (archive && !await confirmDialog({ message: t(language, 'meeting.archiveConfirm'), danger: true })) return
    setBusy(true); setError('')
    try { await saveMeetingCollection(draft, selected, archive); await onSaved(); setSelected(undefined); setDraft({ ...draft, nameKo: '', nameZh: '' }) }
    catch (cause) { setError(t(language, cause instanceof MeetingConflict ? 'meeting.conflict' : 'meeting.failed')) }
    finally { setBusy(false) }
  }
  return <form className="meeting-collection-editor" onSubmit={e => { e.preventDefault(); void save() }}>
    <label>{t(language, 'meeting.manage')}<select disabled={busy} value={selected?.id ?? 0} onChange={e => { const found = collections.find(c => c.id === Number(e.target.value)); setSelected(found); setDraft(found ?? { ...draft, nameKo: '', nameZh: '' }); setError('') }}><option value={0}>{t(language, 'meeting.newCollection')}</option>{collections.map(c => <option key={c.id} value={c.id}>{localizedMeeting(c.nameKo, c.nameZh, language)}</option>)}</select></label>
    <div className="meeting-bilingual"><label>{t(language, 'meeting.nameKo')}<input required maxLength={160} disabled={busy} value={draft.nameKo} onChange={e => setDraft({ ...draft, nameKo: e.target.value })} /></label><label>{t(language, 'meeting.nameZh')}<input maxLength={160} disabled={busy} value={draft.nameZh} onChange={e => setDraft({ ...draft, nameZh: e.target.value })} /></label></div>
    <label className="meeting-checkbox"><input role="switch" type="checkbox" disabled={busy} checked={draft.homeEnabled !== false} onChange={e => setDraft({ ...draft, homeEnabled: e.target.checked })} />{t(language, 'meeting.homeEnabled')}</label>
    <div className="meeting-dates-form"><label>{t(language, 'meeting.start')}<input type="date" required disabled={busy} max={draft.endDate} value={draft.startDate} onChange={e => setDraft({ ...draft, startDate: e.target.value })} /></label><label>{t(language, 'meeting.end')}<input type="date" required disabled={busy} min={draft.startDate} value={draft.endDate} onChange={e => setDraft({ ...draft, endDate: e.target.value, homeVisibleUntil: e.target.value ? addDays(e.target.value, 14) : '' })} /></label><label>{t(language, 'meeting.until')}<input type="date" required disabled={busy} min={draft.endDate} value={draft.homeVisibleUntil} onChange={e => setDraft({ ...draft, homeVisibleUntil: e.target.value })} /></label></div>
    <label>{t(language, 'meeting.position')}<select disabled={busy} value={draft.homePosition} onChange={e => setDraft({ ...draft, homePosition: e.target.value as MeetingCollection['homePosition'] })}><option value="after_service">{t(language, 'meeting.after')}</option><option value="top">{t(language, 'meeting.top')}</option></select></label>
    <label className="meeting-checkbox"><input type="checkbox" disabled={busy} checked={draft.collapseSuggestions} onChange={e => setDraft({ ...draft, collapseSuggestions: e.target.checked })} />{t(language, 'meeting.collapse')}</label>
    {error && <p role="alert">{error}</p>}<div className="meeting-actions">{selected && <button type="button" disabled={busy} onClick={() => void save(true)}>{t(language, 'meeting.archive')}</button>}<button type="submit" disabled={busy}>{t(language, 'meeting.save')}</button></div>
  </form>
}
