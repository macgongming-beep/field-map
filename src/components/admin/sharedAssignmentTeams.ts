// 공유된 배정을 팀으로 다시 묶는다.
//
// 화면에서 떼어낸 이유: 시험하기 위해서다. '고쳤는데 화면이 안 바뀐다' 를
// 만났을 때, 논리가 맞는지 배선이 틀렸는지 가르려면 이 함수만 따로 돌려봐야 한다.
// 실제로 그렇게 해서 원인(호출부가 데이터를 안 넘김)을 찾았다.
import type { Building, CalendarEvent, EventInformalAssignment, EventRestaurantAssignment, InformalAsset, TerritoryCard } from '../../types'

function getAssignmentCardIds(assignment: CalendarEvent['cardAssignments'][number]) {
  const ids = assignment.assignedCardIds?.length
    ? assignment.assignedCardIds
    : assignment.assignedCardId
      ? [assignment.assignedCardId]
      : []
  return Array.from(new Set(ids.filter((id): id is number => typeof id === 'number' && id > 0))).sort((a, b) => a - b)
}

export function buildSharedAssignmentTeams(
  event: CalendarEvent,
  cards: Pick<TerritoryCard, 'id' | 'name'>[],
  informalAssets: InformalAsset[] = [],
  informalAssignments: EventInformalAssignment[] = [],
  buildings: Building[] = [],
  restaurantAssignments: EventRestaurantAssignment[] = [],
) {
  const cardNameById = new Map(cards.map((card) => [card.id, card.name]))
  const assetNameById = new Map(informalAssets.map((a) => [a.id, a.name]))
  const buildingById = new Map(buildings.map((building) => [building.id, building]))
  const grouped = new Map<string, { members: string[]; cardIds: number[] }>()

  event.cardAssignments.forEach((assignment) => {
    const cardIds = getAssignmentCardIds(assignment)
    // teamKey 가 있으면 그걸로 묶는다. 구역 카드가 없어도 팀은 팀이다 —
    // 예전에는 카드 없는 사람을 각자 한 팀으로 쪼갰다 (비공식만 맡은 6명이 6팀이 됐다)
    const key = assignment.teamKey
      ? `team:${assignment.teamKey}`
      : cardIds.length ? cardIds.join(',') : `member:${assignment.userName}`
    const existing = grouped.get(key) ?? { members: [], cardIds }
    existing.members.push(assignment.userName)
    grouped.set(key, existing)
  })

  return Array.from(grouped.values()).map((team, index) => {
    const mine = new Set(team.members)
    const cardNames = team.cardIds.map((id) => cardNameById.get(id)).filter((name): name is string => Boolean(name))
    const informalNames = informalAssignments
      // 저장소에는 모든 일정의 배정이 있으므로 반드시 일정과 팀원을 함께 좁힌다.
      .filter((assignment) => assignment.eventId === event.id && mine.has(assignment.userName))
      .map((assignment) => assetNameById.get(assignment.assetId))
      .filter((name): name is string => Boolean(name))
    const restaurantNames = restaurantAssignments
      .filter((assignment) => assignment.eventId === event.id && mine.has(assignment.userName))
      .map((assignment) => {
        const building = buildingById.get(assignment.buildingId)
        if (!building) return null
        const unit = assignment.unitId == null
          ? null
          : building.units.find((item) => item.id === assignment.unitId)
        return unit?.number || building.name || building.address
      })
      .filter((name): name is string => Boolean(name))
    const workNames = Array.from(new Set([...cardNames, ...informalNames, ...restaurantNames]))
    return {
      id: `${team.cardIds.join('-') || 'none'}-${index}`,
      label: `팀 ${index + 1}`,
      members: team.members,
      cardNames: workNames,
    }
  })
}
