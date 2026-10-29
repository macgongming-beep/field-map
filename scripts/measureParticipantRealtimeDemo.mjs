import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs'
import { parseEnv } from 'node:util'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { strict as assert } from 'node:assert'
import { createClient } from '@supabase/supabase-js'
import { rolldown } from 'rolldown'
import { JSDOM } from 'jsdom'

// Real application hooks + two authenticated demo clients, not browser automation.
const origin = 'https://itjlykpjmlcvanqpmkmc.supabase.co'
if (!process.env.DEMO_ENV_FILE || !process.argv.includes('--confirm-demo')) throw Error('Explicit demo confirmation required')
const config = { ...parseEnv(readFileSync(process.env.DEMO_ENV_FILE, 'utf8')), ...process.env }
if (!config.VITE_SUPABASE_URL && !config.VITE_SUPABASE_ANON_KEY) {
  const root = 'https://chinese-territory-app-demo.vercel.app'
  const html = await (await fetch(root)).text()
  const path = html.match(/src="(\/assets\/index-[^"]+\.js)"/)?.[1]
  if (!path) throw Error('Missing demo entry')
  const entry = await (await fetch(root + path)).text()
  const paths = [...new Set([...entry.matchAll(/(?:\.\/|assets\/)([A-Za-z0-9_-]+\.js)/g)].map(m => '/assets/' + m[1]))]
  for (const path of paths) {
    const asset = await (await fetch(root + path)).text()
    const url = asset.match(/https:\/\/[a-z]+\.supabase\.co/)?.[0]
    const publicKey = asset.match(/sb_publishable_[A-Za-z0-9_-]+|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/)?.[0]
    if (url === origin && publicKey) { config.VITE_SUPABASE_URL = url; config.VITE_SUPABASE_ANON_KEY = publicKey; break }
  }
}
if (config.VITE_SUPABASE_URL !== origin) throw Error('Demo-only allowlist mismatch')
const key = config.VITE_SUPABASE_ANON_KEY
if (!key || !config.TEST_LOGIN_ID || !config.TEST_LOGIN_PIN || !config.TEST_VOLUNTEER_ID || !config.TEST_VOLUNTEER_PIN) throw Error('Demo accounts required')
const auth = { persistSession: false, autoRefreshToken: false }
const bootstrap = createClient(origin, key, { auth: { ...auth, storageKey: 'participant-measurement-login' } })
const unwrap = ({ data, error }) => { if (error) throw error; return data }
async function login(id, pin) {
  const rows = unwrap(await bootstrap.rpc('auth_login', { p_login_id: id, p_pin: pin }))
  const actor = Array.isArray(rows) ? rows[0] : rows
  if (!actor?.token) throw Error('Login failed')
  return actor
}
const admin = await login(config.TEST_LOGIN_ID, config.TEST_LOGIN_PIN)
const user = await login(config.TEST_VOLUNTEER_ID, config.TEST_VOLUNTEER_PIN)
if (!['admin', 'developer'].includes(admin.role) || user.role !== 'user') throw Error('Unexpected demo roles')
const writer = createClient(origin, key, { auth: { ...auth, storageKey: 'participant-measurement-writer' }, global: { headers: { 'x-session-token': admin.token } } })
const statePath = '/tmp/participant-realtime-demo.json'
if (process.argv.includes('--inspect-fixtures')) {
  console.log(JSON.stringify(unwrap(await writer.from('calendar_events').select('id,title,created_at').like('title', 'participant-realtime-measurement-%'))))
  process.exit(0)
}
if (existsSync(statePath)) {
  const stale = JSON.parse(readFileSync(statePath, 'utf8'))
  if (stale.origin !== origin || !stale.title.startsWith('participant-realtime-measurement-') || !Number.isSafeInteger(stale.id)) throw Error('Invalid cleanup fixture')
  unwrap(await writer.from('calendar_events').delete().eq('id', stale.id).eq('title', stale.title))
  unlinkSync(statePath)
}
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' })
const title = `participant-realtime-measurement-${Date.now()}`
const event = unwrap(await writer.from('calendar_events').insert({ event_date: today, time: '10:00', title, type: '주택',
  place: 'Demo measurement only', leader_name: admin.name, card_name: '', has_meeting: false, allow_applications: true }).select('id').single())
writeFileSync(statePath, JSON.stringify({ origin, id: event.id, title }))
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' })
const previous = new Map()
for (const name of ['window', 'document', 'navigator', 'localStorage', 'sessionStorage', 'HTMLElement', 'CustomEvent']) {
  previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name))
  Object.defineProperty(globalThis, name, { configurable: true, value: dom.window[name] })
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true
localStorage.setItem('auth_token', user.token)
localStorage.setItem('currentVisitor', user.name)
const { renderHook, waitFor, act, cleanup } = await import('@testing-library/react')
const results = []
try {
  for (const scenario of ['before-visible', 'after-visible', 'after-offscreen']) {
    let phase = 'initial', subscribed = false, completed = 0, channelStatus = 'not-started'
    const samples = []
    const client = createClient(origin, key, { auth: { ...auth, storageKey: `participant-measurement-${scenario}` }, global: {
      headers: { 'x-session-token': user.token },
      fetch: async (input, init) => {
        const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
        if (url.origin !== origin) throw Error('Cross-project read rejected')
        if (url.pathname.endsWith('/auto_close_stale_sessions')) return new Response('null', { status: 200 })
        if ((init?.method ?? 'GET') !== 'GET' && !['territory_sync_clock', 'get_card_summaries', 'get_recipient_return_visit_card_ids'].includes(url.pathname.split('/').pop())) throw Error('Observer write rejected')
        const label = phase
        const response = await fetch(input, init)
        samples.push({ phase: label, endpoint: url.pathname.split('/').pop(), status: response.status })
        return response
      },
    } })
    const channel = client.channel.bind(client)
    client.channel = (...args) => {
      const value = channel(...args), subscribe = value.subscribe.bind(value)
      value.subscribe = callback => subscribe((status, error) => {
        channelStatus = status
        if (status === 'SUBSCRIBED') subscribed = true
        callback?.(status, error)
      })
      return value
    }
    globalThis.__participantMeasurement = { client, completed: () => { ++completed } }
    const root = process.cwd()
    const bundle = await rolldown({ input: '\0participant-entry', transform: { define: { 'import.meta.env': JSON.stringify({
      DEV: false, VITE_DEMO_MODE: 'true', VITE_TERRITORY_REALTIME_ENABLED: 'true', VITE_SUPABASE_URL: origin,
    }) } }, plugins: [{ name: 'participant-measurement', resolveId(id) {
      if (id === '\0participant-entry') return id
      if (id.endsWith('/supabase')) return '\0participant-client'
      if (!id.startsWith('.') && !id.startsWith('/') && !id.startsWith('\0')) return { id: import.meta.resolve(id), external: true }
    }, load(id) {
      if (id === '\0participant-client') return 'export const supabase = globalThis.__participantMeasurement.client'
      if (id === '\0participant-entry') return `
        import { useStore } from ${JSON.stringify(resolve('src/hooks/useStore.ts'))};
        import { useCalendarRealtime } from ${JSON.stringify(resolve('src/hooks/useCalendarRealtime.ts'))};
        export function useObservedStore(name, scope) {
          const store = useStore(true, 'user', name, scope, name);
          const done = globalThis.__participantMeasurement.completed;
          useCalendarRealtime(() => { void store.refetchSlices(['calendar'], { triggeredBy: 'realtime:calendar' }).finally(done); }, {
            invalidate: store.invalidateCalendarCache,
            onParticipants: ids => { void store.refreshCalendarParticipants(ids).finally(done); }
          });
          return store;
        }`
      if (scenario.startsWith('before') && id.startsWith(root + '/src/')) {
        return { code: execFileSync('git', ['show', `adf6d37:${id.slice(root.length + 1)}`], { encoding: 'utf8' }), moduleType: id.endsWith('.tsx') ? 'tsx' : 'ts' }
      }
    } }] })
    let hook
    try {
      const { output } = await bundle.generate({ format: 'esm', codeSplitting: false })
      // A new observer needs a new module instance, not a cached reference to
      // the previous scenario's closed Supabase client.
      const module = await import(`data:text/javascript;base64,${Buffer.from(output[0].code + '\n// observer: ' + scenario).toString('base64')}`)
      const day = scenario === 'after-offscreen' ? '2000-01-01' : today
      hook = renderHook(() => module.useObservedStore(user.name, `window:${day}:${day}`))
      await waitFor(() => { assert.equal(hook.result.current.loading, false); assert.equal(hook.result.current.error, null); assert.equal(subscribed, true, `${scenario} channel: ${channelStatus}`) }, { timeout: 45000 })
      for (const operation of ['join', 'cancel']) {
        phase = operation
        const before = completed
        await act(async () => {
          if (operation === 'join') unwrap(await writer.from('event_participants').insert({ event_id: event.id, user_name: admin.name, role: '신청' }))
          else unwrap(await writer.from('event_participants').delete().eq('event_id', event.id).eq('user_name', admin.name))
          await waitFor(() => assert.ok(completed > before), { timeout: 20000 })
        })
        if (scenario !== 'after-offscreen') assert.equal(hook.result.current.calendarEvents.find(e => e.id === event.id)?.applicants.includes(admin.name), operation === 'join')
        const requests = samples.filter(s => s.phase === operation)
        assert.ok(requests.every(r => r.status < 400))
        const byEndpoint = Object.fromEntries([...new Set(requests.map(s => s.endpoint))].map(endpoint => [endpoint, requests.filter(s => s.endpoint === endpoint).length]))
        results.push({ scenario, operation, requests: requests.length, byEndpoint })
        if (scenario === 'after-visible') assert.deepEqual(byEndpoint, { calendar_events: 1 })
        if (scenario === 'after-offscreen') assert.equal(requests.length, 0)
      }
    } finally {
      hook?.unmount(); cleanup(); await client.removeAllChannels(); client.realtime.disconnect(); await bundle.close()
      unwrap(await writer.from('event_participants').delete().eq('event_id', event.id).eq('user_name', admin.name))
    }
  }
  console.log(JSON.stringify({ project: 'demo', eventId: event.id, results,
    limitations: ['Two authenticated clients and real WebSocket/database writes with application hooks under JSDOM, not two physical phones or whole-app browser traffic.',
      'HTTP request counts only; excludes assets/chat/push/map and does not estimate billed bytes.',
      'Restaurant/card assignment changes intentionally retain broader scope recovery.'] }, null, 2))
} finally {
  unwrap(await writer.from('calendar_events').delete().eq('id', event.id).eq('title', title))
  unlinkSync(statePath)
  await bootstrap.removeAllChannels(); await writer.removeAllChannels()
  cleanup(); dom.window.close()
  delete globalThis.__participantMeasurement; delete globalThis.IS_REACT_ACT_ENVIRONMENT
  for (const [name, descriptor] of previous) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor)
    else delete globalThis[name]
  }
}
