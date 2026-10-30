import { expect, test, vi } from 'vitest'
import { createBuildingRefreshQueue } from './buildingRefreshQueue'
import { SupersededReadError } from './supersededRead'

function deferred() {
  let resolve!: () => void
  let reject!: (error: Error) => void
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

test('coalesces not-yet-started IDs but never joins a read started before the caller', async () => {
  const first = deferred(), second = deferred()
  const read = vi.fn().mockImplementationOnce(async (_ids, canApply) => { await first.promise; return canApply() })
    .mockImplementationOnce(async (_ids, canApply) => { await second.promise; return canApply() })
  const queue = createBuildingRefreshQueue(read)
  const a = queue.read([1, 2])
  await Promise.resolve()
  const b = queue.read([2, 3]), c = queue.read([1, 3])
  let completed = false
  void b.then(() => { completed = true })
  expect(read).toHaveBeenCalledTimes(1)
  first.resolve(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
  expect(read.mock.calls.map(call => call[0])).toEqual([[1, 2], [1, 2, 3]])
  expect(completed).toBe(false)
  second.resolve(); await Promise.all([a, b, c])
  expect(completed).toBe(true)
})

test('partial batches do not resolve any caller before all required buildings succeed', async () => {
  const tail = deferred()
  const read = vi.fn().mockResolvedValueOnce(true).mockImplementationOnce(async () => { await tail.promise; return true })
  const queue = createBuildingRefreshQueue(read)
  const a = queue.read(Array.from({ length: 21 }, (_, i) => i + 1)).catch(error => error)
  const b = queue.read([1]).catch(error => error)
  await Promise.resolve(); await Promise.resolve()
  expect(read.mock.calls.map(call => call[0].length)).toEqual([20, 1])
  tail.reject(new Error('last building offline'))
  expect(await a).toEqual(new Error('last building offline'))
  expect(await b).toEqual(new Error('last building offline'))
})

test('an older failure is reported but later callers still get their own fresh read', async () => {
  const old = deferred()
  const read = vi.fn().mockImplementationOnce(async () => { await old.promise; return true }).mockResolvedValueOnce(true)
  const queue = createBuildingRefreshQueue(read)
  const a = queue.read([1]).catch(error => error)
  await Promise.resolve()
  const b = queue.read([1])
  old.reject(new Error('offline'))
  expect(await a).toEqual(new Error('offline'))
  await b
  expect(read).toHaveBeenCalledTimes(2)
})

test('scope/lifecycle reset rejects queued and running work without starting obsolete batches', async () => {
  const old = deferred()
  const read = vi.fn().mockImplementationOnce(async () => { await old.promise; return true }).mockResolvedValue(true)
  const queue = createBuildingRefreshQueue(read)
  const a = queue.read([1]).catch(error => error)
  await Promise.resolve()
  const b = queue.read([2]).catch(error => error)
  queue.reset()
  expect(await b).toBeInstanceOf(SupersededReadError)
  old.resolve()
  expect(await a).toBeInstanceOf(SupersededReadError)
  expect(read).toHaveBeenCalledTimes(1)
  await queue.read([3])
  expect(read.mock.calls.at(-1)?.[0]).toEqual([3])
})

test('rejects invalid IDs without sending a request', async () => {
  const read = vi.fn()
  const queue = createBuildingRefreshQueue(read)
  await expect(queue.read([0])).rejects.toThrow('Invalid building')
  expect(read).not.toHaveBeenCalled()
})

test('overlap preserves non-overlapping IDs of the older batch and delays every acknowledgement', async () => {
  const old = deferred(), fresh = deferred()
  const read = vi.fn().mockImplementationOnce(async (_ids, canApply) => { await old.promise; return canApply() })
    .mockImplementationOnce(async (_ids, canApply) => { await fresh.promise; return canApply() })
  const queue = createBuildingRefreshQueue(read)
  let oldCompleted = false
  const a = queue.read([1, 2]).then(() => { oldCompleted = true })
  await Promise.resolve()
  const b = queue.read([2])
  old.resolve(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
  expect(read.mock.calls.map(call => call[0])).toEqual([[1, 2], [1, 2]])
  expect(oldCompleted).toBe(false)
  fresh.resolve(); await Promise.all([a, b])
  expect(oldCompleted).toBe(true)
})
