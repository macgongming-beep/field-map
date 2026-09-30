import { createContext } from 'react'

export const TerritoryRealtimeContext = createContext<((buildingIds: number[]) => Promise<void>) | null>(null)
