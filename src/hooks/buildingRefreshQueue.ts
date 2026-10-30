import { SupersededReadError } from './supersededRead'

type Request = { ids: number[]; resolve: () => void; reject: (error: unknown) => void }

/** Never publish a pre-write response after an overlapping caller requests fresh data. */
export function createBuildingRefreshQueue(read: (ids: number[], canApply: () => boolean) => Promise<boolean>) {
  let pending: Request[] = []
  let running = false
  let scheduled = false
  let generation = 0
  const schedule = () => {
    if (running || scheduled || !pending.length) return
    scheduled = true
    queueMicrotask(() => { scheduled = false; void drain() })
  }
  const drain = async () => {
    if (running || !pending.length) return
    running = true
    const requests = pending
    pending = []
    const epoch = generation
    const ids = [...new Set(requests.flatMap(request => request.ids))]
    const canApply = () => epoch === generation && !pending.some(request => request.ids.some(id => ids.includes(id)))
    try {
      for (let start = 0; start < ids.length; start += 20) {
        if (epoch !== generation) throw new SupersededReadError('Building queue reset')
        const applied = await read(ids.slice(start, start + 20), canApply)
        if (epoch !== generation) throw new SupersededReadError('Building queue reset')
        if (!applied || !canApply()) {
          // Carry the WHOLE older batch, not just overlapping IDs, into a read
          // started after every waiting caller. Nobody acknowledges it early.
          pending = [...requests, ...pending]
          return
        }
      }
      if (epoch !== generation) throw new SupersededReadError('Building queue reset')
      requests.forEach(request => request.resolve())
    } catch (error) {
      requests.forEach(request => request.reject(error))
    } finally {
      running = false
      schedule()
    }
  }
  return {
    read(ids: number[]): Promise<void> {
      if (ids.some(id => !Number.isSafeInteger(id) || id <= 0)) return Promise.reject(new Error('Invalid building IDs'))
      return new Promise((resolve, reject) => { pending.push({ ids: [...ids], resolve, reject }); schedule() })
    },
    reset() {
      ++generation
      const queued = pending
      pending = []
      queued.forEach(request => request.reject(new SupersededReadError('Building queue reset')))
    },
  }
}
