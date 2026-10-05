import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ from: vi.fn(), token: vi.fn(() => 'demo-session') }))
vi.mock('./supabase', () => ({ supabase: { from: mocks.from } }))
vi.mock('./authToken', () => ({ getAuthToken: mocks.token }))
import { createRecipientPreview, recipientPreviewEnabled } from './recipientPreview'

beforeEach(() => { vi.clearAllMocks(); mocks.token.mockReturnValue('demo-session') })

describe('recipient preview isolation', () => {
  it('requires both the explicit demo flag and the separate preview route', () => {
    expect(recipientPreviewEnabled('/recipient-preview', 'true')).toBe(true)
    expect(recipientPreviewEnabled('/territory', 'true')).toBe(false)
    expect(recipientPreviewEnabled('/recipient-preview', 'false')).toBe(false)
    expect(recipientPreviewEnabled('/recipient-preview', undefined)).toBe(false)
  })

  it('reads multi-card links by event and recipient, not a nonexistent assignment_id', async () => {
    const rows: Record<string, Record<string, unknown>[]> = {
      event_card_assignments: [
        { id: 5, event_id: 10, user_name: 'Volunteer', assigned_card_id: 1, team_key: 'team-1' },
        { id: 6, event_id: 20, user_name: 'Someone else', assigned_card_id: 99 },
      ],
      event_card_assignment_cards: [
        { id: 1, event_id: 10, user_name: 'Volunteer', card_id: 1 },
        { id: 2, event_id: 10, user_name: 'Volunteer', card_id: 2 },
        { id: 3, event_id: 10, user_name: 'Someone else', card_id: 99 },
        { id: 4, event_id: 20, user_name: 'Volunteer', card_id: 98 },
      ],
      calendar_events: [{ id: 10, event_date: '2026-10-05', time: '10:00', assignment_team_scopes: { 'team-1': '상가' } }],
    }
    const filters: string[] = []
    mocks.from.mockImplementation((table: string) => {
      let selected = rows[table]
      const query = {
        select: () => query,
        order: () => query,
        eq: (key: string, value: unknown) => { filters.push(`${table}.${key}`); selected = selected.filter((row) => row[key] === value); return query },
        in: (key: string, values: number[]) => { filters.push(`${table}.${key}`); selected = selected.filter((row) => values.includes(Number(row[key]))); return query },
        range: async (from: number, to: number) => ({ data: selected.slice(from, to + 1), error: null }),
      }
      return query
    })
    const api = createRecipientPreview('Volunteer')
    const result = await api.assignments()
    expect(result).toHaveLength(1)
    expect(result[0].cardAssignments[0].assignedCardIds).toEqual([1, 2])
    expect(result[0].cardAssignments[0].cardScope).toBe('상가')
    expect(filters).toContain('event_card_assignment_cards.event_id')
    expect(filters).toContain('event_card_assignment_cards.user_name')
    api.dispose()
    await expect(api.assignments()).rejects.toThrow('session changed')
  })

  it('never expands no assignment or a read failure into a global query', async () => {
    const range = vi.fn().mockResolvedValue({ data: [], error: null })
    const query = { select: () => query, eq: () => query, order: () => query, range }
    mocks.from.mockReturnValue(query)
    const api = createRecipientPreview('Volunteer')
    expect(await api.assignments()).toEqual([])
    expect(mocks.from).toHaveBeenCalledTimes(1)
    range.mockResolvedValueOnce({ data: null, error: new Error('Network unavailable') })
    await expect(api.assignments()).rejects.toThrow('Network unavailable')
    expect(mocks.from).toHaveBeenCalledTimes(2)
  })

  it('does not reuse another account session', () => {
    mocks.token.mockReturnValueOnce('')
    expect(() => createRecipientPreview('Volunteer')).toThrow('로그인이 필요합니다.')
  })
})
