import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import type { AppLanguage } from '../../i18n'
import { fetchMeetingCollections, fetchMeetingNoteMetas } from './api'
import { MeetingContext } from './context'
import type { MeetingHomeData } from './context'
import { koreaDate, meetingNotesEnabled } from './model'
import { MeetingReader } from './MeetingReader'
import './meetingNotes.css'

export function MeetingProvider({ userId, canManage, language, children }: { userId: number; canManage: boolean; language: AppLanguage; children: ReactNode }) {
  const { pathname } = useLocation()
  const [data, setData] = useState<MeetingHomeData>({ collections: [], notes: [] })
  const [revision, setRevision] = useState(0)
  const inFlight = useRef<Promise<MeetingHomeData> | null>(null)
  const refresh = useCallback(() => setRevision(value => value + 1), [])
  useEffect(() => {
    if (!meetingNotesEnabled || pathname !== '/') return
    let active = true
    // One metadata request per home entry; StrictMode shares the in-flight request.
    if (!inFlight.current) {
      inFlight.current = fetchMeetingCollections(koreaDate()).then(async collections => ({ collections, notes: await fetchMeetingNoteMetas(collections.map(c => c.id)) }))
      void inFlight.current.finally(() => { inFlight.current = null }).catch(() => {})
    }
    void inFlight.current.then(result => { if (active) setData(result) }).catch(() => {
      if (active) setData({ collections: [], notes: [] })
    })
    return () => { active = false }
  }, [pathname, revision])
  return <MeetingContext.Provider value={{ userId, canManage, data, refresh }}>{children}{meetingNotesEnabled && <MeetingReader language={language} userId={userId} revision={revision} />}</MeetingContext.Provider>
}
