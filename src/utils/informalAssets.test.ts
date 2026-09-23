import { describe, expect, test } from 'vitest'
import type { InformalAsset } from '../types'
import { assignableInformalAssets, countInformalCards, informalAssetsForMap } from './informalAssets'

const asset = (
  id: number,
  parentId: number | null = null,
  extra: Partial<InformalAsset> = {},
): InformalAsset => ({
  id,
  parentId,
  name: `place-${id}`,
  kind: '비공식구역',
  imageUrl: '',
  imagePath: '',
  uploadedBy: 'tester',
  createdAt: '2026-09-04T00:00:00Z',
  archived: false,
  groupId: null,
  ...extra,
})

describe('비공식 구역 카드 수', () => {
  test('상위 카드만 세고 그 안의 포인트는 제외한다', () => {
    expect(countInformalCards([
      asset(1),
      asset(2),
      asset(3, 1),
      asset(4, 1),
      asset(5, 2),
    ])).toBe(2)
  })
})

describe('비공식 지도 표시 범위', () => {
  const assets = [asset(1), asset(2), asset(3, 1), asset(4, 1), asset(5, 2)]

  test('선택한 카드와 그 카드의 하위 장소만 남긴다', () => {
    expect(informalAssetsForMap(assets, 1).map((row) => row.id)).toEqual([1, 3, 4])
  })

  test('하위 장소로 진입해도 그 장소가 속한 카드 묶음만 남긴다', () => {
    expect(informalAssetsForMap(assets, 5).map((row) => row.id)).toEqual([2, 5])
  })

  test('선택이 없거나 자료에 없는 장소면 아무것도 표시하지 않는다', () => {
    expect(informalAssetsForMap(assets, null)).toEqual([])
    expect(informalAssetsForMap(assets, 999)).toEqual([])
  })
})

describe('배정에 올릴 비공식 대상', () => {
  test('자식 포인트는 배정 단위가 아니라 빠진다', () => {
    const rows = assignableInformalAssets([asset(1), asset(2), asset(3, 1)])
    expect(rows.map((row) => row.id)).toEqual([1, 2])
  })

  test('보관한 구역카드도 빠진다', () => {
    const rows = assignableInformalAssets([asset(1), asset(2, null, { archived: true })])
    expect(rows.map((row) => row.id)).toEqual([1])
  })

  test('검색어는 최상위 카드에만 걸린다 — 이름이 맞는 자식도 올라오지 않는다', () => {
    const rows = assignableInformalAssets([
      asset(1, null, { name: '경희대(홈플러스)' }),
      asset(2, null, { name: '강남대' }),
      asset(3, 1, { name: '경희대 정문' }),
    ], '경희대')
    expect(rows.map((row) => row.id)).toEqual([1])
  })

  test('검색어가 비면 모든 최상위 카드가 남는다', () => {
    expect(assignableInformalAssets([asset(1), asset(2)], '   ')).toHaveLength(2)
  })
})
