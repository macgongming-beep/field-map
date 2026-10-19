import { useEffect, useState } from 'react'
import type { ReturnVisitLog } from '../types'
import { getAuthToken } from '../lib/authToken'
import { withLoadDeadline } from '../lib/loadDeadline'
import { lazyReturnVisitLogsEnabled, readReturnVisitLogs } from './returnVisitLogReader'

export function useReturnVisitLogDetails(id: number | null, snapshot: ReturnVisitLog[]) {
  const enabled = lazyReturnVisitLogsEnabled()
  const token = getAuthToken()
  const [retry, setRetry] = useState(0)
  const [state, setState] = useState<{
    id: number; token: string | null; snapshot: ReturnVisitLog[]; retry: number;
    logs: ReturnVisitLog[]; error: boolean
  } | null>(null)
  useEffect(() => {
    if (!enabled || id === null) return
    let active = true
    void withLoadDeadline(readReturnVisitLogs(id)).then((logs) => {
      if (active && getAuthToken() === token) setState({ id, token, snapshot, retry, logs, error: false })
    }, () => {
      if (active && getAuthToken() === token) setState({ id, token, snapshot, retry, logs: [], error: true })
    })
    return () => { active = false }
  }, [enabled, id, token, snapshot, retry])
  // A refreshed index invalidates details even for memo-only edits (unchanged IDs/dates).
  const current = state?.id === id && state.token === token && state.snapshot === snapshot && state.retry === retry ? state : null
  return {
    logs: enabled ? current?.logs ?? [] : snapshot.filter((log) => log.returnVisitId === id),
    loading: enabled && id !== null && !current,
    error: enabled && !!current?.error,
    reload: () => setRetry((value) => value + 1),
  }
}
