import { readFileSync, writeFileSync } from 'node:fs'
import { parseEnv } from 'node:util'
import { resolve } from 'node:path'
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads'
import { strict as assert } from 'node:assert'
import { createClient } from '@supabase/supabase-js'

// Independent JS realms preserve per-device auth, caches and request queues.
// Real application hooks and demo DB/WebSockets; not browser automation.
const origin = 'https://itjlykpjmlcvanqpmkmc.supabase.co'
const auth = { persistSession: false, autoRefreshToken: false }
const unwrap = ({ data, error }) => { if (error) throw error; return data }
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const readRpc = new Set(['territory_sync_clock', 'get_card_summaries', 'get_recipient_return_visit_card_ids'])
const safeError = error => ({ name: error?.name, message: error?.message ?? String(error) })

async function workerMain() {
  const { JSDOM } = await import('jsdom')
  const { rolldown } = await import('rolldown')
  const { actor, key, fixture, delayMs, label, mapScope, dedup, participantDedup } = workerData
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/', pretendToBeVisual: true })
  for (const name of ['window', 'document', 'navigator', 'localStorage', 'sessionStorage', 'HTMLElement', 'CustomEvent']) {
    Object.defineProperty(globalThis, name, { configurable: true, value: dom.window[name] })
  }
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  localStorage.setItem('auth_token', actor.token)
  localStorage.setItem('currentVisitor', actor.name)
  const errors = []
  console.warn = (...values) => errors.push(values.map(v => v instanceof Error ? safeError(v) : String(v)))
  console.error = (...values) => {
    if (String(values[0]).includes('not wrapped in act')) return
    errors.push(values.map(v => v instanceof Error ? safeError(v) : String(v)))
  }
  let phase = 'initial', pending = 0, lastActivity = performance.now()
  let holdNextUnits = false, releaseUnits = null
  let holdNextParticipants = false, releaseParticipants = null
  const samples = [], signals = [], statuses = new Map()
  const client = createClient(origin, key, { auth: { ...auth, storageKey: label }, global: {
    headers: { 'x-session-token': actor.token },
    fetch: async (input, init) => {
      const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
      assert.equal(url.origin, origin, 'Cross-project access rejected')
      const endpoint = url.pathname.split('/').pop(), method = init?.method ?? 'GET'
      // Do not mutate unrelated sessions via startup maintenance.
      if (endpoint === 'auto_close_stale_sessions') return new Response('null', { status: 200 })
      if (method !== 'GET' && !readRpc.has(endpoint)) {
        const body = init?.body ? JSON.parse(init.body) : {}
        if (endpoint === 'buildings') assert.equal(url.searchParams.get('id'), `eq.${fixture.building.id}`)
        else if (endpoint === 'units') assert.equal(url.searchParams.get('id'), `eq.${fixture.unit.id}`)
        else if (endpoint === 'visit_histories') assert.equal(body.unit_id, fixture.unit.id)
        else if (endpoint === 'event_participants') {
          assert.equal(body.event_id ?? Number(url.searchParams.get('event_id')?.replace('eq.', '')), fixture.application.id)
        } else if (endpoint === 'toggle_event_application_tx') assert.equal(body.p_event_id, fixture.application.id)
        else if (endpoint === 'invalidate_visit_history_tx') {
          assert.ok(globalThis.__fanout.store.visitHistories.some(h => h.id === body.p_history_id && h.unitId === fixture.unit.id))
        } else if (endpoint !== 'log_service_action') throw Error(`Unexpected mutation: ${endpoint}`)
      }
      const startPhase = phase, started = performance.now()
      pending++
      try {
        const response = await fetch(input, init)
        const body = await response.clone().arrayBuffer(), bytes = body.byteLength
        const proof = endpoint === 'territory_change_signals' && url.searchParams.has('building_id')
          ? JSON.parse(new TextDecoder().decode(body)) : undefined
        if (holdNextUnits && endpoint === 'units' && method === 'GET' && url.searchParams.has('building_id')) {
          holdNextUnits = false
          await new Promise(resolve => { releaseUnits = resolve })
          releaseUnits = null
        }
        if (holdNextParticipants && endpoint === 'calendar_events' && method === 'GET'
          && url.searchParams.get('select')?.startsWith('id,event_participants(')) {
          holdNextParticipants = false
          await new Promise(resolve => { releaseParticipants = resolve })
          releaseParticipants = null
        }
        if ((method === 'GET' || readRpc.has(endpoint)) && delayMs) await sleep(delayMs)
        samples.push({ phase: startPhase, endpoint, method, read: method === 'GET' || readRpc.has(endpoint),
          query: Object.fromEntries(url.searchParams), status: response.status, decodedBytes: bytes,
          durationMs: Math.round(performance.now() - started), ...(proof ? { proof } : {}) })
        return response
      } finally { pending--; lastActivity = performance.now() }
    },
  } })
  const channel = client.channel.bind(client)
  client.channel = (...args) => {
    const value = channel(...args), on = value.on.bind(value), subscribe = value.subscribe.bind(value)
    value.on = (type, filter, callback) => on(type, filter, payload => {
      signals.push({ phase, table: filter.table, event: payload.eventType,
        ...(filter.table === 'territory_change_signals' ? { signal: payload.new } : {}) })
      lastActivity = performance.now()
      callback(payload)
    })
    value.subscribe = callback => subscribe((status, error) => {
      statuses.set(args[0].split(':')[0], status)
      lastActivity = performance.now()
      callback?.(status, error)
    })
    return value
  }
  globalThis.__fanout = { client, errors }
  const { render, waitFor, act, cleanup } = await import('@testing-library/react')
  const flags = { DEV: false, VITE_DEMO_MODE: 'true', VITE_TERRITORY_REALTIME_ENABLED: 'true',
    VITE_VISIT_SIGNAL_DEDUP_ENABLED: String(dedup),
    VITE_CALENDAR_PARTICIPANT_DEDUP_ENABLED: String(participantDedup),
    VITE_SUPABASE_URL: origin, VITE_CART_APPLICATIONS_ENABLED: 'true', VITE_RECIPIENT_CARD_SCOPE_ENABLED: 'true' }
  const bundle = await rolldown({ input: '\0fanout-entry', transform: { define: { 'import.meta.env': JSON.stringify(flags) } },
    plugins: [{ name: 'fanout-client', resolveId(id) {
      if (id === '\0fanout-entry') return id
      if (id.endsWith('/supabase')) return '\0fanout-client'
      if (!id.startsWith('.') && !id.startsWith('/') && !id.startsWith('\0')) return { id: import.meta.resolve(id), external: true }
    }, load(id) {
      if (id === '\0fanout-client') return 'export const supabase = globalThis.__fanout.client'
      if (id === '\0fanout-entry') return `
        import React from 'react';
        import { useStore } from ${JSON.stringify(resolve('src/hooks/useStore.ts'))};
        import { useCalendarRealtime } from ${JSON.stringify(resolve('src/hooks/useCalendarRealtime.ts'))};
        import { useTerritoryRealtime } from ${JSON.stringify(resolve('src/hooks/useTerritoryRealtime.ts'))};
        import { calendarReadScope } from ${JSON.stringify(resolve('src/hooks/calendarReadScope.ts'))};
        import { TerritoryRealtimeContext } from ${JSON.stringify(resolve('src/hooks/territoryRealtimeContext.ts'))};
        function MapProbe() { useTerritoryRealtime([${fixture.cardId}]); return null; }
        export function Probe({name, role}) {
          const scope = ${Boolean(mapScope)} ? calendarReadScope('/map', '', '', false, 'true', new Date(), role, name)
            : ${JSON.stringify(`window:${fixture.today}:${fixture.today}`)};
          const store = useStore(true, role, role === 'user' ? name : undefined, scope, name);
          globalThis.__fanout.store = store;
          const fail = error => globalThis.__fanout.errors.push({name: error.name, message: error.message});
          useCalendarRealtime(() => { void store.refetchSlices(['calendar'], {triggeredBy:'realtime:calendar'}).catch(fail); }, {
            invalidate: store.invalidateCalendarCache,
            skipParticipantSignal: store.skipParticipantSignal,
            onParticipants: ids => { void store.refreshCalendarParticipants(ids).catch(fail); }
          });
          return React.createElement(TerritoryRealtimeContext.Provider, {value:store.territoryRealtime},
            store.loading ? null : React.createElement(MapProbe));
        }`
    } }] })
  const { output } = await bundle.generate({ format: 'esm', codeSplitting: false })
  const mod = await import(`data:text/javascript;base64,${Buffer.from(output[0].code).toString('base64')}`)
  const React = await import('react')
  const view = render(React.createElement(mod.Probe, { name: actor.name, role: actor.role }))
  const current = () => globalThis.__fanout.store
  await waitFor(() => {
    assert.equal(current().loading, false); assert.equal(current().error, null)
    assert.ok(current().buildings.some(b => b.id === fixture.building.id))
    assert.equal(statuses.get('calendar_sync'), 'SUBSCRIBED')
    assert.equal(statuses.get('territory_sync'), 'SUBSCRIBED')
  }, { timeout: 60000 })
  async function settle() {
    await act(async () => {
      const deadline = Date.now() + 30000
      while (pending || performance.now() - lastActivity < 3200) {
        if (Date.now() > deadline) throw Error('Requests failed to settle')
        await sleep(100)
      }
    })
  }
  await settle()
  function snapshot() {
    const store = current(), building = store.buildings.find(b => b.id === fixture.building.id)
    return { recordIds: store.visitHistories.filter(h => h.unitId === fixture.unit.id).map(h => h.id),
      status: building?.units.find(u => u.id === fixture.unit.id)?.status, buildingName: building?.name,
      applicant: Boolean(store.calendarEvents.find(e => e.id === fixture.application.id)?.applicants.includes(fixture.volunteerName)),
      applicants: store.calendarEvents.find(e => e.id === fixture.application.id)?.applicants.slice().sort() ?? [],
      error: store.error, loading: store.loading }
  }
  parentPort.postMessage({ ready: true, label, role: actor.role, flags })
  parentPort.on('message', async ({ id, command, value }) => {
    try {
      let result
      if (command === 'phase') { await settle(); phase = value; result = snapshot() }
      else if (command === 'hold-next-units') { holdNextUnits = true; result = true }
      else if (command === 'units-held') result = Boolean(releaseUnits)
      else if (command === 'release-units') { releaseUnits?.(); result = true }
      else if (command === 'hold-next-participants') { holdNextParticipants = true; result = true }
      else if (command === 'participants-held') result = Boolean(releaseParticipants)
      else if (command === 'release-participants') { releaseParticipants?.(); result = true }
      else if (command === 'action') {
        await act(async () => {
          if (value === 'save') await current().updateUnitStatus(fixture.building.id, fixture.unit.id, '부재', fixture.tag, '오후')
          else if (value === 'cancel-visit') {
            const record = current().visitHistories.find(h => h.unitId === fixture.unit.id)
            assert.ok(record, 'No record available to cancel')
            await current().deleteVisitHistory(record.id, fixture.unit.id)
          } else if (value === 'join' || value === 'cancel-application') await current().applyToEvent(fixture.application.id)
          else if (value === 'edit' || value === 'restore') {
            assert.equal(await current().updateBuilding(fixture.building.id,
              fixture.tag + (value === 'edit' ? '-edited' : ''), fixture.building.address), true)
          } else throw Error('Unknown action')
        })
        result = snapshot()
      } else if (command === 'collect') { await settle(); result = { snapshot: snapshot(), samples: samples.filter(s => s.phase === phase), signals: signals.filter(s => s.phase === phase), errors } }
      else if (command === 'close') {
        view.unmount(); cleanup(); await client.removeAllChannels(); client.realtime.disconnect(); await bundle.close(); dom.window.close()
        parentPort.postMessage({ id, result: 'closed' }); parentPort.close(); return
      } else throw Error('Unknown command')
      parentPort.postMessage({ id, result })
    } catch (error) { parentPort.postMessage({ id, error: safeError(error) }) }
  })
}

async function main() {
  assert.ok(process.argv.includes('--confirm-demo'), 'Explicit --confirm-demo required')
  const config = parseEnv(readFileSync(process.env.DEMO_ENV_FILE ?? '.env.demo-scope-verification.local', 'utf8'))
  if (!config.VITE_SUPABASE_URL && !config.VITE_SUPABASE_ANON_KEY) {
    const root = 'https://chinese-territory-app-demo.vercel.app'
    const html = await (await fetch(root)).text()
    const entryPath = html.match(/src="(\/assets\/index-[^"]+\.js)"/)?.[1]
    assert.ok(entryPath, 'Missing demo entry')
    const entry = await (await fetch(root + entryPath)).text()
    const paths = [...new Set([...entry.matchAll(/(?:\.\/|assets\/)([A-Za-z0-9_-]+\.js)/g)].map(m => '/assets/' + m[1]))]
    for (const path of paths) {
      const asset = await (await fetch(root + path)).text()
      const url = asset.match(/https:\/\/[a-z]+\.supabase\.co/)?.[0]
      const publicKey = asset.match(/sb_publishable_[A-Za-z0-9_-]+|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/)?.[0]
      if (url === origin && publicKey) { config.VITE_SUPABASE_URL = url; config.VITE_SUPABASE_ANON_KEY = publicKey; break }
    }
  }
  assert.equal(config.VITE_SUPABASE_URL, origin, 'Demo allowlist mismatch')
  // Credentials arrive only over stdin, never command arguments, files or output.
  process.stdout.write('Enter demo account JSON on stdin\n')
  process.stdin.setRawMode?.(true)
  const credentials = await new Promise(resolve => {
    let input = ''
    const handler = chunk => { input += chunk.toString(); if (/[\r\n]/.test(input)) { process.stdin.off('data', handler); resolve(JSON.parse(input.trim())) } }
    process.stdin.on('data', handler)
  })
  process.stdin.setRawMode?.(false); process.stdin.pause()
  const key = config.VITE_SUPABASE_ANON_KEY
  const bootstrap = createClient(origin, key, { auth })
  const login = async (id, pin) => {
    const rows = unwrap(await bootstrap.rpc('auth_login', { p_login_id: id, p_pin: pin }))
    const actor = Array.isArray(rows) ? rows[0] : rows
    assert.ok(actor?.token, 'Demo login failed'); return actor
  }
  const admin = await login(credentials.adminId, credentials.adminPin)
  const user = await login(credentials.userId, credentials.userPin)
  assert.ok(['admin', 'developer'].includes(admin.role)); assert.equal(user.role, 'user')
  const writer = createClient(origin, key, { auth, global: { headers: { 'x-session-token': admin.token } } })
  if (process.argv.includes('--cleanup-fixture-sessions')) {
    const tags = ['scratch/mutation-fanout-results.json', 'scratch/mutation-fanout-map-results.json'].map(path => {
      const result = JSON.parse(readFileSync(path, 'utf8'))
      assert.equal(result.origin, origin)
      const tag = result.results[0].measured[0].snapshot.buildingName
      assert.match(tag, /^fanout-demo-\d+$/)
      return tag
    })
    const ids = []
    for (const tag of tags) {
      const created = Number(tag.replace('fanout-demo-', ''))
      const candidates = unwrap(await writer.from('service_sessions').select('id')
        .eq('user_name', user.name).eq('source', 'assigned').eq('primary_card_id', 1).is('calendar_event_id', null)
        .gte('created_at', new Date(created).toISOString()).lt('created_at', new Date(created + 30000).toISOString()))
      assert.ok(candidates.length <= 1, 'Ambiguous fixture session; no cleanup performed')
      ids.push(...candidates.map(row => row.id))
    }
    if (ids.length) {
      const sessions = unwrap(await writer.from('service_sessions').select('id,user_name,source,calendar_event_id,status,created_at').in('id', ids))
      for (const session of sessions) {
        assert.equal(session.user_name, user.name); assert.equal(session.source, 'assigned'); assert.equal(session.calendar_event_id, null)
        assert.ok(tags.some(tag => { const age = Date.parse(session.created_at) - Number(tag.replace('fanout-demo-', '')); return age >= 0 && age < 30000 }), 'Session does not belong to this fixture creation window')
        if (session.status === 'active') {
          const ended = unwrap(await writer.from('service_sessions').update({ status: 'ended', ended_at: new Date().toISOString() }).eq('id', session.id).select('id'))
          assert.equal(ended.length, 1)
        }
      }
      assert.ok(unwrap(await writer.from('service_sessions').select('status').in('id', ids)).every(s => s.status !== 'active'))
    }
    console.log(JSON.stringify({ fixtureSessionsVerifiedNotActive: ids.length, scope: 'Only unlinked assigned sessions for the fixture account/card within its two creation windows' }))
    return
  }
  const tag = `fanout-demo-${Date.now()}`, today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' })
  const fixture = { tag, today, cardId: 1, volunteerName: user.name }
  const mapScope = process.argv.includes('--map-scope')
  const repetitions = process.argv.includes('--single-repeat') ? 1 : 3
  const dedup = process.argv.includes('--signal-dedup'), visitsOnly = process.argv.includes('--visits-only')
  const participantDedup = process.argv.includes('--participant-dedup'), applicationsOnly = process.argv.includes('--applications-only')
  const overlap = process.argv.includes('--overlap')
  const delays = process.argv.includes('--slow') ? [0, 750] : [0, 250]
  const outputPath = `scratch/mutation-fanout-${participantDedup ? 'participant-dedup-' : ''}${applicationsOnly ? 'applications-' : ''}${dedup ? 'dedup-' : ''}${visitsOnly ? 'visits-' : ''}${mapScope ? 'map-' : ''}results.json`
  const results = [], devices = []
  let commandId = 0
  const launch = (label, actor, delayMs) => new Promise((resolve, reject) => {
    const worker = new Worker(new URL(import.meta.url), { workerData: { label, actor, key, fixture, delayMs, mapScope, dedup, participantDedup } })
    const awaiting = new Map()
    const device = { worker, label, call(command, value) {
      return new Promise((resolve, reject) => {
        const id = ++commandId
        const timer = setTimeout(() => { awaiting.delete(id); reject(Error(`${label} ${command} timed out`)) }, 65000)
        awaiting.set(id, { resolve, reject, timer }); worker.postMessage({ id, command, value })
      })
    } }
    devices.push(device)
    worker.on('message', message => {
      if (message.ready) { console.log(JSON.stringify({ ready: label, role: message.role, delayMs })); resolve(device); return }
      if (message.fatal) { reject(Error(JSON.stringify(message.fatal))); return }
      const pending = awaiting.get(message.id)
      if (pending) { clearTimeout(pending.timer); awaiting.delete(message.id); message.error ? pending.reject(Error(JSON.stringify(message.error))) : pending.resolve(message.result) }
    })
    worker.on('error', reject)
  })
  try {
    unwrap(await writer.from('cards').select('id').eq('id', fixture.cardId).single())
    fixture.building = unwrap(await writer.from('buildings').insert({ card_id: fixture.cardId, name: tag, address: 'Demo measurement only', type: '주택', lat: 37.2, lng: 127.1 }).select('id,address').single())
    fixture.unit = unwrap(await writer.from('units').insert({ building_id: fixture.building.id, number: '9999', status: '미방문', is_chinese: true, memo: tag }).select('id').single())
    const eventBase = { event_date: today, time: '10:00', type: '주택', place: 'Demo measurement only', leader_name: admin.name, card_name: '', has_meeting: false, allow_applications: true }
    fixture.assigned = unwrap(await writer.from('calendar_events').insert({ ...eventBase, title: tag + '-assigned' }).select('id').single())
    fixture.application = unwrap(await writer.from('calendar_events').insert({ ...eventBase, title: tag + '-application' }).select('id').single())
    unwrap(await writer.from('event_participants').insert({ event_id: fixture.assigned.id, user_name: user.name, role: '입명' }))
    const assigned = unwrap(await writer.rpc('assign_cards_bulk_tx', { p_token: admin.token, p_event_id: fixture.assigned.id,
      p_assignments: [{ userName: user.name, cardIds: [fixture.cardId], teamKey: null }], p_status: 'confirmed', p_expected_shared_at: null }))
    assert.equal(assigned?.ok, true)
    writeFileSync('scratch/mutation-fanout-fixture.json', JSON.stringify({ origin, ...fixture }, null, 2))
    for (const delayMs of delays) {
      const userA = await launch('volunteer-writer', user, delayMs)
      const userB = await launch('volunteer-observer', user, delayMs)
      const adminA = await launch('administrator', admin, delayMs)
      const group = [userA, userB, adminA]
      for (let repetition = 1; repetition <= repetitions; repetition++) {
        const actions = applicationsOnly ? ['join', 'cancel-application', 'external-join', 'external-cancel-application']
          : visitsOnly ? ['save', 'cancel-visit', 'external-save', 'external-cancel'] : ['save', 'cancel-visit', 'join', 'cancel-application', 'edit', 'restore']
        if (overlap) actions.push(...(applicationsOnly ? ['overlap-join', 'overlap-cancel-application'] : ['overlap-save', 'overlap-cancel']))
        for (const action of actions) {
          const phase = `${delayMs}-${repetition}-${action}`
          for (const device of group) await device.call('phase', phase)
          const actor = action === 'edit' || action === 'restore' || action.startsWith('external-') ? adminA : userA
          if (applicationsOnly && action.startsWith('overlap-')) {
            await userA.call('hold-next-participants')
            const mutation = userA.call('action', action === 'overlap-join' ? 'join' : 'cancel-application')
            const deadline = Date.now() + 20000
            while (!await userA.call('participants-held')) { assert.ok(Date.now() < deadline, 'No held participant response'); await sleep(50) }
            await adminA.call('action', action === 'overlap-join' ? 'join' : 'cancel-application')
            await userA.call('release-participants')
            await mutation
          } else if (action.startsWith('overlap-')) {
            await userA.call('hold-next-units')
            const mutation = userA.call('action', action === 'overlap-save' ? 'save' : 'cancel-visit')
            const deadline = Date.now() + 20000
            while (!await userA.call('units-held')) { assert.ok(Date.now() < deadline, 'No held unit response'); await sleep(50) }
            await adminA.call('action', action === 'overlap-save' ? 'edit' : 'restore')
            await userA.call('release-units')
            await mutation
          } else await actor.call('action', action === 'external-save' ? 'save' : action === 'external-cancel' ? 'cancel-visit'
            : action === 'external-join' ? 'join' : action === 'external-cancel-application' ? 'cancel-application' : action)
          // Calendar debounce is two seconds; do not count only the first response.
          await sleep(3600)
          const measured = []
          for (const device of group) {
            const value = await device.call('collect')
            assert.equal(value.snapshot.loading, false); assert.equal(value.snapshot.error, null)
            const saved = action === 'save' || action === 'external-save' || action === 'overlap-save'
            assert.equal(value.snapshot.recordIds.length, saved ? 1 : 0)
            assert.equal(value.snapshot.status, saved ? '부재' : '미방문')
            assert.equal(value.snapshot.applicant, action === 'join' || action === 'overlap-join')
            if (applicationsOnly) {
              const expected = action === 'join' ? [user.name] : action === 'external-join' ? [admin.name]
                : action === 'overlap-join' ? [user.name, admin.name].sort() : []
              assert.deepEqual(value.snapshot.applicants, expected)
            }
            assert.equal(value.snapshot.buildingName, tag + (action === 'edit' || action === 'overlap-save' ? '-edited' : ''))
            assert.ok(value.samples.every(s => s.status < 400), JSON.stringify(value.samples.filter(s => s.status >= 400)))
            const reads = value.samples.filter(s => s.read)
            const byEndpoint = Object.fromEntries([...new Set(reads.map(s => s.endpoint))].map(endpoint => [endpoint, reads.filter(s => s.endpoint === endpoint).length]))
            measured.push({ device: device.label, actor: device === actor, ...value, summary: {
              reads: reads.length, writes: value.samples.length - reads.length,
              decodedReadBytes: reads.reduce((n, s) => n + s.decodedBytes, 0), byEndpoint } })
          }
          results.push({ delayMs, repetition, action, measured })
          console.log(JSON.stringify({ delayMs, repetition, action, devices: measured.map(m => ({ device: m.device, ...m.summary })) }))
          writeFileSync(outputPath, JSON.stringify({ origin, mapScope, dedup, participantDedup, applicationsOnly, source: 'local hooks + live demo DB', results }, null, 2))
        }
      }
      for (const device of group) { await device.call('close'); await device.worker.terminate(); devices.splice(devices.indexOf(device), 1) }
    }
  } finally {
    for (const device of devices) await device.worker.terminate()
    // Only IDs created above, guarded by their unique fixture marker.
    if (fixture.unit) {
      const active = unwrap(await writer.from('visit_histories').select('id,memo').eq('unit_id', fixture.unit.id).is('invalidated_at', null))
      for (const h of active) { assert.equal(h.memo, tag); unwrap(await writer.rpc('invalidate_visit_history_tx', { p_token: admin.token, p_history_id: h.id, p_reason: 'Demo fanout cleanup' })) }
    }
    for (const [name, event] of [['assigned', fixture.assigned], ['application', fixture.application]]) {
      if (event) {
        unwrap(await writer.from('service_sessions').update({ status: 'ended', ended_at: new Date().toISOString() }).eq('calendar_event_id', event.id).eq('status', 'active'))
        unwrap(await writer.from('calendar_events').delete().eq('id', event.id).eq('title', `${tag}-${name}`))
        assert.equal(unwrap(await writer.from('calendar_events').select('id').eq('id', event.id)).length, 0)
      }
    }
    // Assignment creation can leave an auto-started session unlinked after event deletion.
    const started = Number(tag.replace('fanout-demo-', ''))
    const fixtureSessions = unwrap(await writer.from('service_sessions').select('id,user_name,source,created_at')
      .eq('user_name', user.name).eq('source', 'assigned').eq('primary_card_id', fixture.cardId).is('calendar_event_id', null)
      .eq('status', 'active').gte('created_at', new Date(started).toISOString()).lt('created_at', new Date(started + 30000).toISOString()))
    assert.ok(fixtureSessions.length <= 1, 'Ambiguous fixture session')
    for (const session of fixtureSessions) unwrap(await writer.from('service_sessions').update({ status: 'ended', ended_at: new Date().toISOString() }).eq('id', session.id))
    if (fixture.building) {
      const building = unwrap(await writer.from('buildings').select('name').eq('id', fixture.building.id).single())
      assert.ok([tag, tag + '-edited'].includes(building.name))
      let result = unwrap(await writer.rpc('delete_place_or_request_tx', { p_token: admin.token, p_target_type: 'building', p_target_id: fixture.building.id, p_note: tag }))
      if (result.action === 'requested') result = unwrap(await writer.rpc('execute_place_deletion_request_tx', { p_token: admin.token, p_request_id: result.request_id }))
      assert.equal(result.action, 'deleted')
      assert.equal(unwrap(await writer.from('buildings').select('id').eq('id', fixture.building.id)).length, 0)
    }
    await bootstrap.removeAllChannels(); await writer.removeAllChannels()
    if (results.length) writeFileSync(outputPath, JSON.stringify({ origin, mapScope, dedup, participantDedup, applicationsOnly, source: 'local hooks + live demo DB', fixtureCleanup: 'passed', results }, null, 2))
    console.log(JSON.stringify({ fixtureCleanup: 'passed', scenarios: results.length }))
  }
}

if (isMainThread) main().then(() => process.exit(0)).catch(error => { console.error(JSON.stringify(safeError(error))); process.exit(1) })
else workerMain().catch(error => { parentPort.postMessage({ fatal: safeError(error) }); parentPort.close() })
