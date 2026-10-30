import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import type { AppLanguage } from '../../i18n'
import { fetchMeetingCollections, fetchMeetingNoteMetas } from './api'
import { MeetingContext } from './context'
import type { MeetingHomeData } from './context'
import { meetingNotesEnabled } from './model'
import { MeetingReader } from './MeetingReader'
import { getAuthToken } from '../../lib/authToken'
import './meetingNotes.css'

export function MeetingProvider({ userId, canManage, language, children }: { userId: number; canManage: boolean; language: AppLanguage; children: ReactNode }) {
  const { pathname } = useLocation()
  const [data, setData] = useState<MeetingHomeData>({ collections: [], notes: [] })
  const [revision, setRevision] = useState(0)
  const inFlight = useRef<{ key: string; promise: Promise<MeetingHomeData> } | null>(null)
  const refresh = useCallback(() => setRevision(value => value + 1), [])
  useEffect(() => {
    if (!meetingNotesEnabled || pathname !== '/') return
    let active = true
    const token = getAuthToken()
    const key = JSON.stringify([userId, token, revision])
    // One metadata request per home entry; StrictMode shares the in-flight request.
    if (inFlight.current?.key !== key) {
      const promise = fetchMeetingCollections('home').then(async collections => ({ collections, notes: import.meta.env.VITE_DEMO_MODE === 'true'
        ? await fetchMeetingNoteMetas(collections.map(c => c.id), true)
        : await fetchMeetingNoteMetas(collections.map(c => c.id)) }))
      const entry = { key, promise }
      inFlight.current = entry
      void promise.finally(() => { if (inFlight.current === entry) inFlight.current = null }).catch(() => {})
    }
    void inFlight.current.promise.then(result => { if (active && getAuthToken() === token) setData(result) }).catch(() => {
      if (active && getAuthToken() === token) setData({ collections: [], notes: [] })
    })
    return () => { active = false }
  }, [pathname, revision, userId])
  return <MeetingContext.Provider value={{ userId, canManage, data, refresh }}>{children}{meetingNotesEnabled && <MeetingReader language={language} userId={userId} revision={revision} />}</MeetingContext.Provider>
}
