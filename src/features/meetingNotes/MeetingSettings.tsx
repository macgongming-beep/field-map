import { useEffect, useState } from 'react'
import type { AppLanguage } from '../../i18n'
import { t } from '../../i18n'
import { fetchMeetingCollections } from './api'
import { CollectionEditor } from './MeetingEditor'
import { useMeetingHome } from './context'
import { meetingNotesEnabled } from './model'
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
  useEffect(() => {
    let active = true
    // Management must include collections hidden from home or outside their dates.
    void fetchMeetingCollections().then(rows => {
      if (active) { setCollections(rows); setReady(true); setError(false) }
    }).catch(() => { if (active) setError(true) })
    return () => { active = false }
  }, [attempt])
  return <section className="meeting-settings" style={{ padding: 24 }}>
    <h1 className="page-header-title meeting-settings-title">{t(language, 'meeting.settings')}</h1>
    {error ? <p role="alert">{t(language, 'meeting.failed')} <button type="button" onClick={() => setAttempt(n => n + 1)}>{t(language, 'meeting.reload')}</button></p>
      : !ready ? <p>{t(language, 'meeting.loading')}</p>
      : <CollectionEditor language={language} collections={collections} onSaved={async () => {
        setCollections(await fetchMeetingCollections()); refresh()
      }} />}
  </section>
}
