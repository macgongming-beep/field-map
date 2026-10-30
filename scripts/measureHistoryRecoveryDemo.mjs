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
const realtimeMode = process.argv.includes('--realtime')
const queueMode = process.argv.includes('--queue')
const navigationMode = process.argv.includes('--navigation')
if (navigationMode && realtimeMode) throw Error('--navigation is separate from --realtime')
if (queueMode && !realtimeMode) throw Error('--queue requires --realtime')
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const originalWarn = console.warn
if (realtimeMode) console.warn = (...args) => {
  // Bundled data-URL stack traces contain megabytes of source. Preserve the
  // error name/message without dumping the entire measurement module.
  originalWarn(...args.map(value => value instanceof Error ? { name: value.name, message: value.message } : value))
}
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/', pretendToBeVisual: true })
const previous = new Map()
for (const name of ['window', 'document', 'navigator', 'localStorage', 'sessionStorage', 'HTMLElement', 'CustomEvent']) {
  previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name))
  Object.defineProperty(globalThis, name, { configurable: true, value: dom.window[name] })
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const { renderHook, render, waitFor, act, cleanup } = await import('@testing-library/react')
let event, unit
const results = []
const activeRecords = async () => unwrap(await writer.from('visit_histories').select('id,unit_id').is('invalidated_at', null)
  .gte('created_at', new Date(Date.now() - 365 * 86400_000).toISOString()).order('id'))
const originalHistories = await activeRecords()
async function removeFixtureUnit(id, memo) {
  const row = unwrap(await writer.from('units').select('id,building_id,number,memo').eq('id', id).single())
  assert.equal(row.building_id, 1)
  assert.equal(row.number, '9988')
  assert.equal(row.memo, memo)
  assert.ok(memo.startsWith('history-recovery-measurement-'))
  const histories = unwrap(await writer.from('visit_histories').select('id,memo,invalidated_at').eq('unit_id', id))
  assert.ok(histories.every(h => h.memo?.startsWith('history-recovery-measurement-') && h.invalidated_at), 'Non-fixture or active history prevents cleanup')
  assert.equal(unwrap(await writer.from('regular_visits').select('id').eq('unit_id', id)).length, 0)
  for (const table of ['return_visits', 'phone_surveys', 'event_restaurant_assignments']) {
    assert.equal(unwrap(await writer.from(table).select('id').eq('unit_id', id)).length, 0, `Non-fixture ${table} prevents cleanup`)
  }
  let result = unwrap(await writer.rpc('delete_place_or_request_tx', { p_token: admin.token, p_target_type: 'unit',
    p_target_id: id, p_note: 'Temporary demo history-recovery measurement cleanup' }))
  if (result?.action === 'requested') {
    const request = unwrap(await writer.from('place_change_requests').select('id,unit_id,request_type,note').eq('id', result.request_id).single())
    assert.equal(request.unit_id, id)
    assert.equal(request.request_type, 'remove_place')
    assert.equal(request.note, 'Temporary demo history-recovery measurement cleanup')
    result = unwrap(await writer.rpc('execute_place_deletion_request_tx', { p_token: admin.token, p_request_id: request.id }))
  }
  assert.equal(result?.action, 'deleted')
  assert.equal(unwrap(await writer.from('units').select('id').eq('id', id)).length, 0)
}
try {
  const building = unwrap(await writer.from('buildings').select('id,card_id').eq('id', 1).single())
  assert.equal(building.card_id, 1)
  const stale = unwrap(await writer.from('units').select('id,memo').eq('building_id', building.id).eq('number', '9988'))
  for (const row of stale) {
    await removeFixtureUnit(row.id, row.memo)
    console.log(JSON.stringify({ removedStaleFixture: row.id }))
  }
  unit = unwrap(await writer.from('units').insert({ building_id: building.id, number: '9988', status: '미방문', is_chinese: true, memo: title }).select('id').single())
  event = unwrap(await writer.from('calendar_events').insert({ event_date: today, time: '10:00', title, type: '주택',
    place: 'Demo measurement only', leader_name: admin.name, card_name: '', has_meeting: false, allow_applications: true }).select('id').single())
  unwrap(await writer.from('event_participants').insert({ event_id: event.id, user_name: user.name, role: '입명' }))
  const assigned = unwrap(await writer.rpc('assign_cards_bulk_tx', { p_token: admin.token, p_event_id: event.id,
    p_assignments: [{ userName: user.name, cardIds: [building.card_id], teamKey: null }], p_status: 'confirmed', p_expected_shared_at: null }))
  assert.equal(assigned?.ok, true)
  const variants = (realtimeMode ? [0, 250] : [0]).flatMap(delayMs => [false, true].map(flag => ({
    enabled: queueMode ? true : flag, queued: queueMode && flag, delayMs,
  })))
  for (const { enabled, queued, delayMs } of variants) {
    let phase = 'initial'
    let subscribed = false
    const samples = []
    const traces = []
    const trace = (kind, detail = {}) => traces.push({ phase, kind, at: performance.now(), ...detail })
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
      if (method === 'GET' && delayMs) await sleep(delayMs)
      samples.push({ phase: label, endpoint, method, status: response.status, bytes: body.byteLength,
        scoped: endpoint === 'visit_histories' && url.searchParams.has('unit_id'),
        delta: endpoint === 'visit_histories' && url.searchParams.has('units.building_id') })
      return response
    } } })
    if (realtimeMode) {
      const channel = client.channel.bind(client)
      client.channel = (...args) => {
        const value = channel(...args), subscribe = value.subscribe.bind(value), on = value.on.bind(value)
        value.on = (type, filter, callback) => on(type, filter, payload => {
          if (type === 'postgres_changes') trace('signal', { buildingId: payload.new?.building_id })
          callback(payload)
        })
        value.subscribe = callback => subscribe((status, error) => {
          subscribed = status === 'SUBSCRIBED'
          trace('channel', { status })
          callback?.(status, error)
        })
        return value
      }
    }
    globalThis.__historyMeasurement = { client, trace }
    const bundle = await rolldown({ input: '\0history-entry', transform: { define: { 'import.meta.env': JSON.stringify({
      DEV: false, VITE_DEMO_MODE: 'true', VITE_TERRITORY_REALTIME_ENABLED: 'true', VITE_SUPABASE_URL: origin,
      VITE_SCOPED_HISTORY_RECOVERY_ENABLED: String(enabled),
      VITE_VISIT_REALTIME_QUEUE_ENABLED: String(queued),
    }) } }, plugins: [{ name: 'history-measurement', resolveId(id) {
      if (id === '\0history-entry') return id
      if (id.endsWith('/supabase')) return '\0history-client'
      if (realtimeMode && id.endsWith('/scopedHistoryRecovery')) return '\0history-coverage'
      if (!id.startsWith('.') && !id.startsWith('/') && !id.startsWith('\0')) return { id: import.meta.resolve(id), external: true }
    }, load(id) {
      if (id === '\0history-client') return 'export const supabase = globalThis.__historyMeasurement.client'
      if (id === '\0history-coverage') return `
        import * as original from ${JSON.stringify(resolve('src/hooks/scopedHistoryRecovery.ts'))};
        export { historyScope, scopedHistoryRecoveryEnabled } from ${JSON.stringify(resolve('src/hooks/scopedHistoryRecovery.ts'))};
        export function createHistoryCoverage() {
          const coverage = original.createHistoryCoverage();
          const trace = globalThis.__historyMeasurement.trace;
          return { ...coverage,
            invalidate() { trace('invalidated'); return coverage.invalidate(); },
            commit(...args) { trace('complete-read'); return coverage.commit(...args); },
            canReuse(...args) { const reusable = coverage.canReuse(...args); trace('coverage-check', { reusable }); return reusable; }
          };
        }`
      if (id === '\0history-entry') return `
        import React from 'react';
        import { useStore } from ${JSON.stringify(resolve('src/hooks/useStore.ts'))};
        import { useTerritoryRealtime } from ${JSON.stringify(resolve('src/hooks/useTerritoryRealtime.ts'))};
        import { TerritoryRealtimeContext } from ${JSON.stringify(resolve('src/hooks/territoryRealtimeContext.ts'))};
        export { useStore };
        function MapProbe() { useTerritoryRealtime([1]); return null; }
        export function Probe({ name, scope }) {
          const store = useStore(true, 'user', name, scope, name);
          globalThis.__historyMeasurement.store = store;
          const trace = globalThis.__historyMeasurement.trace;
          const value = { ...store.territoryRealtime, sync: async ids => {
            trace('realtime-sync-start');
            try { await store.territoryRealtime.sync(ids); trace('realtime-sync-success'); }
            catch(error) { trace('realtime-sync-failed', { name: error.name }); throw error; }
          }};
          return React.createElement(TerritoryRealtimeContext.Provider, { value }, store.loading ? null : React.createElement(MapProbe));
        }
        export function mountProbe(name, scope) { return React.createElement(Probe, { name, scope }); }`
    } }] })
    let hook, statisticsClient
    try {
      const { output } = await bundle.generate({ format: 'esm', codeSplitting: false })
      const module = await import(`data:text/javascript;base64,${Buffer.from(output[0].code + '\n// ' + enabled + ':' + queued + ':' + delayMs).toString('base64')}`)
      if (realtimeMode) {
        const view = render(module.mountProbe(user.name, `window:${today}:${today}`))
        hook = { result: { get current() { return globalThis.__historyMeasurement.store } }, unmount: () => view.unmount() }
      } else hook = renderHook(() => module.useStore(true, 'user', user.name, `window:${today}:${today}`, user.name))
      await waitFor(() => { assert.equal(hook.result.current.loading, false); assert.equal(hook.result.current.error, null) }, { timeout: 45000 })
      assert.ok(hook.result.current.buildings.some(b => b.units.some(u => u.id === unit.id)))
      if (realtimeMode) {
        await act(async () => { await waitFor(() => assert.equal(subscribed, true), { timeout: 20000 }); await sleep(3000) })
        for (let cycle = 1; cycle <= 4; cycle++) {
          for (const operation of ['save', 'cancel']) {
            const label = `${cycle}-${operation}`
            phase = `${label}-write`
            const traceStart = traces.length, sampleStart = samples.length
            await act(async () => {
              if (operation === 'save') await hook.result.current.updateUnitStatus(building.id, unit.id, '부재', title, '오후')
              else {
                const record = hook.result.current.visitHistories.find(h => h.unitId === unit.id)
                assert.ok(record, 'Missing record before cancel')
                await hook.result.current.deleteVisitHistory(record.id, unit.id)
              }
              await sleep(3000)
            })
            assert.equal(hook.result.current.visitHistories.some(h => h.unitId === unit.id), operation === 'save')
            const writeTrace = traces.slice(traceStart)
            assert.ok(writeTrace.some(t => t.kind === 'signal' && t.buildingId === building.id), 'No actual self-write realtime signal')
            phase = `${label}-foreground`
            await act(async () => { await hook.result.current.refetchAll(true) })
            const rows = samples.filter(s => s.phase === phase)
            assert.ok(rows.every(r => r.status < 400))
            assert.equal(hook.result.current.visitHistories.some(h => h.unitId === unit.id), operation === 'save')
            const dbIds = (await activeRecords()).filter(h => h.unit_id === unit.id).map(h => h.id)
            assert.deepEqual(hook.result.current.visitHistories.filter(h => h.unitId === unit.id).map(h => h.id), dbIds)
            const cycleRows = samples.slice(sampleStart)
            results.push({ enabled, queued, delayMs, cycle, operation, foregroundRequests: rows.length,
              cycleRequests: cycleRows.length, cycleGetRequests: cycleRows.filter(r => r.method === 'GET').length,
              cycleEndpoints: Object.fromEntries([...new Set(cycleRows.map(r => r.endpoint))].sort().map(endpoint => [endpoint, cycleRows.filter(r => r.endpoint === endpoint).length])),
              scopedHistoryReads: rows.filter(r => r.scoped).length, deltaHistoryReads: rows.filter(r => r.delta).length,
              cycleHistoryReads: samples.slice(sampleStart).filter(r => r.endpoint === 'visit_histories' && r.method === 'GET').length,
              writeSignals: writeTrace.filter(t => t.kind === 'signal').length,
              writeInvalidations: writeTrace.filter(t => t.kind === 'invalidated').length,
              realtimeSyncFailures: traces.slice(traceStart).filter(t => t.kind === 'realtime-sync-failed').map(t => t.name),
              correctRecordState: true })
            console.log(JSON.stringify({ sample: results.at(-1) }))
          }
        }
        continue
      }
      const recover = async label => {
        phase = label
        await act(async () => { await hook.result.current.refetchSlices(navigationMode ? ['calendar'] : ['buildings', 'cards', 'cardBoundaries', 'visits'], { triggeredBy: navigationMode ? 'navigation:calendar' : 'foreground' }) })
        const rows = samples.filter(s => s.phase === label)
        assert.ok(rows.every(r => r.status < 400))
        assert.equal(rows.filter(r => r.scoped).length, enabled ? 0 : 1)
        if (!navigationMode) assert.ok(rows.some(r => r.endpoint === 'service_sessions'))
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
      if (navigationMode) {
        const originalCards = new Set(hook.result.current.buildings.map(b => b.cardId))
        const candidate = unwrap(await writer.from('buildings').select('id,card_id').order('id'))
          .find(b => b.card_id && !originalCards.has(b.card_id))
        assert.ok(candidate, 'No outside-scope demo card for reassignment test')
        unwrap(await writer.from('event_participants').upsert({ event_id: event.id, user_name: admin.name, role: '입명' }, { onConflict: 'event_id,user_name' }))
        const assign = async (cardId, includeOther = false) => {
          const fresh = unwrap(await writer.from('calendar_events').select('assignment_shared_at').eq('id', event.id).single())
          const assignments = [{ userName: user.name, cardIds: [cardId], teamKey: 'navigation-user', cardScope: '전체', informalAssetIds: [] }]
          if (includeOther) assignments.push({ userName: admin.name, cardIds: [building.card_id], teamKey: 'navigation-other', cardScope: '전체', informalAssetIds: [] })
          const result = unwrap(await writer.rpc('assign_team_service_bulk_tx', { p_token: admin.token, p_event_id: event.id,
            p_assignments: assignments, p_status: 'confirmed', p_expected_shared_at: fresh.assignment_shared_at }))
          assert.equal(result?.ok, true)
        }
        phase = 'navigation-reassigned'
        await assign(candidate.card_id, true)
        await act(async () => { await hook.result.current.refetchSlices(['calendar'], { triggeredBy: 'navigation:calendar' }) })
        assert.ok(hook.result.current.buildings.some(b => b.id === candidate.id), 'New assignment not reflected')
        assert.ok(hook.result.current.calendarEvents.filter(e => e.id === event.id).flatMap(e => e.cardAssignments ?? [])
          .some(a => a.userName === user.name && (a.assignedCardIds ?? [a.assignedCardId]).includes(candidate.card_id)), 'New assignment missing from calendar')
        phase = 'navigation-revoked'
        // Only the isolated fixture participant is removed; DB cleanup triggers revoke its assignments.
        unwrap(await writer.from('event_participants').delete().eq('event_id', event.id).eq('user_name', user.name))
        await act(async () => { await hook.result.current.refetchSlices(['calendar'], { triggeredBy: 'navigation:calendar' }) })
        assert.ok(!hook.result.current.buildings.some(b => b.cardId === candidate.card_id), 'Revoked card remains visible')
        assert.ok(!hook.result.current.calendarEvents.filter(e => e.id === event.id).flatMap(e => e.cardAssignments ?? [])
          .some(a => a.userName === user.name), 'Revoked assignment remains in calendar')
        assert.ok(hook.result.current.calendarEvents.filter(e => e.id === event.id).flatMap(e => e.cardAssignments ?? [])
          .some(a => a.userName === admin.name && (a.assignedCardIds ?? [a.assignedCardId]).includes(building.card_id)), 'Other team was lost during cancellation')
        results.push({ enabled, navigationReassignment: 'passed', navigationCancellation: 'passed' })
        unwrap(await writer.from('event_participants').insert({ event_id: event.id, user_name: user.name, role: '입명' }))
        await assign(building.card_id)
      }
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
    await removeFixtureUnit(unit.id, title)
  }
  if (event) {
    unwrap(await writer.from('calendar_events').delete().eq('id', event.id).eq('title', title))
    assert.equal(unwrap(await writer.from('calendar_events').select('id').eq('id', event.id)).length, 0)
  }
  assert.deepEqual(await activeRecords(), originalHistories, 'Original active histories changed')
  await bootstrap.removeAllChannels(); await writer.removeAllChannels()
  cleanup(); dom.window.close()
  delete globalThis.__historyMeasurement; delete globalThis.IS_REACT_ACT_ENVIRONMENT
  console.warn = originalWarn
  for (const [name, descriptor] of previous) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor)
    else delete globalThis[name]
  }
}
console.log(JSON.stringify({ project: 'demo', mode: navigationMode ? 'navigation-recovery' : realtimeMode ? 'live-realtime-cycles' : 'baseline', results, fixtureCleanup: 'passed',
  limitations: ['Application hook state under JSDOM, not physical phone or browser rendering.',
    ...(realtimeMode ? ['Real map realtime subscription, 4 save/cancel pairs per flag/delay combination; 250ms is added GET response latency, not measured mobile RTT.',
      'Calls refetchAll(true) directly after 3 seconds to test eligible foreground recovery; does not count skips caused by the 2-minute visibility cooldown. Subscription stays connected, no physical background/reconnect simulation.',
      'Coverage wrapper logs calls only; original completeness policy is unchanged.'] : []),
    'Decoded response body bytes, not compressed transfer or Supabase billed egress.',
    realtimeMode ? 'Checks record IDs against demo DB after every cycle; does not remeasure statistics in realtime mode.'
      : 'Statistics uses the admin store path with demo data; no developer login.',
    'No production writes.'] }, null, 2))
