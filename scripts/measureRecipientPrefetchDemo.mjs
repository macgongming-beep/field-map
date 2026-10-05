import { readFileSync } from 'node:fs'
import { parseEnv } from 'node:util'
import https from 'node:https'
import { gunzipSync, brotliDecompressSync, inflateSync } from 'node:zlib'
import { performance } from 'node:perf_hooks'
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
if (!selectedIds && !process.argv.includes('--inspect')) throw new Error('Provide --card-ids=1,2 or --inspect')

let phase = 'setup'
const samples = []
const agent = new https.Agent({ keepAlive: true })
async function measuredFetch(input, init = {}) {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
  if (url.origin !== origin) throw new Error('Cross-project request rejected')
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

  if (process.argv.includes('--inspect')) {
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
} finally { agent.destroy() }
