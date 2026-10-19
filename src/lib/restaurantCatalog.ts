import { supabase } from './supabase'
import { getAuthToken } from './authToken'
import { RECIPIENT_BUILDING_COLUMNS, RECIPIENT_UNIT_COLUMNS } from './recipientCardPrefetch'
import { toBuilding, type RawBuilding } from '../hooks/storeTransforms'

export type RestaurantCatalogItem = {
  building_id: number; unit_id: number | null; card_id: number
  name: string; address: string; region: string; area: string
}
export type RestaurantCatalogQuery = { search: string; region: string | null; area: string | null; all: boolean }
export function createRestaurantCatalog() {
  const token = getAuthToken()
  const check = () => { if (!token || token !== getAuthToken()) throw new Error('Restaurant session changed') }
  return {
    async page(query: RestaurantCatalogQuery, after?: RestaurantCatalogItem) {
      check()
      if (!query.search.trim() && query.region === null && !query.all) return { items: [], more: false }
      const { data, error } = await supabase.rpc('browse_restaurants', {
        p_token: token, p_search: query.search.trim().slice(0, 200), p_region: query.region,
        p_area: query.area, p_all: query.all,
        p_after_building: after?.building_id ?? 0, p_after_unit: after?.unit_id ?? 0,
      })
      check()
      if (error) throw error
      if (!Array.isArray(data) || data.length > 21) throw new Error('Invalid restaurant catalog')
      let previous = [after?.building_id ?? 0, after?.unit_id ?? 0]
      for (const row of data) {
        if (!Number.isSafeInteger(row.building_id) || row.building_id <= 0 || !Number.isSafeInteger(row.card_id)
          || (row.unit_id !== null && (!Number.isSafeInteger(row.unit_id) || row.unit_id <= 0))
          || !['name', 'address', 'region', 'area'].every(key => typeof row[key] === 'string')
          || (query.region !== null && row.region !== query.region) || (query.area !== null && row.area !== query.area)
          || row.building_id < previous[0] || (row.building_id === previous[0] && (row.unit_id ?? 0) <= previous[1])) {
          throw new Error('Invalid restaurant catalog row')
        }
        previous = [row.building_id, row.unit_id ?? 0]
      }
      return { items: data.slice(0, 20) as RestaurantCatalogItem[], more: data.length > 20 }
    },
    async detail(item: RestaurantCatalogItem) {
      check()
      const { data, error } = await supabase.from('buildings').select(RECIPIENT_BUILDING_COLUMNS).eq('id', item.building_id).single()
      check()
      if (error) throw error
      if (!data || data.id !== item.building_id || data.card_id !== item.card_id) throw new Error('Restaurant unavailable')
      const units: RawBuilding['units'] = []
      for (let start = 0; ; start += 1000) {
        const response = await supabase.from('units').select(RECIPIENT_UNIT_COLUMNS).eq('building_id', item.building_id).order('id').range(start, start + 999)
        check()
        if (response.error) throw response.error
        if (!Array.isArray(response.data) || response.data.some(row => row.building_id !== item.building_id)) throw new Error('Invalid restaurant units')
        units.push(...response.data as RawBuilding['units'])
        if (response.data.length < 1000) break
      }
      const building = toBuilding({ ...data, units } as RawBuilding)
      const unit = item.unit_id === null ? null : building.units.find(row => row.id === item.unit_id)
      if ((item.unit_id !== null && !unit?.isRestaurant) || (item.unit_id === null && (!building.isRestaurant || building.units.some(row => row.isRestaurant)))) throw new Error('Restaurant changed')
      return { building, unit: unit ?? null, key: `${building.id}-${item.unit_id ?? 'none'}` }
    },
  }
}
