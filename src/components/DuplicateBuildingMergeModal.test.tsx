import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DuplicateBuildingMergeModal } from './DuplicateBuildingMergeModal'

describe('DuplicateBuildingMergeModal', () => {
  it('병합 보류 주소에서 실제로 겹치는 건물과 호수를 함께 보여준다', () => {
    render(
      <DuplicateBuildingMergeModal
        groups={[]}
        mergePlan={{
          conflicts: [{
            primary: {
              id: 1,
              cardId: 74,
              name: '약수빌라 B동',
              address: '경기도 용인시 처인구 김량장동 중부대로1408번길 16',
              units: [{ number: '101' }, { number: '201' }],
            },
            absorbed: [{
              id: 2,
              name: '중부대로1408번길 16',
              units: [{ number: 'B01' }, { number: '201' }],
            }],
            conflictingNumbers: ['201'],
          }],
        }}
        cardName={() => '처인구 김량장동 003'}
        onClose={vi.fn()}
        onMerge={vi.fn()}
      />,
    )

    expect(screen.getByText('병합 보류 1곳')).toBeTruthy()
    fireEvent.click(screen.getByText('겹침 201'))
    expect(screen.getByText('약수빌라 B동')).toBeTruthy()
    expect(screen.getAllByText('중부대로1408번길 16', { exact: true })).toHaveLength(2)
    expect(screen.getByText('101, 201')).toBeTruthy()
    expect(screen.getByText('B01, 201')).toBeTruthy()
  })

  it('같은 호수에서 남길 현재 정보와 보존할 기록 수를 보여준다', () => {
    render(
      <DuplicateBuildingMergeModal
        groups={[{
          primaryId: 1,
          address: '중부대로1408번길 16',
          cardName: '처인구 김량장동 003',
          buildingCount: 2,
          unitCount: 2,
          names: ['옛 건물', '최근 건물'],
          duplicateUnits: [{
            normalizedNumber: '201',
            displayNumber: '201호',
            keptBuildingName: '최근 건물',
            latestVisitedAt: '2026-09-19',
            latestResult: '부재',
            visitCount: 2,
            isChinese: false,
            isRestaurant: true,
            usageType: '상가',
          }],
        }]}
        mergePlan={{ conflicts: [] }}
        cardName={() => '처인구 김량장동 003'}
        onClose={vi.fn()}
        onMerge={vi.fn()}
      />,
    )

    expect(screen.getByText('최근 건물의 현재 정보 유지')).toBeTruthy()
    expect(screen.getByText('기록 2건 보존')).toBeTruthy()
    expect(screen.getByText('최근 2026-09-19 · 부재')).toBeTruthy()
  })
})
