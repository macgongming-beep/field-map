import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SharedTerritoryReport } from './SharedTerritoryReport'

const getSharedReport = vi.fn()

vi.mock('../lib/territoryReport', () => ({
  getSharedChineseTerritoryReport: (...args: unknown[]) => getSharedReport(...args),
}))

vi.mock('./TerritoryReportView', () => ({
  TerritoryReportView: () => <article>공유 보고서 본문</article>,
}))

describe('SharedTerritoryReport', () => {
  beforeEach(() => {
    getSharedReport.mockResolvedValue({
      ok: true,
      snapshot: { summary: {} },
      expiresAt: '2026-09-30T00:00:00.000Z',
    })
  })

  it('외부 링크에는 앱 내부 이동 링크나 메뉴를 만들지 않는다', async () => {
    render(
      <MemoryRouter initialEntries={['/shared/territory-report/public-token']}>
        <Routes>
          <Route path="/shared/territory-report/:shareToken" element={<SharedTerritoryReport />} />
        </Routes>
      </MemoryRouter>,
    )

    await screen.findByText('공유 보고서 본문')
    await waitFor(() => expect(getSharedReport).toHaveBeenCalledWith('public-token'))
    expect(screen.queryAllByRole('link')).toHaveLength(0)
    expect(screen.queryByRole('navigation')).toBeNull()
    expect(screen.getAllByRole('button').map(button => button.textContent)).toEqual(['PDF 인쇄'])
  })
})
