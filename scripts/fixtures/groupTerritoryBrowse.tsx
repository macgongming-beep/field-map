import React from 'react'
import { createRoot } from 'react-dom/client'
import '../../src/index.css'
import '../../src/App.css'
import { GroupTerritoryAssignment } from '../../src/features/groupTerritory/GroupTerritoryAssignment'
import { GroupTerritoryContext } from '../../src/features/groupTerritory/context'
import type { TerritoryCard } from '../../src/types'
const cards = Array.from({ length: 609 }, (_, i) => ({ id: i + 1, name: `${['기흥구', '처인구', '수지구'][i % 3]} ${i % 2 ? '둘동' : '첫동'} ${i + 1}`, region: ['기흥구', '처인구', '수지구'][i % 3], area: i % 2 ? '둘동' : '첫동', type: '주택', assignedGroupCodes: i % 3 === 0 ? ['dongtan', 'singal'] : ['singal'], groupAssignmentRevision: '1', buildings: 0, units: 0, completed: 0, progress: 0, assignedLeader: null, assignedUsers: [], regularVisits: 0, regularVisitPoints: [], status: '미배정' })) as TerritoryCard[]
const boundaries = cards.map((c, i) => { const lat = 37.21 + Math.floor(i / 29) * .002, lng = 127.10 + (i % 29) * .002; return { cardId: c.id, points: [{ lat, lng }, { lat, lng: lng + .0015 }, { lat: lat + .0015, lng: lng + .0015 }, { lat: lat + .0015, lng }] } })
createRoot(document.getElementById('root')!).render(<div style={{ padding: 16 }}><GroupTerritoryContext.Provider value={{ enabled: true, ownCode: 'dongtan', canManage: true, groups: [{ code: 'dongtan', name: '东滩', active: true }, { code: 'singal', name: '新葛', active: true }], save: async () => { throw new Error('Fixture writes disabled') } }}>
  <GroupTerritoryAssignment cards={cards} cardBoundaries={boundaries} compact={innerWidth < 980} />
</GroupTerritoryContext.Provider></div>)
