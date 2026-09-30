import { createContext } from 'react'

export function createTerritoryCheckpoint() {
  return {
    baseline: null as string | null,
    cards: new Map<number, string>(),
    applied: new Map<string, string>(),
    snapshot: null as Promise<void> | null,
  }
}

export type TerritoryRealtime = {
  sync: (buildingIds: number[]) => Promise<void>
  checkpoint: ReturnType<typeof createTerritoryCheckpoint>
}
export const TerritoryRealtimeContext = createContext<TerritoryRealtime | null>(null)
