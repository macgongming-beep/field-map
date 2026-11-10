import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { getAuthToken } from '../lib/authToken'
import { privateUserReadsEnabled } from '../lib/privateUserReads'
import { eventParticipantNameKey, type EventParticipantUser } from '../utils/eventParticipantUsers'

type Contacts = Pick<EventParticipantUser, 'id' | 'name' | 'phone'>[]
export function useEventLeaderContacts(eventId: number, leaders: string[], users: EventParticipantUser[]) {
  const enabled = privateUserReadsEnabled()
  const token = getAuthToken()
  const names = leaders.join(',')
  const key = `${token}:${eventId}:${names}`
  const [attempt, retry] = useState(0)
  const [result, setResult] = useState<{ key: string; contacts: Contacts; error: boolean } | null>(null)
  useEffect(() => {
    if (!enabled || !token || !names || !Number.isSafeInteger(eventId) || eventId <= 0) return
    let cancelled = false
    setResult(null)
    void (async () => {
      try {
        const { data, error } = await supabase.rpc('get_event_leader_contacts', { p_event_id: eventId })
        if (error) throw error
        if (!cancelled && getAuthToken() === token) setResult({ key, contacts: data ?? [], error: false })
      } catch {
        if (!cancelled && getAuthToken() === token) setResult({ key, contacts: [], error: true })
      }
    })()
    return () => { cancelled = true }
  }, [enabled, token, eventId, names, key, attempt])
  const active = result?.key === key ? result : null
  const contacts = enabled ? active?.contacts ?? [] : users
  return {
    phoneByName: new Map(contacts.filter(u => u.phone?.trim()).map(u => [eventParticipantNameKey(u.name), u.phone!.trim()])),
    loading: enabled && !!token && !!names && !active,
    error: enabled && !!active?.error,
    retry: () => retry(n => n + 1),
  }
}
