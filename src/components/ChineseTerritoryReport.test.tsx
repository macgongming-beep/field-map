import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ChineseTerritoryReport } from './ChineseTerritoryReport'

const previewReport = vi.fn()
const listShares = vi.fn()

vi.mock('../lib/territoryReport', () => ({
  previewChineseTerritoryReport: (...args: unknown[]) => previewReport(...args),
  listChineseTerritoryReportShares: (...args: unknown[]) => listShares(...args),
  createChineseTerritoryReportShare: vi.fn(),
  revokeChineseTerritoryReportShare: vi.fn(),
}))

vi.mock('./TerritoryReportView', () => ({
  TerritoryReportView: () => <article>보고서 미리보기</article>,
}))

describe('ChineseTerritoryReport display options', () => {
  beforeEach(() => {
    previewReport.mockReset()
    listShares.mockReset()
    previewReport.mockResolvedValue({ summary: {} })
    listShares.mockResolvedValue([])
  })

  it('정기방문 숫자 표시를 끄면 미리보기를 숨김 옵션으로 다시 만든다', async () => {
    render(<MemoryRouter><ChineseTerritoryReport /></MemoryRouter>)

    const toggle = await screen.findByRole('checkbox', { name: '정기방문 숫자 표시' })
    await waitFor(() => expect(previewReport).toHaveBeenCalled())
    expect(previewReport.mock.calls.at(-1)?.[4]).toBe(true)

    fireEvent.click(toggle)

    await waitFor(() => expect(previewReport.mock.calls.at(-1)?.[4]).toBe(false))
  })
})
