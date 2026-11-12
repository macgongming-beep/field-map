import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { parseEnv } from 'node:util'
import { gzipSync } from 'node:zlib'
import { createClient } from '@supabase/supabase-js'

assert.ok(process.env.DEMO_ENV_FILE && process.argv.includes('--confirm-demo'))
const config = parseEnv(readFileSync(process.env.DEMO_ENV_FILE, 'utf8'))
const login = process.env.DEMO_LOGIN_FILE ? JSON.parse(readFileSync(process.env.DEMO_LOGIN_FILE, 'utf8'))
  : { loginId: config.TEST_LOGIN_ID, pin: config.TEST_LOGIN_PIN }
const origin = 'https://itjlykpjmlcvanqpmkmc.supabase.co'
assert.equal(config.VITE_SUPABASE_URL, origin)
const options = { auth: { persistSession: false, autoRefreshToken: false } }
const unwrap = ({ data, error }) => { assert.equal(error, null, JSON.stringify(error)); return data }
const actor = unwrap(await createClient(origin, config.VITE_SUPABASE_ANON_KEY, options).rpc('auth_login', {
  p_login_id: login.loginId, p_pin: login.pin,
}))[0]
assert.ok(actor.token && ['admin', 'leader'].includes(actor.role))
const db = createClient(origin, config.VITE_SUPABASE_ANON_KEY, { ...options, global: { headers: { 'x-session-token': actor.token } } })
const source = readFileSync('src/hooks/scopedVisitHistory.ts', 'utf8')
const fullColumns = source.match(/VISIT_HISTORY_COLUMNS\s*=\s*'([^']+)'/)[1]
const summaryColumns = readFileSync('src/hooks/privilegedHistoryScope.ts', 'utf8').match(/VISIT_RECENCY_COLUMNS\s*=\s*'([^']+)'/)[1]
const cutoff = new Date(Date.now() - 365 * 86400000).toISOString()
async function read(columns) {
  const rows = []; let pages = 0
  for (let from = 0; ; from += 1000) {
    const page = unwrap(await db.from('visit_histories').select(columns).is('invalidated_at', null)
      .gte('created_at', cutoff).order('created_at', { ascending: false }).range(from, from + 999))
    rows.push(...page); ++pages
    if (page.length < 1000) break
  }
  const json = JSON.stringify(rows)
  return { rows, pages, jsonBytes: Buffer.byteLength(json), localGzipBytes: gzipSync(json).length }
}
const full = await read(fullColumns), summary = await read(summaryColumns)
assert.deepEqual(summary.rows.map(r => r.id), full.rows.map(r => r.id))
assert.deepEqual(summary.rows, full.rows.map(({ id, unit_id, visited_at, created_at }) => ({ id, unit_id, visited_at, created_at })))
const report = {
  at: new Date().toISOString(), origin, role: actor.role, cutoff,
  full: { rows: full.rows.length, pages: full.pages, jsonBytes: full.jsonBytes, localGzipBytes: full.localGzipBytes },
  summary: { rows: summary.rows.length, pages: summary.pages, jsonBytes: summary.jsonBytes, localGzipBytes: summary.localGzipBytes },
  identicalIdsAndDates: true,
  note: 'Local gzip excludes HTTP headers; demo dataset only, not production or monthly savings.',
}
writeFileSync('scratch/privileged-history-demo-measurement.json', JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
