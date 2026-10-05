import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createRecipientCardPrefetch } from './recipientCardPrefetch'

type Row = Record<string, unknown>
function fixture() {
  const rows: Record<string, Row[]> = {
    buildings: [{ id: 11, card_id: 1 }, { id: 12, card_id: 2 }, { id: 99, card_id: 99 }],
    card_boundaries: [{ card_id: 1, points: [] }, { card_id: 2, points: [] }, { card_id: 99, points: [] }],
    units: [{ id: 101, building_id: 11 }, { id: 102, building_id: 12 }, { id: 999, building_id: 99 }],
    visit_histories: [
      { id: 201, unit_id: 101, units: { building_id: 11 }, invalidated_at: null, created_at: new Date().toISOString() },
      { id: 202, unit_id: 102, units: { building_id: 12 }, invalidated_at: null, created_at: new Date().toISOString() },
      { id: 203, unit_id: 101, units: { building_id: 11 }, invalidated_at: new Date().toISOString(), created_at: new Date().toISOString() },
      { id: 204, unit_id: 101, units: { building_id: 11 }, invalidated_at: null, created_at: '2000-01-01T00:00:00Z' },
      { id: 999, unit_id: 999, units: { building_id: 99 }, invalidated_at: null, created_at: new Date().toISOString() },
    ],
  }
  const calls: { table: string; filters: [string, unknown][]; from: number; to: number }[] = []
  const response = vi.fn(async (data: Row[]) => ({ data, error: null as unknown }))
  const from = vi.fn((table: string) => {
    let selected = rows[table] ?? []
    const filters: [string, unknown][] = []
    const builder = {
      select: vi.fn(() => builder),
      in: vi.fn((key: string, values: number[]) => {
        filters.push([key, values])
        selected = selected.filter((row) => {
          let value: unknown = row
          for (const part of key.split('.')) value = value && typeof value === 'object' ? (value as Row)[part] : undefined
          return typeof value === 'number' && values.includes(value)
        })
        return builder
      }),
      is: vi.fn((key: string, value: unknown) => { filters.push([key, value]); selected = selected.filter((row) => row[key] === value); return builder }),
      gte: vi.fn((key: string, value: string) => { filters.push([key, value]); selected = selected.filter((row) => typeof row[key] === 'string' && row[key] >= value); return builder }),
      order: vi.fn(() => builder),
      range: vi.fn((start: number, end: number) => { calls.push({ table, filters, from: start, to: end }); return response(selected.slice(start, end + 1)) }),
    }
    return builder
  })
  const rpc = vi.fn(async (name: string, params?: { p_card_ids: number[] }) => ({
    data: name === 'territory_sync_clock' ? new Date().toISOString() : params?.p_card_ids.map((id) => ({ id })),
    error: null as unknown,
  }))
  const client = { from, rpc } as unknown as Pick<SupabaseClient, 'from' | 'rpc'>
  const session = { token: 'test-session', isCurrent: vi.fn(() => true) }
  return { rows, calls, from, rpc, response, session, client, reader: createRecipientCardPrefetch(client, session) }
}

describe('recipient card prefetch', () => {
  it('starts detail prefetch after summaries, with every request restricted to the assigned cards', async () => {
    const f = fixture()
    const load = f.reader.prefetch([2, 1, 1])
    expect(await load.summaries).toEqual([{ id: 1 }, { id: 2 }])
    const detail = await load.details
    expect(detail.buildings.map((b) => b.id)).toEqual([11, 12])
    expect(detail.buildings[0].units?.map((u) => u.id)).toEqual([101])
    expect(detail.histories.map((h) => h.id)).toEqual([201, 202])
    expect(detail.boundaries.map((b) => b.card_id)).toEqual([1, 2])
    expect(detail.baseline).toBeTruthy()
    expect(f.calls.filter((c) => ['buildings', 'card_boundaries'].includes(c.table)).every((c) => c.filters.some(([key, value]) => key === 'card_id' && JSON.stringify(value) === '[1,2]'))).toBe(true)
    expect(f.calls.find((c) => c.table === 'visit_histories')?.filters).toContainEqual(['units.building_id', [11, 12]])
  })

  it('shares an in-flight prefetch with both the whole-map and single-card entry', async () => {
    const f = fixture()
    const full = f.reader.prefetch([1, 2])
    const same = f.reader.prefetch([2, 1])
    const single = f.reader.prefetch([2])
    await Promise.all([full.details, same.details])
    const detail = await single.details
    expect(detail.buildings.map((b) => b.id)).toEqual([12])
    expect(detail.histories.map((h) => h.id)).toEqual([202])
    expect(detail.boundaries.map((b) => b.card_id)).toEqual([2])
    expect(f.rpc.mock.calls.filter(([name]) => name === 'get_card_summaries')).toHaveLength(1)
    expect(f.calls).toHaveLength(4)
    await f.reader.prefetch([1]).details
    expect(f.calls).toHaveLength(4)
  })

  it('does not issue queries for no assignment, including after another prefetch', async () => {
    const f = fixture()
    expect(await f.reader.prefetch([]).details).toEqual({ buildings: [], histories: [], boundaries: [], baseline: null })
    expect(f.from).not.toHaveBeenCalled()
    expect(f.rpc).not.toHaveBeenCalled()
    await f.reader.prefetch([1]).details
    const calls = f.calls.length
    expect((await f.reader.prefetch([]).details).buildings).toEqual([])
    expect(f.calls).toHaveLength(calls)
  })

  it('distinguishes a real empty card from an unavailable card', async () => {
    const f = fixture()
    const empty = f.reader.prefetch([3])
    expect(await empty.summaries).toEqual([{ id: 3 }])
    expect((await empty.details).buildings).toEqual([])
    expect(f.calls.map((c) => c.table)).toEqual(['buildings', 'card_boundaries'])
    f.rpc.mockResolvedValueOnce({ data: [], error: null })
    await expect(f.reader.prefetch([4]).details).rejects.toThrow('unavailable')
  })

  it('never falls back to a global read on failure and allows a scoped retry', async () => {
    const f = fixture()
    f.response.mockResolvedValueOnce({ data: [], error: new Error('Network unavailable') })
    await expect(f.reader.prefetch([1]).details).rejects.toThrow('Network unavailable')
    expect((await f.reader.prefetch([1]).details).buildings.map((b) => b.id)).toEqual([11])
    expect(f.calls.every((c) => c.filters.some(([key]) => ['card_id', 'building_id', 'units.building_id'].includes(key)))).toBe(true)
  })

  it('drops late responses when assignment scope changes', async () => {
    const f = fixture()
    const load = f.reader.prefetch([1])
    f.reader.invalidate()
    await expect(load.details).rejects.toThrow('scope changed')
    expect(f.from).not.toHaveBeenCalled()
    expect((await f.reader.prefetch([2]).details).buildings.map((b) => b.id)).toEqual([12])
  })

  it('rejects a changed account even when details have already been cached', async () => {
    const f = fixture()
    await f.reader.prefetch([1]).details
    const load = f.reader.prefetch([1])
    f.session.isCurrent.mockReturnValue(false)
    await expect(load.details).rejects.toThrow('session or scope changed')
    expect(() => f.reader.prefetch([1])).toThrow('session or scope changed')
  })

  it('keeps data available if the clock fails without inventing a recovery watermark', async () => {
    const f = fixture()
    const original = f.rpc.getMockImplementation()!
    f.rpc.mockImplementation((name, params) => name === 'territory_sync_clock'
      ? Promise.reject(new Error('RPC temporarily missing')) : original(name, params))
    const detail = await f.reader.prefetch([1]).details
    expect(detail.buildings.map((b) => b.id)).toEqual([11])
    expect(detail.baseline).toBeNull()
  })

  it('reads more than 1000 units without nested-response truncation', async () => {
    const f = fixture()
    f.rows.units = Array.from({ length: 1005 }, (_, i) => ({ id: i + 1, building_id: 11 }))
    expect((await f.reader.prefetch([1]).details).buildings[0].units).toHaveLength(1005)
    expect(f.calls.filter((c) => c.table === 'units').map((c) => c.from)).toEqual([0, 1000])
  })

  it('rejects invalid IDs and out-of-scope responses at the reader boundary', async () => {
    const f = fixture()
    expect(() => f.reader.prefetch([0])).toThrow('Invalid card ID')
    f.response.mockResolvedValueOnce({ data: [{ id: 99, card_id: 99 }], error: null })
    await expect(f.reader.prefetch([1]).details).rejects.toThrow('Out-of-scope')
  })
})
