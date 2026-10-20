import { describe, expect, it } from 'vitest'
import { readSnapshotParts, SupersededReadError } from './supersededRead'

describe('readSnapshotParts', () => {
  it('returns successful parts in order', async () => {
    await expect(readSnapshotParts([Promise.resolve(1), Promise.resolve(2)])).resolves.toEqual([1, 2])
  })

  it('retains typed cancellation when all other parts succeed', async () => {
    const cancelled = new SupersededReadError('Calendar read superseded')
    await expect(readSnapshotParts([Promise.reject(cancelled), Promise.resolve(1)])).rejects.toBe(cancelled)
  })

  it('does not mistake a message suffix for cancellation', async () => {
    const error = new Error('Network request superseded')
    await expect(readSnapshotParts([Promise.reject(error)])).rejects.toBe(error)
  })

  it('does not hide a later genuine failure behind cancellation', async () => {
    let reject!: (reason: unknown) => void
    const pending = new Promise<number>((_, fail) => { reject = fail })
    const realError = new Error('Connection lost')
    const result = readSnapshotParts([
      Promise.reject(new SupersededReadError('Calendar read superseded')),
      pending,
    ])
    const assertion = expect(result).rejects.toBe(realError)
    await Promise.resolve()
    reject(realError)
    await assertion
  })

  it('does not delay a genuine failure for an unrelated pending read', async () => {
    const error = new Error('Connection lost')
    await expect(readSnapshotParts([
      new Promise<number>(() => {}),
      Promise.reject(error),
    ])).rejects.toBe(error)
  })
})
