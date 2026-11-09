import { expect, test, vi } from 'vitest'
import { createVisitSignalQueue, visitSignalDedupEnabled } from './visitSignalQueue'

const row = (revision = 1, building_id = 10, card_id = 1) => ({ revision, building_id, card_id, changed_at: `2026-11-09T10:00:0${revision}Z` })
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r }); return { promise, resolve } }
const tick = async () => { for (let i = 0; i < 10; i++) await Promise.resolve() }

test.each([undefined, 'false', 'true'])('dedup is explicit opt-in and requires the guarded queue: %s', flag => {
  expect(visitSignalDedupEnabled(false, flag)).toBe(false)
  expect(visitSignalDedupEnabled(true, flag)).toBe(flag === 'true')
})

test('own signal waits for applied post-write data, then skips the exact covered revision', async () => {
  const gate = deferred(), order: string[] = []
  const proof = vi.fn(async () => { order.push('proof'); return [row()] })
  const data = vi.fn(async () => { order.push('data'); await gate.promise; return true })
  const q = createVisitSignalQueue(data, proof)
  const save = q.read([10]); await tick()
  let done = false
  const signal = q.signals([row()]).then(() => { done = true })
  await tick(); expect(done).toBe(false)
  gate.resolve(); await Promise.all([save, signal])
  expect(order).toEqual(['proof', 'data'])
  expect(data).toHaveBeenCalledTimes(1)
  await q.signals([row()]); expect(data).toHaveBeenCalledTimes(1)
})

test('another user revision during a slow save is not covered by the older proof', async () => {
  const gate = deferred()
  let server = row()
  const proof = vi.fn(async () => [server])
  const data = vi.fn().mockImplementationOnce(async () => { await gate.promise; return true }).mockResolvedValue(true)
  const q = createVisitSignalQueue(data, proof)
  const save = q.read([10]); await tick()
  server = row(2)
  const other = q.signals([server]); await tick()
  gate.resolve(); await Promise.all([save, other])
  expect(data).toHaveBeenCalledTimes(2)
  expect(proof).toHaveBeenCalledTimes(1)
  await q.signals([server]); expect(data).toHaveBeenCalledTimes(2)
})

test('cancel is a forced fresh read; pre-cancel data is never published or acknowledged', async () => {
  const gate = deferred(), published: number[] = []
  let server = row()
  const proof = vi.fn(async () => [server])
  const data = vi.fn(async (_ids: number[], canApply: () => boolean) => {
    const captured = server.revision
    if (captured === 1) await gate.promise
    if (!canApply()) return false
    published.push(captured); return true
  })
  const q = createVisitSignalQueue(data, proof)
  const save = q.read([10]); await tick()
  server = row(2)
  const cancel = q.read([10]), signal = q.signals([server])
  gate.resolve(); await Promise.all([save, cancel, signal])
  expect(published).toEqual([2])
  expect(data).toHaveBeenCalledTimes(2)
})

test('signal-only observers do not pay a proof GET and mixed batches read uncovered IDs', async () => {
  const data = vi.fn<Parameters<typeof createVisitSignalQueue>[0]>().mockResolvedValue(true), proof = vi.fn(async () => [row()])
  const q = createVisitSignalQueue(data, proof)
  await q.signals([row()]); await q.signals([row(), row(1, 11)])
  expect(data.mock.calls.map(call => call[0])).toEqual([[10], [11]])
  expect(proof).not.toHaveBeenCalled()
  await q.signals([row(1, 10, 2)])
  expect(data).toHaveBeenCalledTimes(3)
})

test.each(['proof', 'data'])('failed %s cannot acknowledge a signal', async failure => {
  const data = vi.fn<Parameters<typeof createVisitSignalQueue>[0]>().mockResolvedValue(true)
  const proof = vi.fn(async () => [row()])
  if (failure === 'proof') proof.mockRejectedValueOnce(new Error('offline'))
  else data.mockRejectedValueOnce(new Error('offline'))
  const q = createVisitSignalQueue(data, proof)
  await expect(q.read([10])).rejects.toThrow('offline')
  await q.signals([row()])
  expect(data).toHaveBeenCalledTimes(failure === 'proof' ? 1 : 2)
})

test('reset discards waiting signals and receipts; a late old read cannot repopulate them', async () => {
  const gate = deferred()
  const data = vi.fn<Parameters<typeof createVisitSignalQueue>[0]>().mockImplementationOnce(async () => { await gate.promise; return true }).mockResolvedValue(true)
  const q = createVisitSignalQueue(data, async () => [row()])
  const save = q.read([10]).catch(error => error)
  await tick()
  const waiting = q.signals([row()]).catch(error => error)
  q.reset(); gate.resolve()
  expect(await save).toMatchObject({ name: 'SupersededReadError' })
  expect(await waiting).toMatchObject({ name: 'SupersededReadError' })
  await q.signals([row()]); expect(data).toHaveBeenCalledTimes(2)
})
