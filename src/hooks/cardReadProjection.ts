import type { Role } from '../types'

export function cardReadProjection(role: Role, withLeaders = true,
  demo = import.meta.env.VITE_DEMO_MODE,
  enabled = import.meta.env.VITE_CARD_COMPACT_READ_ENABLED): string {
  // Only administrator assignment history consumes leader timestamps.
  const compact = (enabled ?? demo) === 'true' && (role === 'user' || role === 'leader')
  const base = compact ? 'id,name,area,region,type,status,leader_name' : '*'
  const leaders = compact ? 'card_leader_assignments(user_name)' : 'card_leader_assignments(user_name, created_at)'
  return `${base}, card_assignments(user_name)${withLeaders ? `, ${leaders}` : ''}`
}
