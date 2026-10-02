import { useEffect, useState } from 'react'
import type { AppLanguage } from '../../i18n'
import { t } from '../../i18n'
import { changeMeetingCollection, fetchMeetingCollections } from './api'
import { confirmDialog } from '../../lib/confirm'
import { CollectionEditor } from './MeetingEditor'
import { useMeetingHome } from './context'
import { localizedMeeting, meetingNotesEnabled } from './model'
import type { MeetingCollection } from './model'

export function MeetingSettings({ language }: { language: AppLanguage }) {
  const context = useMeetingHome()
  if (!meetingNotesEnabled || !context?.canManage) return null
  return <CollectionSettings language={language} refresh={context.refresh} />
}

function CollectionSettings({ language, refresh }: { language: AppLanguage; refresh: () => void }) {
  const [collections, setCollections] = useState<MeetingCollection[]>([])
  const [ready, setReady] = useState(false)
  const [error, setError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [trash, setTrash] = useState(false)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let active = true
    // Management must include collections hidden from home or outside their dates.
    setReady(false)
    void fetchMeetingCollections(trash ? 'trash' : undefined).then(rows => {
      if (active) { setCollections(rows); setReady(true); setError(false) }
    }).catch(() => { if (active) setError(true) })
    return () => { active = false }
  }, [attempt, trash])
  const change = async (collection: MeetingCollection, action: 'restore' | 'purge') => {
    if (busy) return
    if (action === 'purge' && !await confirmDialog({ message: `${localizedMeeting(collection.nameKo, collection.nameZh, language)}\n${t(language, 'meeting.purgeConfirm')}`, danger: true })) return
    setBusy(true); setError(false)
    try { await changeMeetingCollection(collection, action); setCollections(await fetchMeetingCollections('trash')); refresh() }
    catch { setError(true) }
    finally { setBusy(false) }
  }
  return <section className="meeting-settings" style={{ padding: 24 }}>
    <h1 className="page-header-title meeting-settings-title">{t(language, 'meeting.settings')}</h1>
    <div className="meeting-language" role="tablist"><button role="tab" aria-selected={!trash} disabled={busy} onClick={() => setTrash(false)}>{t(language, 'meeting.manage')}</button><button role="tab" aria-selected={trash} disabled={busy} onClick={() => setTrash(true)}>{t(language, 'meeting.trash')}</button></div>
    {error ? <p role="alert">{t(language, 'meeting.failed')} <button type="button" onClick={() => setAttempt(n => n + 1)}>{t(language, 'meeting.reload')}</button></p>
      : !ready ? <p>{t(language, 'meeting.loading')}</p>
      : trash ? <div>{collections.length === 0 && <p>{t(language, 'meeting.trashEmpty')}</p>}{collections.map(collection => <section key={collection.id} className="meeting-trash-row"><h2>{localizedMeeting(collection.nameKo, collection.nameZh, language)}</h2><div className="meeting-actions"><button disabled={busy} onClick={() => void change(collection, 'restore')}>{t(language, 'meeting.restore')}</button><button disabled={busy} onClick={() => void change(collection, 'purge')}>{t(language, 'meeting.purge')}</button></div></section>)}</div>
      : <CollectionEditor language={language} collections={collections} onSaved={async () => {
        setCollections(await fetchMeetingCollections()); refresh()
      }} />}
  </section>
}
