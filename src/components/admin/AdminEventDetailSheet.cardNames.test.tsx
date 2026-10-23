import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { AdminEventDetailSheet } from './AdminEventDetailSheet'
import { ScopedCardContext } from '../../hooks/useCardDirectory'
import type { CalendarEvent, TerritoryCard } from '../../types'
const read = vi.hoisted(() => vi.fn())
vi.mock('../../lib/cardDirectory', () => ({ readCardDirectory: read }))
vi.mock('../CommentSection', () => ({ CommentSection: () => null }))
vi.mock('../calendar/CartApplicantSection', () => ({ CartApplicantSection: () => null }))
afterEach(() => { cleanup(); read.mockReset() })
test('opened shared event shows the other team name without a full card object', async () => {
  read.mockResolvedValue([{ id: 2, name: 'Other team territory' }])
  const event = { id: 10, date: '2026-10-23', time: '10:00', title: 'Service', leader: '', leaders: [], applicants: [], guests: [],
    assignmentStatus: 'shared', cardAssignments: [
      { userName: 'Me', assignedCardId: 1, teamKey: 'one' },
      { userName: 'Other', assignedCardId: 2, teamKey: 'two' },
    ] } as unknown as CalendarEvent
  render(<ScopedCardContext.Provider value><AdminEventDetailSheet event={event}
    cards={[{ id: 1, name: 'My territory' }] as TerritoryCard[]} role="user" currentVisitor="Me" onClose={() => {}} />
  </ScopedCardContext.Provider>)
  expect(await screen.findByText('Other team territory')).toBeTruthy()
  expect(screen.getByText('My territory')).toBeTruthy()
  expect(read).toHaveBeenCalledExactlyOnceWith([2])
})
