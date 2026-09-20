import type { Building } from '../types'
import type { ClassifiedRestaurantPlace } from './restaurantPlaceCandidate'
import { shortAddress } from './shortAddress'

const RESIDENTIAL_PLACE_CATEGORY = /(아파트|주택|빌라|연립|다가구|다세대|오피스텔|타운하우스|기숙사|원룸|고시원|하숙)/

/** 순수 주소 결과는 용도를 알 수 없으므로 사용자가 고르게 한다. */
export function candidateBuildingType(candidate: ClassifiedRestaurantPlace): Building['type'] | null {
  if (candidate.source === 'address') return null
  return RESIDENTIAL_PLACE_CATEGORY.test(candidate.category) ? '주택' : '상가'
}

export function candidateBuildingName(candidate: ClassifiedRestaurantPlace, type: Building['type']): string {
  const addressName = shortAddress(candidate.address)
  if (type === '주택' && candidate.source === 'place') return candidate.name || addressName
  return addressName
}

export function candidateFirstUnitName(candidate: ClassifiedRestaurantPlace, type: Building['type']): string {
  return type === '상가' && candidate.source === 'place' ? candidate.name : ''
}
