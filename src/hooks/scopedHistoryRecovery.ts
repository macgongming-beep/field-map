import type { Building } from '../types'

export const HISTORY_RECHECK_MS = 30 * 60_000

export function scopedHistoryRecoveryEnabled(scoped: boolean) {
  return scoped && import.meta.env.VITE_DEMO_MODE === 'true'
    && (import.meta.env.VITE_SCOPED_HISTORY_RECOVERY_ENABLED ?? 'true') === 'true'
}

export function historyScope(buildings: Building[]) {
  return JSON.stringify(buildings.map(b => [b.id, b.cardId, b.units.map(u => u.id).sort((a, b) => a - b)])
    .sort((a, b) => Number(a[0]) - Number(b[0])))
}

/** Completeness is session-local; deltas never renew the full-read safety deadline. */
export function createHistoryCoverage() {
  let epoch = 0
  let complete: { scope: string; startedAt: number } | null = null
  return {
    invalidate() { ++epoch; complete = null },
    begin(scope: string) { return { epoch, scope, startedAt: Date.now() } },
    commit(read: { epoch: number; scope: string; startedAt: number }, scope: string) {
      if (read.epoch === epoch && read.scope === scope && Date.now() >= read.startedAt) {
        complete = { scope, startedAt: read.startedAt }
      }
    },
    applyDelta(before: string, after: string) {
      if (complete?.scope === before) complete.scope = after
      else complete = null
    },
    canReuse(scope: string) {
      const age = complete ? Date.now() - complete.startedAt : -1
      return complete?.scope === scope && age >= 0 && age < HISTORY_RECHECK_MS
    },
  }
}
