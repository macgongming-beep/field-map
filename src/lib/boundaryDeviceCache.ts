export type BoundaryCacheRow = { card_id: number; points: unknown; updated_at?: string | null }
const DATABASE = 'field-map-boundary-cache-v1'
const STORE = 'snapshots'
const EPOCH = 'boundary-cache-epoch'
const MAX_AGE = 7 * 24 * 60 * 60 * 1000

function epoch() { return localStorage.getItem(EPOCH) ?? '' }

function freshSnapshot(value: unknown, now: number): value is { savedAt: number; rows: unknown } {
  return value != null && typeof value === 'object' && 'savedAt' in value && 'rows' in value
    && typeof value.savedAt === 'number' && Number.isFinite(value.savedAt)
    && value.savedAt <= now && now - value.savedAt <= MAX_AGE
}

async function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1)
    let expired = false
    const timeout = setTimeout(() => { expired = true; reject(new Error('Boundary cache timeout')) }, 1500)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE)
    request.onerror = () => { clearTimeout(timeout); reject(request.error) }
    request.onsuccess = () => { clearTimeout(timeout); if (expired) request.result.close(); else resolve(request.result) }
  })
}

function validRows(value: unknown): value is BoundaryCacheRow[] {
  if (!Array.isArray(value)) return false
  const seen = new Set<number>()
  return value.every((row) => {
    if (!row || !Number.isSafeInteger(row.card_id) || row.card_id <= 0 || seen.has(row.card_id)
      || !(row.updated_at == null || typeof row.updated_at === 'string') || !Array.isArray(row.points)) return false
    seen.add(row.card_id)
    return row.points.every((p: unknown) => p != null && typeof p === 'object'
      && 'lat' in p && 'lng' in p && typeof p.lat === 'number' && typeof p.lng === 'number'
      && Number.isFinite(p.lat) && Math.abs(p.lat) <= 90 && Number.isFinite(p.lng) && Math.abs(p.lng) <= 180)
  })
}

/** Optional storage only. A server manifest must authorize every coordinate before display. */
export async function createBoundaryDeviceCache(project: string, token: string, isCurrent: () => boolean) {
  try {
    const startEpoch = epoch()
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${project}\n${token}`))
    const key = Array.from(new Uint8Array(digest), (n) => n.toString(16).padStart(2, '0')).join('')
    const current = () => isCurrent() && epoch() === startEpoch
    return {
      async read(): Promise<BoundaryCacheRow[] | null> {
        let db: IDBDatabase | undefined
        try {
          db = await database()
          if (!current()) return null
          const value = await new Promise<unknown>((resolve, reject) => {
            const tx = db!.transaction(STORE, 'readwrite')
            const request = tx.objectStore(STORE).openCursor()
            const now = Date.now()
            let snapshot: unknown
            // Old session keys are never read again; prune them on cache access too.
            request.onsuccess = () => {
              const cursor = request.result
              if (!cursor) return
              if (!freshSnapshot(cursor.value, now)) cursor.delete()
              else if (cursor.key === key) snapshot = cursor.value
              cursor.continue()
            }
            tx.oncomplete = () => resolve(snapshot)
            tx.onerror = () => reject(tx.error)
            tx.onabort = () => reject(tx.error)
          })
          if (!current() || !freshSnapshot(value, Date.now()) || !validRows(value.rows)) return null
          return value.rows
        } catch { return null } finally { db?.close() }
      },
      async write(rows: BoundaryCacheRow[]) {
        let db: IDBDatabase | undefined
        try {
          if (!validRows(rows)) return
          db = await database()
          if (!current()) return
          await new Promise<void>((resolve, reject) => {
            const tx = db!.transaction(STORE, 'readwrite')
            tx.objectStore(STORE).put({ savedAt: Date.now(), rows }, key)
            tx.oncomplete = () => resolve()
            tx.onerror = () => reject(tx.error)
            tx.onabort = () => reject(tx.error)
          })
        } catch { /* Storage/quota failure must never break the map. */ } finally { db?.close() }
      },
    }
  } catch { return null }
}

export function clearBoundaryDeviceCache() {
  // Invalidate pending writers synchronously, including writers in other tabs.
  try { localStorage.setItem(EPOCH, crypto.randomUUID()) } catch { /* Storage may be disabled. */ }
  return database().then((db) => new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).clear()
    const done = () => { db.close(); resolve() }
    tx.oncomplete = done; tx.onerror = done; tx.onabort = done
  })).catch(() => {})
}
