import { readFileSync } from 'node:fs'
import { parseEnv } from 'node:util'
import https from 'node:https'
import { gunzipSync, brotliDecompressSync, inflateSync } from 'node:zlib'
import { performance } from 'node:perf_hooks'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { rolldown } from 'rolldown'
import { deepStrictEqual } from 'node:assert'
import ts from 'typescript'
import { createClient } from '@supabase/supabase-js'

// This script executes the application reader, not a second implementation of its queries.
const source = readFileSync(new URL('../src/lib/recipientCardPrefetch.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
const { createRecipientCardPrefetch, RECIPIENT_BUILDING_COLUMNS, RECIPIENT_UNIT_COLUMNS, RECIPIENT_HISTORY_COLUMNS } =
  await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)

const file = process.env.DEMO_ENV_FILE
if (!file || !process.argv.includes('--confirm-demo')) throw new Error('Requires DEMO_ENV_FILE and --confirm-demo')
const config = parseEnv(readFileSync(file, 'utf8'))
const origin = 'https://itjlykpjmlcvanqpmkmc.supabase.co'
if (config.VITE_SUPABASE_URL !== origin) throw new Error('Demo allowlist mismatch')
const idsArgument = process.argv.find((value) => value.startsWith('--card-ids='))
const selectedIds = idsArgument?.slice('--card-ids='.length).split(',').filter(Boolean).map(Number)
const baseline = process.argv.find((value) => value.startsWith('--baseline='))?.slice('--baseline='.length) ?? '073b6a1'
if (!/^[a-f0-9]{7,40}$/.test(baseline)) throw new Error('Baseline must be a commit hash')
if (!selectedIds && !process.argv.includes('--inspect') && !process.argv.includes('--store-scope') && !process.argv.includes('--store-lifecycle')) throw new Error('Provide --card-ids=1,2, --store-scope, --store-lifecycle or --inspect')

let phase = 'setup'
const samples = []
const agent = new https.Agent({ keepAlive: true })
let cleanupFixture
async function measuredFetch(input, init = {}) {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
  if (url.origin !== origin) throw new Error('Cross-project request rejected')
  if (process.argv.includes('--store-lifecycle') && (init.method || 'GET') !== 'GET') {
    // Lifecycle measurement must not close sessions or create missing fixture cards.
    if (url.pathname === '/rest/v1/rpc/auto_close_stale_sessions') return new Response('null', { status: 200 })
    const allowed = ['auth_login', 'territory_sync_clock', 'get_card_summaries', 'get_recipient_return_visit_card_ids']
    if (!allowed.some((name) => url.pathname === `/rest/v1/rpc/${name}`)) throw new Error('Lifecycle measurement rejected a data write')
  }
  const headers = new Headers(init.headers)
  headers.set('accept-encoding', 'gzip')
  const started = performance.now()
  const label = phase
  return new Promise((resolve, reject) => {
    const request = https.request(url, { agent, method: init.method || 'GET', headers: Object.fromEntries(headers), timeout: 30000 }, (response) => {
      const chunks = []
      response.on('data', (chunk) => chunks.push(chunk))
      response.on('error', reject)
      response.on('end', () => {
        try {
          const compressed = Buffer.concat(chunks)
          const encoding = response.headers['content-encoding'] || 'identity'
          const body = encoding === 'gzip' ? gunzipSync(compressed)
            : encoding === 'br' ? brotliDecompressSync(compressed)
              : encoding === 'deflate' ? inflateSync(compressed) : compressed
          samples.push({ phase: label, endpoint: url.pathname.split('/').pop(), status: response.statusCode,
            initialLookup: url.pathname === '/rest/v1/cards' && url.searchParams.get('name') === 'eq.미배정 건물' && url.searchParams.get('limit') === '1',
            encoding, compressedBodyBytes: compressed.length, decodedBodyBytes: body.length, durationMs: Math.round(performance.now() - started) })
          const resultHeaders = new Headers()
          for (const [key, value] of Object.entries(response.headers)) {
            if (value != null && !['content-encoding', 'content-length', 'transfer-encoding'].includes(key)) resultHeaders.set(key, String(value))
          }
          resolve(new Response(body, { status: response.statusCode, headers: resultHeaders }))
        } catch (error) { reject(error) }
      })
    })
    request.on('error', reject)
    request.on('timeout', () => request.destroy(new Error('Demo request timed out')))
    if (init.body) request.write(init.body)
    request.end()
  })
}

const commonOptions = { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: measuredFetch } }
const loginClient = createClient(origin, config.VITE_SUPABASE_ANON_KEY, commonOptions)
async function readPin() {
  if (!process.stdin.isTTY) throw new Error('--prompt-pin requires a terminal')
  process.stdout.write('Demo PIN (hidden): ')
  process.stdin.setRawMode(true)
  process.stdin.resume()
  return new Promise((resolve, reject) => {
    let pin = ''
    const listener = (chunk) => {
      for (const char of chunk.toString()) {
        if (char === '\r' || char === '\n' || char === '\u0003') {
          process.stdin.off('data', listener)
          process.stdin.setRawMode(false)
          process.stdin.pause()
          process.stdout.write('\n')
          if (char === '\u0003') reject(new Error('Cancelled'))
          else resolve(pin)
          return
        }
        if (char === '\u007f') pin = pin.slice(0, -1)
        else pin += char
      }
    }
    process.stdin.on('data', listener)
  })
}
try {
  const loginId = process.argv.find((value) => value.startsWith('--login-id='))?.slice('--login-id='.length) ?? config.TEST_LOGIN_ID
  const pin = process.argv.includes('--prompt-pin') ? await readPin() : config.TEST_LOGIN_PIN
  const login = await loginClient.rpc('auth_login', { p_login_id: loginId, p_pin: pin })
  if (login.error) throw new Error(`Demo login failed: ${login.error.code}`)
  const user = Array.isArray(login.data) ? login.data[0] : login.data
  if (!user?.token) throw new Error('Demo login did not return a session')
  const client = createClient(origin, config.VITE_SUPABASE_ANON_KEY, {
    ...commonOptions, global: { fetch: measuredFetch, headers: { 'x-session-token': user.token } },
  })
  async function pages(query) {
    const rows = []
    for (let from = 0; ; from += 1000) {
      const result = await query(from, from + 999)
      if (result.error) throw new Error(`Demo query failed: ${result.error.code}`)
      rows.push(...result.data)
      if (result.data.length < 1000) return rows
    }
  }

  if (process.argv.includes('--store-lifecycle')) {
    const { measureStoreLifecycle } = await import('./recipientStoreLifecycle.mjs')
    try {
      await measureStoreLifecycle({ client, user, samples, setPhase: (next) => { phase = next }, boundaryCache: process.argv.includes('--boundary-cache'), project: origin })
    } catch (error) {
      // Bundled data-URL stack traces are huge; never dump data-bearing assertion objects.
      console.error(`Lifecycle measurement failed: ${String(error.message).split('\n')[0].slice(0, 250)}`)
      process.exitCode = 1
    }
  } else if (process.argv.includes('--store-scope')) {
    if (process.argv.includes('--fixture-return-visit')) {
      const target = await client.from('buildings').select('address').neq('card_id', 1).order('id').limit(1).single()
      if (target.error) throw target.error
      const made = await client.rpc('create_return_visit_tx', { p_token: user.token,
        p_display_name: `scope-measurement-${Date.now()}`, p_address: target.data.address, p_unit_id: null })
      if (made.error || !made.data?.created) throw made.error ?? new Error('Fixture was not created')
      cleanupFixture = async () => {
        phase = 'fixture-cleanup'
        const ended = await client.rpc('end_return_visit_tx', { p_token: user.token,
          p_return_visit_id: made.data.id, p_reason: 'no_longer_assigned' })
        if (ended.error || !ended.data?.ok) throw ended.error ?? new Error('Fixture cleanup failed')
        console.log('Measurement-only return visit ended.')
      }
    }
    // Bundle the real reader twice, replacing only its client/session dependencies.
    globalThis.__recipientMeasurement = { client, token: user.token }
    async function readerAt(old) {
      const entry = resolve('src/lib/recipientStore.ts')
      const bundle = await rolldown({ input: entry, plugins: [{
        name: 'measurement-session',
        resolveId(id) {
          if (id === './supabase' || id === './authToken') return '\0measurement:' + id
        },
        load(id) {
          if (id === '\0measurement:./supabase') return 'export const supabase = globalThis.__recipientMeasurement.client'
          if (id === '\0measurement:./authToken') return 'export const getAuthToken = () => globalThis.__recipientMeasurement.token'
          if (old && id.startsWith(resolve('src') + '/')) return { code: execFileSync('git', ['show', `${baseline}:${id.slice(process.cwd().length + 1)}`], { encoding: 'utf8' }), moduleType: 'ts' }
        },
      }] })
      try {
        const { output } = await bundle.generate({ format: 'esm' })
        const module = await import(`data:text/javascript;base64,${Buffer.from(output[0].code).toString('base64')}`)
        return module.createRecipientStoreReader(user.name)
      } finally { await bundle.close() }
    }
    phase = 'common-card-metadata'
    const metadata = await pages((from, to) => client.from('cards').select('id').order('id').range(from, to))
    const results = []
    let baselineDetails
    for (const old of [true, false]) {
      const reader = await readerAt(old)
      phase = old ? `before-${baseline}` : 'after-return-visit-scope'
      const started = performance.now()
      try {
        let details = await reader.read()
        const fallback = details == null
        if (fallback) {
          const [buildings, boundaries] = await Promise.all([
            pages((from, to) => client.from('buildings').select(`${RECIPIENT_BUILDING_COLUMNS}, units(${RECIPIENT_UNIT_COLUMNS})`).order('id').range(from, to)),
            pages((from, to) => client.from('card_boundaries').select('card_id,points,updated_at').order('card_id').range(from, to)),
          ])
          details = { buildings, boundaries }
        } else {
          // useStore additionally requests summaries for all cards, not just loaded cards.
          for (let i = 0; i < metadata.length; i += 200) {
            const result = await client.rpc('get_card_summaries', { p_token: user.token, p_card_ids: metadata.slice(i, i + 200).map((c) => c.id) })
            if (result.error) throw result.error
          }
        }
        if (old) baselineDetails = details
        else {
          const stable = (rows, key) => [...rows].sort((a, b) => a[key] - b[key])
          const buildings = (rows) => stable(rows.map((b) => ({ ...b, units: stable(b.units, 'id') })), 'id')
          deepStrictEqual(buildings(details.buildings), buildings(baselineDetails.buildings.filter((b) => reader.allowsCard(b.card_id))))
          deepStrictEqual(stable(details.boundaries, 'card_id'), stable(baselineDetails.boundaries.filter((b) => reader.allowsCard(b.card_id)), 'card_id'))
        }
        const requests = samples.filter((s) => s.phase === phase)
        results.push({ phase, fallback, buildings: details.buildings.length, boundaries: details.boundaries.length,
          requests: requests.length, compressedBodyBytes: requests.reduce((n, s) => n + s.compressedBodyBytes, 0),
          readyMs: Math.round(performance.now() - started) })
      } finally { reader.dispose() }
    }
    console.log(JSON.stringify({ project: 'demo', accountRole: user.role, measuredAt: new Date().toISOString(), results, parity: 'all fields of scoped buildings, units and boundaries match baseline',
      samples: samples.filter((s) => s.phase.startsWith('before-') || s.phase.startsWith('after-')),
      limitations: ['Actual reader requests including scope detection and summary overhead; unchanged global histories/sessions and other app slices excluded.',
        'Compressed HTTP body bytes, not billing egress or browser rendering speed. Small demo data is not a monthly production forecast.'],
    }, null, 2))
    delete globalThis.__recipientMeasurement
  } else if (process.argv.includes('--inspect')) {
    const cards = await pages((from, to) => client.from('cards').select('id,name').order('id').range(from, to))
    console.log(JSON.stringify({ accountRole: user.role, cards }, null, 2))
  } else {
    const cutoff = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString()
    phase = 'common-card-metadata'
    const metadata = await pages((from, to) => client.from('cards')
      .select('*, card_assignments(user_name), card_leader_assignments(user_name, created_at)').order('id').range(from, to))
    if (selectedIds.some((id) => !metadata.some((card) => card.id === id))) throw new Error('Unknown demo card ID')
    phase = 'existing-whole-territory'
    const fullStart = performance.now()
    const [wholeBuildings, wholeBoundaries, wholeHistories] = await Promise.all([
      pages((from, to) => client.from('buildings').select(`${RECIPIENT_BUILDING_COLUMNS}, units(${RECIPIENT_UNIT_COLUMNS})`).order('id').range(from, to)),
      pages((from, to) => client.from('card_boundaries').select('card_id,points,updated_at').order('card_id').range(from, to)),
      pages((from, to) => client.from('visit_histories').select(RECIPIENT_HISTORY_COLUMNS)
        .is('invalidated_at', null).gte('created_at', cutoff).order('created_at', { ascending: false }).range(from, to)),
    ])
    const fullReadyMs = Math.round(performance.now() - fullStart)
    phase = 'recipient-prefetch'
    const scopedStart = performance.now()
    const reader = createRecipientCardPrefetch(client, { token: user.token, isCurrent: () => true })
    const load = reader.prefetch(selectedIds)
    const summaries = await load.summaries
    const summaryReadyMs = Math.round(performance.now() - scopedStart)
    const details = await load.details
    const detailsReadyMs = Math.round(performance.now() - scopedStart)
    const expectedBuildings = wholeBuildings.filter((building) => selectedIds.includes(building.card_id))
    const expectedUnitIds = new Set(expectedBuildings.flatMap((building) => building.units.map((unit) => unit.id)))
    const sameIds = (a, b) => JSON.stringify(a.map((row) => row.id).sort((x, y) => x - y)) === JSON.stringify(b.map((row) => row.id).sort((x, y) => x - y))
    if (!sameIds(expectedBuildings, details.buildings)
      || !sameIds(expectedBuildings.flatMap((b) => b.units), details.buildings.flatMap((b) => b.units))
      || !sameIds(wholeHistories.filter((history) => expectedUnitIds.has(history.unit_id)), details.histories)
      || JSON.stringify(wholeBoundaries.filter((b) => selectedIds.includes(b.card_id))) !== JSON.stringify(details.boundaries)) {
      throw new Error('Scoped detail parity check failed (or data changed during measurement)')
    }
    for (const summary of summaries) {
      const buildings = expectedBuildings.filter((building) => building.card_id === summary.id)
      const units = buildings.flatMap((building) => building.units).filter((unit) => unit.number.trim() !== '출입불가')
      const completed = units.filter((unit) => unit.status !== '미방문' && unit.status !== '부재').length
      const regularVisits = units.filter((unit) => unit.regular_visits
        && (Array.isArray(unit.regular_visits) ? unit.regular_visits.length > 0 : true)).length
      if (summary.buildings !== buildings.length || summary.units !== units.length || summary.completed !== completed
        || summary.regularVisits !== regularVisits || summary.progress !== (units.length ? Math.round(completed / units.length * 100) : 100)) {
        throw new Error(`Summary parity check failed: ${JSON.stringify({
          actual: { buildings: summary.buildings, units: summary.units, completed: summary.completed, regularVisits: summary.regularVisits, progress: summary.progress },
          expected: { buildings: buildings.length, units: units.length, completed, regularVisits, progress: units.length ? Math.round(completed / units.length * 100) : 100 },
        })}`)
      }
    }
    phase = 'map-after-prefetch'
    const mapStart = performance.now()
    await reader.prefetch(selectedIds).details
    if (selectedIds.length) await reader.prefetch([selectedIds[0]]).details
    const cachedMapReadyMs = Math.round(performance.now() - mapStart)
    const aggregate = (label) => {
      const requests = samples.filter((sample) => sample.phase === label)
      return { requests: requests.length, compressedBodyBytes: requests.reduce((sum, sample) => sum + sample.compressedBodyBytes, 0) }
    }
    console.log(JSON.stringify({
      measuredAt: new Date().toISOString(), project: 'demo', accountRole: user.role,
      scope: { selectedCards: selectedIds.length, totalCards: metadata.length, selectedBuildings: details.buildings.length,
        totalBuildings: wholeBuildings.length, selectedUnits: details.buildings.reduce((n, b) => n + b.units.length, 0) },
      parity: 'passed: summary counts, building/unit/history IDs, boundary coordinates',
      phases: Object.fromEntries(['common-card-metadata', 'existing-whole-territory', 'recipient-prefetch', 'map-after-prefetch'].map((label) => [label, aggregate(label)])),
      timings: { fullReadyMs, summaryReadyMs, detailsReadyMs, cachedMapReadyMs },
      samples: samples.filter((sample) => sample.phase !== 'setup'),
      limitations: [
        'Compressed HTTP response bodies, not browser Transferred, invoice egress, or page rendering timings.',
        'Authenticated demo account; manually selected card scope, not an end-to-end assignment UI test.',
        'Common cards measured once; all other app slices, navigation, realtime and push are outside this comparison.',
        'Sequential scenarios may have different network/server warmth; timing is illustrative only.',
        'Existing application loading has not been switched to this reader.',
      ],
    }, null, 2))
  }
} finally {
  try { await cleanupFixture?.() } finally { agent.destroy() }
}
