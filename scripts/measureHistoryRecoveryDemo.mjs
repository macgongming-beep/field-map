import { readFileSync } from 'node:fs'
import { parseEnv } from 'node:util'
import { resolve } from 'node:path'
import { strict as assert } from 'node:assert'
import { createClient } from '@supabase/supabase-js'
import { rolldown } from 'rolldown'
import { JSDOM } from 'jsdom'

// Real useStore + demo DB. This is not a browser/physical-device measurement.
const origin = 'https://itjlykpjmlcvanqpmkmc.supabase.co'
if (!process.env.DEMO_ENV_FILE || !process.argv.includes('--confirm-demo')) throw Error('Explicit demo confirmation required')
const config = parseEnv(readFileSync(process.env.DEMO_ENV_FILE, 'utf8'))
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
    const key = asset.match(/sb_publishable_[A-Za-z0-9_-]+|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/)?.[0]
    if (url === origin && key) { config.VITE_SUPABASE_URL = url; config.VITE_SUPABASE_ANON_KEY = key; break }
  }
}
if (config.VITE_SUPABASE_URL !== origin) throw Error('Demo-only allowlist mismatch')
const key = config.VITE_SUPABASE_ANON_KEY
if (!key || !config.TEST_LOGIN_ID || !config.TEST_LOGIN_PIN || !config.TEST_VOLUNTEER_ID || !config.TEST_VOLUNTEER_PIN) throw Error('Demo accounts required')
const auth = { persistSession: false, autoRefreshToken: false }
const unwrap = ({ data, error }) => { if (error) throw error; return data }
const bootstrap = createClient(origin, key, { auth: { ...auth, storageKey: 'history-demo-login' } })
async function login(id, pin) {
  const rows = unwrap(await bootstrap.rpc('auth_login', { p_login_id: id, p_pin: pin }))
  const actor = Array.isArray(rows) ? rows[0] : rows
  if (!actor?.token) throw Error('Login failed')
  return actor
}
const admin = await login(config.TEST_LOGIN_ID, config.TEST_LOGIN_PIN)
const user = await login(config.TEST_VOLUNTEER_ID, config.TEST_VOLUNTEER_PIN)
if (!['admin', 'developer'].includes(admin.role) || user.role !== 'user') throw Error('Unexpected demo roles')
const writer = createClient(origin, key, { auth: { ...auth, storageKey: 'history-demo-writer' }, global: { headers: { 'x-session-token': admin.token } } })
const title = `history-recovery-measurement-${Date.now()}`
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' })
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' })
const previous = new Map()
for (const name of ['window', 'document', 'navigator', 'localStorage', 'sessionStorage', 'HTMLElement', 'CustomEvent']) {
  previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name))
  Object.defineProperty(globalThis, name, { configurable: true, value: dom.window[name] })
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const { renderHook, waitFor, act, cleanup } = await import('@testing-library/react')
let event, unit
const results = []
const activeRecords = async () => unwrap(await writer.from('visit_histories').select('id,unit_id').is('invalidated_at', null)
  .gte('created_at', new Date(Date.now() - 365 * 86400_000).toISOString()).order('id'))
const originalHistories = await activeRecords()
try {
  const building = unwrap(await writer.from('buildings').select('id,card_id').eq('id', 1).single())
  assert.equal(building.card_id, 1)
  assert.equal(unwrap(await writer.from('units').select('id').eq('building_id', building.id).eq('number', '9988')).length, 0)
  unit = unwrap(await writer.from('units').insert({ building_id: building.id, number: '9988', status: '미방문', is_chinese: true, memo: title }).select('id').single())
  event = unwrap(await writer.from('calendar_events').insert({ event_date: today, time: '10:00', title, type: '주택',
    place: 'Demo measurement only', leader_name: admin.name, card_name: '', has_meeting: false, allow_applications: true }).select('id').single())
  unwrap(await writer.from('event_participants').insert({ event_id: event.id, user_name: user.name, role: '입명' }))
  const assigned = unwrap(await writer.rpc('assign_cards_bulk_tx', { p_token: admin.token, p_event_id: event.id,
    p_assignments: [{ userName: user.name, cardIds: [building.card_id], teamKey: null }], p_status: 'confirmed', p_expected_shared_at: null }))
  assert.equal(assigned?.ok, true)
  for (const enabled of [false, true]) {
    let phase = 'initial'
    const samples = []
    localStorage.setItem('auth_token', user.token)
    localStorage.setItem('currentVisitor', user.name)
    const client = createClient(origin, key, { auth: { ...auth, storageKey: `history-demo-user-${enabled}` }, global: { headers: { 'x-session-token': user.token }, fetch: async (input, init) => {
      const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
      if (url.origin !== origin) throw Error('Cross-project request rejected')
      const endpoint = url.pathname.split('/').pop()
      if (endpoint === 'auto_close_stale_sessions') return new Response('null', { status: 200 })
      const method = init?.method ?? 'GET'
      if (method !== 'GET' && !['territory_sync_clock', 'get_card_summaries', 'get_recipient_return_visit_card_ids',
        'units', 'visit_histories', 'invalidate_visit_history_tx', 'log_service_action'].includes(endpoint)) throw Error(`Unexpected write: ${endpoint}`)
      if (method !== 'GET' && endpoint === 'units' && url.searchParams.get('id') !== `eq.${unit.id}`) throw Error('Non-fixture unit write')
      if (method !== 'GET' && endpoint === 'visit_histories') {
        const body = JSON.parse(init.body)
        if (body.unit_id !== unit.id && url.searchParams.get('unit_id') !== `eq.${unit.id}`) throw Error('Non-fixture history write')
      }
      const label = phase
      const response = await fetch(input, init)
      const body = await response.clone().arrayBuffer()
      samples.push({ phase: label, endpoint, method, status: response.status, bytes: body.byteLength,
        scoped: endpoint === 'visit_histories' && url.searchParams.has('unit_id'),
        delta: endpoint === 'visit_histories' && url.searchParams.has('units.building_id') })
      return response
    } } })
    globalThis.__historyMeasurement = { client }
    const bundle = await rolldown({ input: '\0history-entry', transform: { define: { 'import.meta.env': JSON.stringify({
      DEV: false, VITE_DEMO_MODE: 'true', VITE_TERRITORY_REALTIME_ENABLED: 'true', VITE_SUPABASE_URL: origin,
      VITE_SCOPED_HISTORY_RECOVERY_ENABLED: String(enabled),
    }) } }, plugins: [{ name: 'history-measurement', resolveId(id) {
      if (id === '\0history-entry') return id
      if (id.endsWith('/supabase')) return '\0history-client'
      if (!id.startsWith('.') && !id.startsWith('/') && !id.startsWith('\0')) return { id: import.meta.resolve(id), external: true }
    }, load(id) {
      if (id === '\0history-client') return 'export const supabase = globalThis.__historyMeasurement.client'
      if (id === '\0history-entry') return `export { useStore } from ${JSON.stringify(resolve('src/hooks/useStore.ts'))}`
    } }] })
    let hook, statisticsClient
    try {
      const { output } = await bundle.generate({ format: 'esm', codeSplitting: false })
      const module = await import(`data:text/javascript;base64,${Buffer.from(output[0].code + '\n// ' + enabled).toString('base64')}`)
      hook = renderHook(() => module.useStore(true, 'user', user.name, `window:${today}:${today}`, user.name))
      await waitFor(() => { assert.equal(hook.result.current.loading, false); assert.equal(hook.result.current.error, null) }, { timeout: 45000 })
      assert.ok(hook.result.current.buildings.some(b => b.units.some(u => u.id === unit.id)))
      const recover = async label => {
        phase = label
        await act(async () => { await hook.result.current.refetchSlices(['buildings', 'cards', 'cardBoundaries', 'visits'], { triggeredBy: 'foreground' }) })
        const rows = samples.filter(s => s.phase === label)
        assert.ok(rows.every(r => r.status < 400))
        assert.equal(rows.filter(r => r.scoped).length, enabled ? 0 : 1)
        assert.ok(rows.some(r => r.endpoint === 'service_sessions'))
        results.push({ enabled, phase: label, requests: rows.length, scopedHistoryReads: rows.filter(r => r.scoped).length,
          deltaHistoryReads: rows.filter(r => r.delta).length, decodedBodyBytes: rows.reduce((sum, r) => sum + r.bytes, 0) })
      }
      await recover('unchanged-1')
      await recover('unchanged-2')
      phase = 'save'
      await act(async () => { await hook.result.current.updateUnitStatus(building.id, unit.id, '부재', title, '오후') })
      const saved = hook.result.current.visitHistories.find(h => h.unitId === unit.id)
      assert.ok(saved, 'Saved record missing')
      assert.equal(hook.result.current.buildings.find(b => b.id === building.id).units.find(u => u.id === unit.id).status, '부재')
      assert.ok((await activeRecords()).some(h => h.id === saved.id))
      await recover('after-save')
      phase = 'cancel'
      await act(async () => { await hook.result.current.deleteVisitHistory(saved.id, unit.id) })
      assert.ok(!hook.result.current.visitHistories.some(h => h.id === saved.id))
      assert.ok(!(await activeRecords()).some(h => h.id === saved.id))
      await recover('after-cancel')
      // Another authenticated client changes DB while this store is idle.
      const external = unwrap(await writer.from('visit_histories').insert({ unit_id: unit.id, visitor_name: admin.name,
        result: '부재', time_slot: '오후', visited_at: today, memo: title }).select('id').single())
      await recover('external-save')
      assert.ok(hook.result.current.visitHistories.some(h => h.id === external.id))
      unwrap(await writer.rpc('invalidate_visit_history_tx', { p_token: admin.token, p_history_id: external.id, p_reason: 'Demo verification' }))
      await recover('external-cancel')
      assert.ok(!hook.result.current.visitHistories.some(h => h.id === external.id))
      phase = 'manual'
      await act(async () => { await hook.result.current.refetchSlices(['buildings', 'visits'], { triggeredBy: 'fetchAll' }) })
      assert.ok(samples.some(r => r.phase === 'manual' && r.scoped))
      results.push({ enabled, saveCancelAndExternalRecovery: 'passed', manualRepair: 'passed' })
      hook.unmount(); hook = null
      // The statistics store intentionally does not have a recipient user.
      statisticsClient = createClient(origin, key, { auth: { ...auth, storageKey: `history-demo-admin-${enabled}` }, global: { headers: { 'x-session-token': admin.token }, fetch: (input, init) => {
        const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
        if (url.origin !== origin) throw Error('Cross-project statistics read rejected')
        if (url.pathname.endsWith('/auto_close_stale_sessions')) return Promise.resolve(new Response('null', { status: 200 }))
        if ((init?.method ?? 'GET') !== 'GET' && !['territory_sync_clock', 'get_card_summaries'].includes(url.pathname.split('/').pop())) throw Error('Statistics write rejected')
        return fetch(input, init)
      } } })
      globalThis.__historyMeasurement.client = statisticsClient
      localStorage.setItem('auth_token', admin.token)
      localStorage.setItem('currentVisitor', admin.name)
      const statistics = await import(`data:text/javascript;base64,${Buffer.from(output[0].code + '\n// admin ' + enabled).toString('base64')}`)
      hook = renderHook(() => statistics.useStore(true, 'admin', undefined, 'full', admin.name))
      await waitFor(() => { assert.equal(hook.result.current.loading, false); assert.equal(hook.result.current.error, null) }, { timeout: 45000 })
      assert.deepEqual(hook.result.current.visitHistories.map(h => h.id).sort((a, b) => a - b), (await activeRecords()).map(h => h.id))
      results.push({ enabled, statisticsActiveHistoryCount: hook.result.current.visitHistories.length })
    } finally {
      hook?.unmount(); cleanup(); await client.removeAllChannels(); client.realtime.disconnect()
      await statisticsClient?.removeAllChannels(); statisticsClient?.realtime.disconnect(); await bundle.close()
    }
  }
} finally {
  if (unit) {
    const rows = unwrap(await writer.from('visit_histories').select('id').eq('unit_id', unit.id).is('invalidated_at', null))
    for (const row of rows) unwrap(await writer.rpc('invalidate_visit_history_tx', { p_token: admin.token, p_history_id: row.id, p_reason: 'Demo verification cleanup' }))
    unwrap(await writer.from('units').delete().eq('id', unit.id).eq('memo', title))
  }
  if (event) unwrap(await writer.from('calendar_events').delete().eq('id', event.id).eq('title', title))
  assert.deepEqual(await activeRecords(), originalHistories, 'Original active histories changed')
  await bootstrap.removeAllChannels(); await writer.removeAllChannels()
  cleanup(); dom.window.close()
  delete globalThis.__historyMeasurement; delete globalThis.IS_REACT_ACT_ENVIRONMENT
  for (const [name, descriptor] of previous) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor)
    else delete globalThis[name]
  }
}
console.log(JSON.stringify({ project: 'demo', results, fixtureCleanup: 'passed',
  limitations: ['Application hook state under JSDOM, not physical phone or browser rendering.',
    'Decoded response body bytes, not compressed transfer or Supabase billed egress.',
    'Statistics uses the admin store path with demo data; no developer login or production writes.'] }, null, 2))
