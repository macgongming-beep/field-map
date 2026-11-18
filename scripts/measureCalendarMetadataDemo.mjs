// Actual demo REST + Realtime with application hooks, not a simulated HTTP fixture.
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { parseEnv } from 'node:util'
import { resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { rolldown } from 'rolldown'
import { JSDOM } from 'jsdom'

assert.ok(process.argv.includes('--confirm-demo') && process.env.DEMO_ENV_FILE)
const origin = 'https://itjlykpjmlcvanqpmkmc.supabase.co'
const config = parseEnv(readFileSync(process.env.DEMO_ENV_FILE, 'utf8'))
assert.equal(config.VITE_SUPABASE_URL, origin)
const production = parseEnv(readFileSync(process.env.FLAGS_FILE, 'utf8'))
const flags = Object.fromEntries(Object.entries(production).filter(([key, value]) => key.startsWith('VITE_') && ['true', 'false'].includes(value)))
const fixture = JSON.parse(readFileSync(process.env.FIXTURE_FILE ?? 'scratch/group-tabs-fixture.json', 'utf8'))
const auth = { persistSession: false, autoRefreshToken: false }
const loginClient = createClient(origin, config.VITE_SUPABASE_ANON_KEY, { auth })
const unwrap = ({ data, error }) => { if (error) throw error; return data }
async function login(id, pin) {
  const rows = unwrap(await loginClient.rpc('auth_login', { p_login_id: id, p_pin: pin }))
  const actor = Array.isArray(rows) ? rows[0] : rows
  assert.ok(actor?.token)
  return actor
}
const admin = await login(config.TEST_LOGIN_ID, config.TEST_LOGIN_PIN)
assert.ok(['admin', 'developer'].includes(admin.role))
const actors = [
  await login(fixture.actors.find(a => a.role === 'user').name, '0000'),
  await login(fixture.actors.find(a => a.role === 'leader').name, '0000'),
  await login('관리자', '0000'),
]
assert.deepEqual(actors.map(a => a.role), ['user', 'leader', 'admin'])
const writer = createClient(origin, config.VITE_SUPABASE_ANON_KEY, { auth,
  global: { headers: { 'x-session-token': admin.token } } })
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' })
const title = `calendar-metadata-measurement-${Date.now()}`
const events = []
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' })
const previous = new Map()
for (const name of ['window', 'document', 'navigator', 'localStorage', 'sessionStorage', 'HTMLElement', 'CustomEvent']) {
  previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name))
  Object.defineProperty(globalThis, name, { configurable: true, value: dom.window[name] })
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const { renderHook, act, waitFor, cleanup } = await import('@testing-library/react')
const sleep = ms => new Promise(done => setTimeout(done, ms))
const results = []
try {
  for (const group of [false, true]) events.push(unwrap(await writer.from('calendar_events').insert({
    event_date: today, time: group ? '03:17' : '03:18', title, type: '주택', place: 'Demo only',
    leader_name: admin.name, card_name: '', has_meeting: false, allow_applications: true,
    service_kind: group ? 'group' : 'congregation', group_service_scope: group,
    target_groups: group ? ['dongtan'] : [],
  }).select('id,group_service_scope').single()))

  for (const actor of actors) for (let pair = 0; pair < (actor.role === 'user' ? 3 : 1); pair++) for (const enabled of [false, true]) {
    localStorage.setItem('auth_token', actor.token)
    localStorage.setItem('currentVisitor', actor.name)
    let phase = 'initial', subscribed = false, completed = 0, pending = 0, lastFinished = performance.now()
    const samples = [], failures = [], signals = [], statuses = []
    const client = createClient(origin, config.VITE_SUPABASE_ANON_KEY, { auth: { ...auth, storageKey: `metadata-${actor.role}-${pair}-${enabled}` },
      global: { headers: { 'x-session-token': actor.token }, fetch: async (input, init) => {
        const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
        assert.equal(url.origin, origin)
        const endpoint = url.pathname.split('/').pop()
        if (endpoint === 'auto_close_stale_sessions') return new Response('null', { status: 200 })
        assert.ok((init?.method ?? 'GET') === 'GET' || ['territory_sync_clock', 'get_card_summaries', 'get_recipient_return_visit_card_ids'].includes(endpoint), `Observer write rejected: ${endpoint}`)
        const sample = { phase, endpoint, query: url.search, start: performance.now() }
        pending++
        try {
          const response = await fetch(input, init)
          sample.bytes = (await response.clone().arrayBuffer()).byteLength
          sample.status = response.status
          sample.end = performance.now()
          samples.push(sample)
          return response
        } finally { pending--; lastFinished = performance.now() }
      } },
    })
    const channel = client.channel.bind(client)
    client.channel = (...args) => {
      const value = channel(...args), subscribe = value.subscribe.bind(value), on = value.on.bind(value)
      value.on = (kind, filter, callback) => on(kind, filter, payload => {
        signals.push({ table: filter.table, event: payload.eventType })
        callback(payload)
      })
      value.subscribe = callback => subscribe((status, error) => {
        statuses.push(status)
        if (status === 'SUBSCRIBED') subscribed = true
        callback?.(status, error)
      })
      return value
    }
    globalThis.__calendarMetadataMeasurement = { client, done: () => completed++, failed: error => failures.push(String(error)) }
    const bundle = await rolldown({ input: '\0measurement', transform: { define: { 'import.meta.env': JSON.stringify({
      ...flags, DEV: false, VITE_DEMO_MODE: 'false', VITE_SUPABASE_URL: origin,
      VITE_CALENDAR_METADATA_REFRESH_ENABLED: String(enabled),
    }) } }, plugins: [{ name: 'demo-measurement', resolveId(id) {
      if (id === '\0measurement') return id
      if (id.endsWith('/supabase')) return '\0client'
      if (!id.startsWith('.') && !id.startsWith('/') && !id.startsWith('\0')) return { id: import.meta.resolve(id), external: true }
    }, load(id) {
      if (id === '\0client') return 'export const supabase = globalThis.__calendarMetadataMeasurement.client'
      if (id === '\0measurement') return `
        import { useStore } from ${JSON.stringify(resolve('src/hooks/useStore.ts'))};
        import { useCalendarRealtime } from ${JSON.stringify(resolve('src/hooks/useCalendarRealtime.ts'))};
        export function useObservedStore(name, role, scope) {
          const store = useStore(true, role, role === 'user' ? name : undefined, scope, name, 'calendar');
          const {done,failed} = globalThis.__calendarMetadataMeasurement;
          useCalendarRealtime(updatedEventIds => {
            void store.refetchSlices(['calendar'], {triggeredBy:'realtime:calendar',updatedEventIds}).catch(failed).finally(done);
          }, {invalidate:store.invalidateCalendarCache,onParticipants:ids=>{
            void store.refreshCalendarParticipants(ids).catch(failed).finally(done);
          }});
          return store;
        }`
    } }] })
    let hook
    async function settled() {
      const start = performance.now()
      while (pending || performance.now() - lastFinished < 600) {
        if (performance.now() - start > 30000) throw Error('Measurement did not settle')
        await sleep(50)
      }
    }
    try {
      const { output } = await bundle.generate({ format: 'esm', codeSplitting: false })
      const module = await import(`data:text/javascript;base64,${Buffer.from(output[0].code + `\n// ${actor.role}/${pair}/${enabled}`).toString('base64')}`)
      hook = renderHook(() => module.useObservedStore(actor.name, actor.role, `window:${today}:${today}`))
      await waitFor(() => { assert.equal(hook.result.current.loading, false); assert.equal(hook.result.current.error, null); assert.equal(subscribed, true) }, { timeout: 45000 })
      await settled()
      const territory = JSON.stringify(hook.result.current.buildings)
      for (const event of events) {
        phase = event.group_service_scope ? 'group' : 'congregation'
        const memo = `measurement-${actor.role}-${pair}-${enabled}-${phase}`
        const prior = completed
        await act(async () => {
          // Memo-only updates do not notify participants or send push messages.
          const changed = unwrap(await writer.from('calendar_events').update({ memo }).eq('id', event.id).eq('title', title).select('id'))
          assert.equal(changed.length, 1)
          await waitFor(() => assert.ok(completed > prior, JSON.stringify({ signals, statuses, failures, reads: samples.filter(s => s.phase === phase).map(s => s.endpoint) })), { timeout: 30000 })
          await settled()
        })
        assert.deepEqual(failures, [])
        assert.equal(hook.result.current.calendarEvents.find(e => e.id === event.id)?.memo, memo)
        assert.equal(JSON.stringify(hook.result.current.buildings), territory)
        const reads = samples.filter(s => s.phase === phase)
        assert.ok(reads.length && reads.every(s => s.status < 400))
        if (enabled && actor.role === 'user') assert.ok(reads.every(s => ['calendar_events', 'event_card_assignments', 'event_card_assignment_cards'].includes(s.endpoint)))
        const row = { role: actor.role, pair, enabled, phase, requests: reads.length,
          bytes: reads.reduce((n, s) => n + s.bytes, 0),
          readMs: Math.round(Math.max(...reads.map(s => s.end)) - Math.min(...reads.map(s => s.start))),
          byEndpoint: Object.fromEntries([...new Set(reads.map(s => s.endpoint))].map(name => [name, reads.filter(s => s.endpoint === name).length])),
        }
        results.push(row)
        console.log(JSON.stringify(row))
      }
    } finally {
      hook?.unmount(); cleanup(); await client.removeAllChannels(); client.realtime.disconnect(); await bundle.close()
    }
  }
  const report = { project: 'demo', results, limitations: [
    'Actual REST/WebSocket under JSDOM; not whole-app browser/physical phone timing.',
    'Counts observer HTTP reads and uncompressed response bytes, not billed egress, WebSocket or asset bytes.',
    'OFF/ON same candidate, production boolean flags. Metadata writes only; no real assignment changes.',
  ] }
  writeFileSync('scratch/calendar-metadata-measurement.json', JSON.stringify(report, null, 2))
} finally {
  for (const event of events) {
    const deleted = unwrap(await writer.from('calendar_events').delete().eq('id', event.id).eq('title', title).select('id'))
    assert.equal(deleted.length, 1)
  }
  await loginClient.removeAllChannels(); loginClient.realtime.disconnect()
  await writer.removeAllChannels(); writer.realtime.disconnect()
  cleanup(); dom.window.close()
  delete globalThis.__calendarMetadataMeasurement; delete globalThis.IS_REACT_ACT_ENVIRONMENT
  for (const [name, descriptor] of previous) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor)
    else delete globalThis[name]
  }
}
