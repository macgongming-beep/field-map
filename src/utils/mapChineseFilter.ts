import type { Building } from '../types'
import { unitsForUsage } from './unitUsage'

export function mapChineseFilterEnabled(): boolean {
  return (import.meta.env.VITE_MAP_CHINESE_FILTER_ENABLED ?? import.meta.env.VITE_DEMO_MODE) === 'true'
}

/** Display-only projection. Never pass these shortened unit arrays to bulk writes. */
export function chineseMapBuildings(buildings: Building[], onlyChinese: boolean): Building[] {
  if (!onlyChinese) return buildings
  return buildings.flatMap(building => {
    const units = unitsForUsage(building, '전체').filter(unit => unit.isChinese === true)
    return units.length ? [{ ...building, units }] : []
  })
}
