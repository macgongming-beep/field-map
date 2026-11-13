import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { parseEnv } from 'node:util'
import { gzipSync } from 'node:zlib'
import { createClient } from '@supabase/supabase-js'

assert.ok(process.argv.includes('--confirm-demo'))
const config = parseEnv(readFileSync(process.env.DEMO_ENV_FILE, 'utf8'))
const origin = 'https://itjlykpjmlcvanqpmkmc.supabase.co'
assert.equal(config.VITE_SUPABASE_URL, origin)
const unwrap = ({ data, error }) => { assert.equal(error, null, JSON.stringify(error)); return data }
const options = { auth: { persistSession: false, autoRefreshToken: false } }
const actor = unwrap(await createClient(origin, config.VITE_SUPABASE_ANON_KEY, options).rpc('auth_login', {
  p_login_id: config.TEST_LOGIN_ID, p_pin: config.TEST_LOGIN_PIN,
}))[0]
assert.ok(actor.token && ['admin', 'developer'].includes(actor.role))
const db = createClient(origin, config.VITE_SUPABASE_ANON_KEY, { ...options,
  global: { headers: { 'x-session-token': actor.token } } })
const mapColumns = readFileSync('src/hooks/buildingDemand.ts', 'utf8').match(/MAP_BUILDING_COLUMNS = '([^']+)'/)[1]
const fullColumns = readFileSync('src/hooks/useStore.ts', 'utf8').match(/MAP_BUILDING_COLUMNS : '([^']+)'/)[1]
async function read(columns) {
  const rows = []
  let pages = 0
  for (let from = 0; ; from += 1000) {
    const page = unwrap(await db.from('buildings').select(columns).order('id').range(from, from + 999))
    rows.push(...page); ++pages
    if (page.length < 1000) break
  }
  return { rows, pages }
}
const full = await read(fullColumns), map = await read(mapColumns)
const shape = rows => rows.map(b => ({ id: b.id, card: b.card_id, lat: b.lat, lng: b.lng,
  units: b.units.map(u => ({ id: u.id, status: u.status })).sort((a, b) => a.id - b.id) }))
assert.deepEqual(shape(full.rows), shape(map.rows))
const cardIds = unwrap(await db.from('cards').select('id').order('id')).map(c => c.id)
const summaries = []
let summaryRequests = 0
for (let i = 0; i < cardIds.length; i += 200) {
  summaries.push(...unwrap(await db.rpc('get_card_summaries', { p_token: actor.token, p_card_ids: cardIds.slice(i, i + 200) })))
  ++summaryRequests
}
assert.equal(summaries.length, cardIds.length)
const sizes = value => ({ jsonBytes: Buffer.byteLength(JSON.stringify(value)), localGzipBytes: gzipSync(JSON.stringify(value)).length })
const report = { at: new Date().toISOString(), origin,
  full: { rows: full.rows.length, requests: full.pages, ...sizes(full.rows) },
  map: { rows: map.rows.length, requests: map.pages, ...sizes(map.rows) },
  home: { buildingRequests: 0, summaryRequests, cards: summaries.length, ...sizes(summaries) },
  identicalPinsAndStatuses: true,
  note: 'Read-only demo payload comparison; local gzip excludes headers. Not browser request counts or production savings.' }
writeFileSync('scratch/building-demand-demo-measurement.json', JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
