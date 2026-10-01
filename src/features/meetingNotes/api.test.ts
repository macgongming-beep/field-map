// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
const calls = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }))
vi.mock('../../lib/supabase', () => ({ supabase: calls }))
import { fetchMeetingNoteMetas, MeetingConflict, NOTE_META_COLUMNS, saveMeetingNote } from './api'
beforeEach(() => { vi.clearAllMocks(); localStorage.clear() })
describe('meeting requests', () => {
  it('does not load notes when no active collections exist', async () => {
    expect(await fetchMeetingNoteMetas([])).toEqual([])
    expect(calls.from).not.toHaveBeenCalled()
  })
  it('excludes bodies from the actual metadata query', async () => {
    const query = { select: vi.fn(), in: vi.fn(), is: vi.fn(), order: vi.fn(), then: (resolve: (value: unknown) => void) => resolve({ data: [], error: null }) }
    for (const fn of [query.select, query.in, query.is, query.order]) fn.mockReturnValue(query)
    calls.from.mockReturnValue(query)
    await fetchMeetingNoteMetas([1])
    expect(query.select).toHaveBeenCalledWith(NOTE_META_COLUMNS)
    expect(query.select.mock.calls[0][0]).not.toMatch(/body|\*/)
    expect(query.in).toHaveBeenCalledWith('collection_id', [1])
  })
  it('rejects conflict without reporting a successful save and sends the expected version', async () => {
    localStorage.setItem('auth_token', 'test-token')
    calls.rpc.mockResolvedValue({ data: { ok: false, conflict: true }, error: null })
    await expect(saveMeetingNote(2, 3, { titleKo: '제목', titleZh: '', bodyKo: '본문', bodyZh: '' })).rejects.toBeInstanceOf(MeetingConflict)
    expect(calls.rpc).toHaveBeenCalledWith('save_service_meeting_note', expect.objectContaining({ p_token: 'test-token', p_event_id: 2, p_collection_id: 3, p_expected_updated_at: null }))
  })
})
