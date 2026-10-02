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
  const [trashCollections, setTrashCollections] = useState<MeetingCollection[]>([])
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let active = true
    // Keep the editor mounted when opening trash so unsaved input survives.
    void Promise.all([fetchMeetingCollections(undefined), trash ? fetchMeetingCollections('trash') : Promise.resolve([])]).then(([rows, deleted]) => {
      if (active) { setCollections(rows); setTrashCollections(deleted); setReady(true); setError(false) }
    }).catch(() => { if (active) setError(true) })
    return () => { active = false }
  }, [attempt, trash])
  const change = async (collection: MeetingCollection, action: 'restore' | 'purge') => {
    if (busy) return
    if (action === 'purge' && !await confirmDialog({ message: `${localizedMeeting(collection.nameKo, collection.nameZh, language)}\n${t(language, 'meeting.purgeConfirm')}`, danger: true })) return
    setBusy(true); setError(false)
    try { await changeMeetingCollection(collection, action); setAttempt(n => n + 1); refresh() }
    catch { setError(true) }
    finally { setBusy(false) }
  }
  return <section className="meeting-settings" style={{ padding: 24 }}>
    <h1 className="page-header-title meeting-settings-title">{t(language, 'meeting.settings')}</h1>
    {error && <p role="alert">{t(language, 'meeting.failed')} <button type="button" onClick={() => setAttempt(n => n + 1)}>{t(language, 'meeting.reload')}</button></p>}
    {!ready ? <p>{t(language, 'meeting.loading')}</p>
      : <CollectionEditor language={language} collections={collections} onSaved={async () => {
        setCollections(await fetchMeetingCollections()); if (trash) setTrashCollections(await fetchMeetingCollections('trash')); refresh()
      }} />}
    <details className="meeting-trash" open={trash} onToggle={event => setTrash(event.currentTarget.open)}>
      <summary>{t(language, 'meeting.trash')}</summary>
      {trash && ready && <div>{trashCollections.length === 0 && <p>{t(language, 'meeting.trashEmpty')}</p>}{trashCollections.map(collection => <section key={collection.id} className="meeting-trash-row"><h2>{localizedMeeting(collection.nameKo, collection.nameZh, language)}</h2><div className="meeting-actions"><button disabled={busy} onClick={() => void change(collection, 'restore')}>{t(language, 'meeting.restore')}</button><button disabled={busy} onClick={() => void change(collection, 'purge')}>{t(language, 'meeting.purge')}</button></div></section>)}</div>}
    </details>
  </section>
}
