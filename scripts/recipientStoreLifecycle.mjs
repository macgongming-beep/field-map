import { resolve } from 'node:path'
import { deepStrictEqual } from 'node:assert'
import { rolldown } from 'rolldown'
import { JSDOM } from 'jsdom'
import { IDBFactory } from 'fake-indexeddb'
import { webcrypto } from 'node:crypto'

// Execute the real React store with a demo-only measured client. No UI/browser automation.
export async function measureStoreLifecycle({ client, user, samples, setPhase, boundaryCache = false, project }) {
  if (user.role !== 'user') throw new Error('An actual volunteer account is required')
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' })
  const previous = new Map()
  for (const key of ['window', 'document', 'navigator', 'localStorage', 'sessionStorage', 'HTMLElement', 'Event', 'CustomEvent']) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
    Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] })
  }
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  if (boundaryCache) {
    for (const [key, value] of [['indexedDB', new IDBFactory()], ['crypto', webcrypto]]) {
      previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
      Object.defineProperty(globalThis, key, { configurable: true, value })
    }
  }
  globalThis.__storeMeasurementClient = client
  localStorage.setItem('auth_token', user.token)
  localStorage.setItem('currentVisitor', user.name)
  const { renderHook, act, waitFor, cleanup } = await import('@testing-library/react')
  const build = await rolldown({ input: resolve('src/hooks/useStore.ts'),
    transform: { define: { 'import.meta.env': JSON.stringify({ DEV: false, VITE_TERRITORY_REALTIME_ENABLED: 'true', VITE_DEMO_MODE: boundaryCache ? 'true' : 'false', VITE_SUPABASE_URL: project }) } },
    plugins: [{ name: 'measured-demo-store', resolveId(id) {
      if (id.endsWith('/supabase')) return '\0measured-client'
      if (!id.startsWith('.') && !id.startsWith('/') && !id.startsWith('\0')) {
        return { id: import.meta.resolve(id), external: true }
      }
    }, load(id) {
      if (id === '\0measured-client') return 'export const supabase = globalThis.__storeMeasurementClient'
    } }],
  })
  try {
    const { output } = await build.generate({ format: 'esm', codeSplitting: false })
    const { useStore } = await import(`data:text/javascript;base64,${Buffer.from(output[0].code).toString('base64')}`)
    const slices = ['buildings', 'cards', 'cardBoundaries', 'visits', 'calendar', 'resources', 'communication', 'returnVisits', 'specialPeriods', 'restaurantRequests', 'system']
    const globalKeys = ['visitHistories', 'serviceSessions', 'calendarEvents', 'notices', 'returnVisits', 'returnVisitLogs', 'informalAssets', 'eventRestaurantAssignments', 'restaurantRequests']
    const results = []
    let fullSnapshot
    for (const mode of boundaryCache ? ['full', 'cached-full'] : ['full', 'recipient']) {
      setPhase(`${mode}:initial`)
      let hook
      try {
        hook = renderHook(() => useStore(true, 'user', mode === 'recipient' ? user.name : undefined))
        await waitFor(() => {
          if (hook.result.current.loading) throw new Error('Loading')
          if (hook.result.current.error) throw new Error(hook.result.current.error)
          // Initial effect performs this lookup after all slices are complete.
          if (!samples.some((s) => s.phase === `${mode}:initial` && s.initialLookup)) throw new Error('Initial lookup pending')
        }, { timeout: 45000 })
        const snapshot = structuredClone(Object.fromEntries(['buildings', 'cardBoundaries', ...globalKeys].map((key) => [key, hook.result.current[key]])))
        if (mode === 'full') fullSnapshot = snapshot
        else {
          for (const key of globalKeys) deepStrictEqual(snapshot[key], fullSnapshot[key], `${key} parity`)
          for (const building of snapshot.buildings) deepStrictEqual(building, fullSnapshot.buildings.find((b) => b.id === building.id), 'building parity')
          for (const boundary of snapshot.cardBoundaries) deepStrictEqual(boundary, fullSnapshot.cardBoundaries.find((b) => b.cardId === boundary.cardId), 'boundary parity')
        }
        for (const scenario of ['initial', 'foreground', 'targeted-refresh']) {
          const phase = `${mode}:${scenario}`
          setPhase(phase)
          if (scenario === 'foreground') await act(async () => { await hook.result.current.refetchSlices(slices, { triggeredBy: 'foreground' }) })
          if (scenario === 'targeted-refresh') {
            // Same building in both modes. This is the read after saving, not a write.
            const id = fullSnapshot.buildings[0]?.id
            if (id == null || !snapshot.buildings.some((b) => b.id === id)) throw new Error('Shared target building unavailable')
            await act(async () => { await hook.result.current.syncChangedBuildings([id]) })
          }
          const requests = samples.filter((s) => s.phase === phase)
          if (requests.some((s) => s.status >= 400)) throw new Error(`Request failure in ${phase}`)
          results.push({ phase, requests: requests.length,
            compressedBodyBytes: requests.reduce((sum, s) => sum + s.compressedBodyBytes, 0),
            byEndpoint: Object.fromEntries([...new Set(requests.map((s) => s.endpoint))].map((endpoint) => {
              const rows = requests.filter((s) => s.endpoint === endpoint)
              return [endpoint, { requests: rows.length, compressedBodyBytes: rows.reduce((sum, s) => sum + s.compressedBodyBytes, 0) }]
            })) })
        }
      } finally { hook?.unmount(); cleanup() }
    }
    console.log(JSON.stringify({ project: 'demo', accountRole: user.role, measuredAt: new Date().toISOString(), results,
      parity: 'Global slices and loaded building/boundary contents match',
      limitations: ['Real useStore network reads under React test harness, not whole app or browser Transferred.',
        ...(boundaryCache ? ['IndexedDB is emulated; cached-full is a new full-store instance using the same session and saved coordinates.'] : []),
        'Header notifications, chat, map tiles, realtime subscriptions and static assets excluded.',
        'Compressed HTTPS response body only. No monthly production extrapolation.',
        'Session auto-close suppressed; no visit writes. Foreground invokes the real recovery dispatcher, not mobile backgrounding.'] }, null, 2))
  } finally {
    cleanup(); await build.close(); dom.window.close()
    delete globalThis.__storeMeasurementClient
    delete globalThis.IS_REACT_ACT_ENVIRONMENT
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  }
}
