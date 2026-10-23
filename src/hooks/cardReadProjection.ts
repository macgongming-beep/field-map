import type { Role } from '../types'

export function cardReadProjection(role: Role, recipient: boolean, withLeaders = true,
  demo = import.meta.env.VITE_DEMO_MODE): string {
  const compact = demo === 'true' && role === 'user' && recipient
  const base = compact ? 'id,name,area,region,type,status,leader_name' : '*'
  const leaders = compact ? 'card_leader_assignments(user_name)' : 'card_leader_assignments(user_name, created_at)'
  return `${base}, card_assignments(user_name)${withLeaders ? `, ${leaders}` : ''}`
}
