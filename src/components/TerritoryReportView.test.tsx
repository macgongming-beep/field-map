import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ChineseTerritoryReportSnapshot } from '../types/territoryReport'
import { TerritoryReportView } from './TerritoryReportView'

vi.mock('./TerritoryReportMap', () => ({
  TerritoryReportMap: () => <div>보고서 지도</div>,
}))

const snapshot = (showRegularVisits?: boolean): ChineseTerritoryReportSnapshot => ({
  schemaVersion: 4,
  congregationName: '테스트 회중',
  generatedAt: '2026-09-22T00:00:00.000Z',
  periodStart: '2026-03-22',
  periodEnd: '2026-09-22',
  note: '',
  showRegularVisits,
  summary: {
    total: 10,
    residential: 7,
    business: 3,
    regularVisits: 2,
    totalCards: 4,
    targetCards: 3,
    assignedCards: 2,
    unassignedCards: 2,
    consistencyWarnings: 0,
  },
  management: { within30Days: 1, days31To90: 2, days91To180: 3, over180Days: 0, noHistory: 4 },
  statuses: [],
  monthlyVisits: [],
  cardRegions: [],
  regions: [],
  areas: [],
})

describe('TerritoryReportView regular visit visibility', () => {
  it('기존 스냅샷은 정기방문 숫자를 계속 표시한다', () => {
    render(<TerritoryReportView snapshot={snapshot()} />)
    expect(screen.getByText('정기 방문')).toBeTruthy()
    expect(screen.getByText('2')).toBeTruthy()
  })

  it('표시 옵션을 끈 스냅샷은 정기방문 칸을 만들지 않는다', () => {
    const { container } = render(<TerritoryReportView snapshot={snapshot(false)} />)
    expect(screen.queryByText('정기 방문')).toBeNull()
    expect(container.querySelector('.territory-report-kpis')?.classList.contains('is-three')).toBe(true)
  })
})
