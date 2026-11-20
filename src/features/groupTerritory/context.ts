import { createContext, useContext } from 'react'
import type { ServiceGroup } from '../groupService/directory'
import type { TerritoryCard } from '../../types'

export type GroupTerritoryContextValue = {
  enabled: boolean
  ownCode: string | null
  groups: ServiceGroup[]
  canManage: boolean
  save: (code: string, cards: TerritoryCard[], action: 'add' | 'remove') => Promise<void>
}
export const GroupTerritoryContext = createContext<GroupTerritoryContextValue>({
  enabled: false, ownCode: null, groups: [], canManage: false,
  save: async () => { throw new Error('Group territory unavailable') },
})
export const useGroupTerritory = () => useContext(GroupTerritoryContext)
