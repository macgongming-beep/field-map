import type { Building, CardBoundary } from '../types'
import type { PlaceCandidate } from '../lib/placeSearch'
import { normalizeCardSearch } from './cardSearch'
import { findCardForCoordinates, isValidMapCoordinate } from './mapUtils'
import { shortAddress } from './shortAddress'

export type RestaurantPlaceStatus = 'registered' | 'existing-building' | 'ambiguous-building' | 'new'
export type RestaurantPlaceScope = 'card' | 'unassigned' | 'outside'

export type ClassifiedRestaurantPlace = PlaceCandidate & {
  buildingId: number | null
  buildingIds: number[]
  status: RestaurantPlaceStatus
  scope: RestaurantPlaceScope
}

function distanceMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const rad = Math.PI / 180
  const dLat = (bLat - aLat) * rad
  const dLng = (bLng - aLng) * rad
  const value = Math.sin(dLat / 2) ** 2
    + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLng / 2) ** 2
  return 6371000 * 2 * Math.asin(Math.min(1, Math.sqrt(value)))
}

export function findExistingBuildingsByAddress(address: string, buildings: Building[]): Building[] {
  const key = normalizeCardSearch(shortAddress(address))
  if (!key) return []
  return buildings.filter((building) => normalizeCardSearch(shortAddress(building.address)) === key)
}

function findExistingBuildings(place: PlaceCandidate, buildings: Building[]): Building[] {
  return findExistingBuildingsByAddress(place.address, buildings).filter((building) => {
    if (!isValidMapCoordinate(building.lat, building.lng)) return true
    return distanceMeters(building.lat, building.lng, place.lat, place.lng) <= 200
  })
}

function getScope(place: PlaceCandidate, buildings: Building[], boundaries: CardBoundary[]): RestaurantPlaceScope {
  if (findCardForCoordinates(place.lat, place.lng, boundaries) != null) return 'card'
  const located = buildings.filter((building) => isValidMapCoordinate(building.lat, building.lng))
  if (located.length === 0) return 'unassigned'
  const padding = 0.05
  const lats = located.map((building) => building.lat)
  const lngs = located.map((building) => building.lng)
  const nearby = place.lat >= Math.min(...lats) - padding && place.lat <= Math.max(...lats) + padding
    && place.lng >= Math.min(...lngs) - padding && place.lng <= Math.max(...lngs) + padding
  return nearby ? 'unassigned' : 'outside'
}

export function classifyRestaurantPlaces(
  places: PlaceCandidate[],
  buildings: Building[],
  boundaries: CardBoundary[],
): ClassifiedRestaurantPlace[] {
  return places.map((place) => {
    const matches = findExistingBuildings(place, buildings)
    const name = normalizeCardSearch(place.name)
    const registeredBuilding = matches.find((building) => (
      building.units.some((unit) => unit.isRestaurant && normalizeCardSearch(unit.number) === name)
    ))
    const status: RestaurantPlaceStatus = registeredBuilding
      ? 'registered'
      : matches.length === 1
        ? 'existing-building'
        : matches.length > 1
          ? 'ambiguous-building'
          : 'new'
    return {
      ...place,
      buildingId: registeredBuilding?.id ?? (matches.length === 1 ? matches[0].id : null),
      buildingIds: matches.map((building) => building.id),
      status,
      scope: getScope(place, buildings, boundaries),
    }
  }).sort((a, b) => {
    const scopeRank = { card: 0, unassigned: 1, outside: 2 }
    const statusRank = { registered: 0, 'existing-building': 1, 'ambiguous-building': 2, new: 3 }
    return scopeRank[a.scope] - scopeRank[b.scope] || statusRank[a.status] - statusRank[b.status]
  })
}
