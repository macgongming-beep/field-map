import { createContext } from 'react'
import type { Role } from '../types'
import { toBuilding, type RawBuilding, type RawUnit } from './storeTransforms'

export type BuildingDemand = 'home' | 'map' | 'full'
export const buildingDemandRank = { home: 0, map: 1, full: 2 } as const

export function buildingDemandEnabled(role: Role) {
  return (role === 'admin' || role === 'leader')
    && (import.meta.env.VITE_BUILDING_DEMAND_ENABLED ?? import.meta.env.VITE_DEMO_MODE) === 'true'
}

export function buildingDemandForRoute(role: Role, pathname: string, search: string, desktop: boolean): BuildingDemand | undefined {
  if (!buildingDemandEnabled(role)) return undefined
  // Home detail/legacy deep links can open assignment editors. Unknown consumers stay full.
  if ((pathname === '/' || pathname === '/home') && !search) return 'home'
  if (!desktop && pathname === '/map') return 'map'
  return 'full'
}

export const MAP_BUILDING_COLUMNS = 'id, card_id, name, address, type, lat, lng, warning, access_status, is_restaurant, units_surveyed, building_access_events(id, action, visitor_name, visited_at, time_slot, created_at), units(id, building_id, number, status, is_chinese, is_restaurant, usage_type, regular_visits(visitor_name, registered_at))'

// Pin/list consumers need unit status and regular-visit identity, but not memo bodies.
// Completeness is tracked separately; no editor may consume these placeholders.
export type RawMapBuilding = Omit<RawBuilding, 'memo' | 'units' | 'building_access_events'> & {
  units: Omit<RawUnit, 'memo'>[]
  building_access_events?: Omit<NonNullable<RawBuilding['building_access_events']>[number], 'memo'>[]
}
export function toMapBuilding(raw: RawMapBuilding) {
  return toBuilding({ ...raw, memo: null,
    building_access_events: raw.building_access_events?.map(event => ({ ...event, memo: null })),
    units: raw.units.map(unit => ({ ...unit, memo: null })),
  })
}

export type BuildingDetailReader = {
  ready: (id: number) => boolean
  ensure: (id: number) => Promise<void>
}
export const BuildingDetailContext = createContext<BuildingDetailReader | null>(null)
