import { matchesName } from './koreanSearch'
import type { InformalAsset } from '../types'

/** 자식 포인트를 제외하고 비공식 구역 카드만 센다. */
export function countInformalCards(assets: InformalAsset[]): number {
  return assets.filter((asset) => !asset.parentId).length
}

/** 선택한 비공식 카드와 그 카드에 직접 속한 장소만 지도에 올린다. */
export function informalAssetsForMap(
  assets: InformalAsset[],
  focusedId: number | null | undefined,
): InformalAsset[] {
  if (focusedId == null) return []
  const focused = assets.find((asset) => asset.id === focusedId)
  if (!focused) return []
  const parentId = focused.parentId ?? focused.id
  return assets.filter((asset) => asset.id === parentId || asset.parentId === parentId)
}

/**
 * 배정 화면에 올릴 비공식 대상.
 *
 * ⚠ 자식 포인트(거점·대화장소)는 **배정 단위가 아니다.** 구역카드 하나를 팀에
 *   주면 그 안의 점들이 따라간다. 걸러 내지 않으면 점들이 groupId 가 없어
 *   '미분류' 에 쌓이고, 그걸 배정하면 '구역 보기' 가 점 하나만 열어 부모의
 *   네모칸·중심거리가 안 보인다.
 *
 * ⚠ 세는 곳(countInformalCards)과 **같은 판정을 쓴다.** 한쪽만 고치면
 *   탭 숫자와 목록이 어긋난다 — 지도 핀에서 이미 그렇게 데었다.
 */
export function assignableInformalAssets(assets: InformalAsset[], query = ''): InformalAsset[] {
  const q = query.trim()
  return assets.filter((asset) =>
    !asset.parentId
    && !asset.archived
    && (!q || matchesName(asset.name, q) || asset.name.includes(q)),
  )
}
