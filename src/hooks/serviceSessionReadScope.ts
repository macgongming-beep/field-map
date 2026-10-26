import type { Role } from '../types'
import { toLocalDateString } from '../utils/dateUtils'

export function recentSessionsEnabled(flag = import.meta.env.VITE_RECENT_SESSIONS_ENABLED, demo = import.meta.env.VITE_DEMO_MODE): boolean {
  return (flag ?? demo) === 'true'
}

export function recentSessionScope(
  role: Role,
  userName: string | undefined,
  flag = import.meta.env.VITE_RECENT_SESSIONS_ENABLED,
  demo = import.meta.env.VITE_DEMO_MODE,
  now = new Date(),
): { userName: string; since: string } | null {
  // Only developer statistics consume all users' complete session history.
  if (!recentSessionsEnabled(flag, demo) || !userName
    || !(['user', 'leader', 'admin'] as Role[]).includes(role)) return null
  const cutoff = new Date(now)
  // Map visibility uses a rolling 7-day timestamp. Keep an extra calendar day
  // for local/UTC date parsing and DST; do not change that visibility contract.
  cutoff.setDate(cutoff.getDate() - 8)
  return { userName, since: toLocalDateString(cutoff) }
}
