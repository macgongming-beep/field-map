import { createContext } from 'react'
import type { Role } from '../types'
import { toBuilding, type RawBuilding, type RawUnit } from './storeTransforms'

export type BuildingDemand = 'home' | 'calendar' | 'zone' | 'map' | 'full'
export const buildingDemandRank = { home: 0, calendar: 1, zone: 2, map: 3, full: 4 } as const

export function calendarZoneBuildingDemandEnabled() {
  return (import.meta.env.VITE_CALENDAR_ZONE_BUILDING_DEMAND_ENABLED ?? import.meta.env.VITE_DEMO_MODE) === 'true'
}

export const needsBuildingSummaries = (mode: BuildingDemand) => buildingDemandRank[mode] < buildingDemandRank.zone

export function buildingDemandEnabled(role: Role) {
  return (role === 'admin' || role === 'leader')
    && (import.meta.env.VITE_BUILDING_DEMAND_ENABLED ?? import.meta.env.VITE_DEMO_MODE) === 'true'
}

export function buildingDemandForRoute(role: Role, pathname: string, search: string, desktop: boolean): BuildingDemand | undefined {
  if (!buildingDemandEnabled(role)) return undefined
  // Home detail/legacy deep links can open assignment editors. Unknown consumers stay full.
  if ((pathname === '/' || pathname === '/home') && !search) return 'home'
  if (calendarZoneBuildingDemandEnabled()) {
    if (pathname === '/calendar') return 'calendar'
    // Unknown/deep-link query modes remain full. Restaurant editors need complete data.
    const params = new URLSearchParams(search)
    if (!desktop && pathname === '/zone'
      && [...params.keys()].every(key => ['level', 'region', 'dong', 'scope', 'tab'].includes(key))
      && [null, 'territory', 'informal'].includes(params.get('tab'))) return 'zone'
  }
  if (!desktop && pathname === '/map') return 'map'
  return 'full'
}

export const MAP_BUILDING_COLUMNS = 'id, card_id, name, address, type, lat, lng, warning, access_status, is_restaurant, units_surveyed, building_access_events(id, action, visitor_name, visited_at, time_slot, created_at), units(id, building_id, number, status, is_chinese, is_restaurant, usage_type, regular_visits(visitor_name, registered_at))'
export const CALENDAR_BUILDING_COLUMNS = 'id, card_id, name, address, units(id, building_id, number)'
export const ZONE_BUILDING_COLUMNS = 'id, card_id, name, address, type, warning, access_status, is_restaurant, units_surveyed, units(id, building_id, number, status, is_chinese, is_restaurant, usage_type, regular_visits(visitor_name, registered_at))'

export type RawCalendarBuilding = Pick<RawBuilding, 'id' | 'card_id' | 'name' | 'address'> & {
  units: Pick<RawUnit, 'id' | 'building_id' | 'number'>[]
}
// Name-only records never feed filters, maps or editors. Promotion gates those consumers.
export function toCalendarBuilding(raw: RawCalendarBuilding) {
  return toBuilding({ ...raw, type: '주택', lat: 0, lng: 0, warning: false, memo: null,
    units: raw.units.map(unit => ({ ...unit, status: '미방문', is_chinese: false, memo: null, regular_visits: [] })),
  })
}
export type RawZoneBuilding = Omit<RawMapBuilding, 'lat' | 'lng' | 'building_access_events'>
export function toZoneBuilding(raw: RawZoneBuilding) {
  return toMapBuilding({ ...raw, lat: 0, lng: 0, building_access_events: [] })
}

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

export type FullBuildingReader = {
  ready: boolean; error: boolean; request: () => void; retry: () => Promise<void>
}
export const FullBuildingContext = createContext<FullBuildingReader | null>(null)
