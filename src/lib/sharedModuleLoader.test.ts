import { expect, test, vi } from 'vitest'
import { createSharedModuleLoader } from './sharedModuleLoader'

test('preload, lazy render and subsequent sessions share the same successful module', async () => {
  let finish!: (value: { default: string }) => void
  const importer = vi.fn(() => new Promise<{ default: string }>(resolve => { finish = resolve }))
  const load = createSharedModuleLoader(importer)
  const preload = load()
  expect(load()).toBe(preload)
  expect(importer).toHaveBeenCalledTimes(1)
  finish({ default: 'home' })
  await expect(preload).resolves.toEqual({ default: 'home' })
  expect(load()).toBe(preload)
  expect(importer).toHaveBeenCalledTimes(1)
})

test('a rejected preload can be retried by the normal lazy render', async () => {
  const error = new Error('offline')
  const importer = vi.fn<() => Promise<{ default: string }>>()
    .mockRejectedValueOnce(error).mockResolvedValueOnce({ default: 'home' })
  const load = createSharedModuleLoader(importer)
  const failed = load()
  expect(load()).toBe(failed)
  await expect(failed).rejects.toBe(error)
  const retry = load()
  expect(retry).not.toBe(failed)
  await expect(retry).resolves.toEqual({ default: 'home' })
  expect(load()).toBe(retry)
  expect(importer).toHaveBeenCalledTimes(2)
})
