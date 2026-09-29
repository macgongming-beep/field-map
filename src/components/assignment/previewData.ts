import type { Building, TerritoryCard, CardBoundary } from '../../types'
import type { UnitUsageFilter } from '../../utils/unitUsage'
import { scopeBuildingToUsage } from '../../utils/unitUsage'

export type PreviewTeam = {
  id: string
  name: string
  members: string[]
  scope: UnitUsageFilter
  cardIds: number[]
  informalIds: number[]
}
export const initialTeams: PreviewTeam[] = [
  {
    id: 'preview-home',
    name: '팀 1',
    members: ['예시 김민수', '예시 이서연'],
    scope: '주택',
    cardIds: [1, 3, 4],
    informalIds: [1],
  },
  {
    id: 'preview-shop',
    name: '팀 2',
    members: ['예시 박지훈', '예시 최수진'],
    scope: '상가',
    cardIds: [2, 3, 5],
    informalIds: [2],
  },
  {
    id: 'preview-informal',
    name: '팀 3',
    members: ['예시 정유진'],
    scope: '전체',
    cardIds: [],
    informalIds: [3],
  },
  {
    id: 'preview-personal',
    name: '팀 4',
    members: ['예시 한지우'],
    scope: '전체',
    cardIds: [],
    informalIds: [],
  },
]
export const previewCards: TerritoryCard[] = Array.from(
  { length: 6 },
  (_, index) => {
    const id = index + 1
    return {
      id,
      name: `배분테스트 ${['주택', '상가', '혼합'][index % 3]} ${id}`,
      region: index < 3 ? '테스트구' : '연습구',
      area: '연습동',
      type: '전체',
      buildings: 1,
      units: 4,
      completed: 0,
      regularVisits: 0,
      regularVisitPoints: [],
      progress: 0,
      assignedLeader: null,
      assignedUsers: [],
      status: '미배정',
    }
  },
)
export const previewBuildings: Building[] = previewCards.map((card, index) => ({
  id: card.id,
  cardId: card.id,
  name: card.name,
  address: `가상 주소 · 연습로 ${card.id * 10}`,
  type: index % 3 === 1 ? '상가' : '주택',
  lat: 37.5 + Math.floor(index / 3) * 0.003,
  lng: 127.1 + (index % 3) * 0.003,
  units: Array.from({ length: 4 }, (_, j) => {
    const shop = index % 3 === 1 || (index % 3 === 2 && j < 2)
    return {
      id: card.id * 10 + j,
      number: shop ? `연습 점포 ${j + 1}` : `${201 + j}`,
      status: '미방문',
      usageType: shop ? '상가' : '주택',
      isRestaurant: shop && j === 0,
    }
  }),
}))
export const previewBoundaries: CardBoundary[] = previewBuildings.map((b) => ({
  cardId: b.cardId,
  points: [
    { lat: b.lat - 0.001, lng: b.lng - 0.001 },
    { lat: b.lat - 0.001, lng: b.lng + 0.001 },
    { lat: b.lat + 0.001, lng: b.lng + 0.001 },
    { lat: b.lat + 0.001, lng: b.lng - 0.001 },
  ],
}))
export const previewInformal = [1, 2, 3].map((id) => ({
  id,
  name: `연습 비공식 ${id}`,
  lat: 37.505 + id * 0.001,
  lng: 127.102,
}))
export const previewRestaurants = previewBuildings.flatMap((b) =>
  b.units
    .filter((u) => u.isRestaurant)
    .map((u) => ({
      id: u.id,
      buildingId: b.id,
      name: `연습 식당 ${b.id}`,
      address: b.address,
    })),
)
export function scopedPreviewBuildings(
  cardIds: number[],
  scope: UnitUsageFilter,
): Building[] {
  return previewBuildings
    .filter((b) => cardIds.includes(b.cardId))
    .map((b) => scopeBuildingToUsage(b, scope))
    .filter((b) => b.units.length > 0)
}
