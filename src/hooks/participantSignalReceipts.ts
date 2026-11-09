import { calendarApplicationRefreshEnabled } from './calendarApplicationRefresh'
import { calendarNavigationReuseEnabled } from './calendarNavigationCache'

export type ParticipantRow = { id: number; user_name: string; role: string }
export type ParticipantSignal = {
  eventType?: string
  new?: { id?: unknown; event_id?: unknown; user_name?: unknown; role?: unknown }
  old?: { id?: unknown; event_id?: unknown; user_name?: unknown; role?: unknown }
}
export type ParticipantStamp = { epoch: number; version: number; scope: string; user: string }

export function participantSignalDedupEnabled(
  flag = import.meta.env.VITE_CALENDAR_PARTICIPANT_DEDUP_ENABLED,
  demo = import.meta.env.VITE_DEMO_MODE,
  application = calendarApplicationRefreshEnabled(),
  navigation = calendarNavigationReuseEnabled(),
) {
  return application && navigation && (flag ?? demo) === 'true'
}

// Only an applied post-write snapshot can acknowledge a signal. DELETE needs a
// previously observed, now absent row ID; an unknown tombstone is never guessed.
export function createParticipantSignalReceipts() {
  const snapshots = new Map<number, { user: string; rows: ParticipantRow[] }>()
  const receipts = new Map<number, { stamp: ParticipantStamp; at: number; kind: 'INSERT' | 'DELETE'; rows: ParticipantRow[] }>()
  return {
    reset() { snapshots.clear(); receipts.clear() },
    applied(eventId: number, rows: ParticipantRow[], stamp: ParticipantStamp, kind?: 'INSERT' | 'DELETE', now = Date.now()) {
      const previous = snapshots.get(eventId)
      const own = rows.filter(row => row.user_name === stamp.user && row.role === '신청')
      snapshots.delete(eventId)
      snapshots.set(eventId, { user: stamp.user, rows: own })
      receipts.delete(eventId)
      if (kind && stamp.user) {
        const proof = kind === 'INSERT' ? own : previous?.user === stamp.user
          ? previous.rows.filter(row => !rows.some(current => current.id === row.id)) : []
        if (proof.length) receipts.set(eventId, { stamp, at: now, kind, rows: proof })
      }
      while (snapshots.size > 100) {
        const oldest = snapshots.keys().next().value!
        snapshots.delete(oldest); receipts.delete(oldest)
      }
    },
    covers(signal: ParticipantSignal, stamp: ParticipantStamp, loaded: number[], now = Date.now()) {
      if (!signal || (signal.eventType !== 'INSERT' && signal.eventType !== 'DELETE')) return false
      const row = signal.eventType === 'INSERT' ? signal.new : signal.old
      if (!row || typeof row.id !== 'number' || !Number.isSafeInteger(row.id) || row.id <= 0) return false
      for (const [eventId, proof] of receipts) {
        if (proof.kind !== signal.eventType || !loaded.includes(eventId) || now < proof.at || now - proof.at >= 120_000) continue
        if (Object.entries(proof.stamp).some(([key, value]) => stamp[key as keyof ParticipantStamp] !== value)) continue
        if (!proof.rows.some(p => p.id === row.id)) continue
        if (row.event_id !== undefined && row.event_id !== eventId) continue
        if (row.user_name !== undefined && row.user_name !== stamp.user) continue
        if (row.role !== undefined && row.role !== '신청') continue
        if (signal.eventType === 'INSERT' && (row.event_id !== eventId || row.user_name !== stamp.user || row.role !== '신청')) continue
        return true
      }
      return false
    },
  }
}
