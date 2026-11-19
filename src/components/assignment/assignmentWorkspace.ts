import type { MapViewportMemory } from '../MapCanvas'
import type { DraftTeam } from '../../hooks/assignmentDraft'

export type AssignmentWorkspace = ReturnType<typeof createAssignmentWorkspace>

// One editor session only: never persist these viewing preferences in the assignment payload.
export function createAssignmentWorkspace() {
  return {
    viewport: { current: null } as MapViewportMemory,
    view: 'map' as 'map' | 'list',
    mainTab: '카드' as '카드' | '비공식' | '식당',
    query: '',
    unassignedOnly: false,
    preferredScope: '전체' as NonNullable<DraftTeam['cardScope']>,
    legacyTypeFilter: '전체' as NonNullable<DraftTeam['cardScope']>,
    selectedRegions: new Set<string>(),
    chineseOnly: false,
  }
}
