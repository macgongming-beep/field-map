import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseEnv } from 'node:util'
import { createClient } from '@supabase/supabase-js'

// Explicitly opted-in demo-only API smoke; never changes pre-existing sessions.
if (!process.argv.includes('--confirm-demo-write') || !process.env.DEMO_ENV_FILE || !process.env.DEMO_LOGIN_FILE) {
  throw new Error('Demo write confirmation and local configuration files required')
}
const config = parseEnv(readFileSync(process.env.DEMO_ENV_FILE, 'utf8'))
const credentials = parseEnv(readFileSync(process.env.DEMO_LOGIN_FILE, 'utf8'))
const origin = 'https://itjlykpjmlcvanqpmkmc.supabase.co'
if (config.VITE_SUPABASE_URL !== origin) throw new Error('Demo project mismatch')
const options = { auth: { persistSession: false, autoRefreshToken: false } }
const unwrap = response => { if (response.error) throw response.error; return response.data }
const loginClient = createClient(origin, config.VITE_SUPABASE_ANON_KEY, options)
const data = unwrap(await loginClient.rpc('auth_login', { p_login_id: credentials.TEST_LOGIN_ID, p_pin: credentials.TEST_LOGIN_PIN }))
const user = Array.isArray(data) ? data[0] : data
if (!user?.token || user.role !== 'user') throw new Error('Expected a demo volunteer session')
const db = createClient(origin, config.VITE_SUPABASE_ANON_KEY, { ...options, global: { headers: { 'x-session-token': user.token } } })
const date = value => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
const now = new Date()
const cutoff = new Date(now)
cutoff.setDate(cutoff.getDate() - 8)
const columns = 'id, user_name, role, calendar_event_id, started_at, ended_at, service_date, time_slot, status, primary_card_id, assigned_card_id, assignment_id, source, memo, created_at'
async function read(scoped) {
  const rows = []
  for (let from = 0; ; from += 1000) {
    let q = db.from('service_sessions').select(columns).order('started_at', { ascending: false }).order('id')
    if (scoped) q = q.eq('user_name', user.name).gte('service_date', date(cutoff))
    const page = unwrap(await q.range(from, from + 999))
    rows.push(...page)
    if (page.length < 1000) return rows
  }
}
const before = await read(false)
const recent = await read(true)
assert.deepEqual(recent, before.filter(row => row.user_name === user.name && row.service_date >= date(cutoff)))
console.log(JSON.stringify({ phase: 'baseline', fullRows: before.length, ownHistoryRows: before.filter(row => row.user_name === user.name).length, recentRows: recent.length, since: date(cutoff) }))
const memo = `recent-sessions-smoke-${Date.now()}`
let id
try {
  const row = unwrap(await db.from('service_sessions').insert({ user_name: user.name, role: 'user', service_date: date(now), time_slot: '오전', status: 'active', source: 'manual', memo }).select('id').single())
  id = row.id
  const started = (await read(true)).find(session => session.id === id)
  assert.equal(started?.status, 'active')
  assert.equal(started?.ended_at, null)
  const endedAt = new Date().toISOString()
  unwrap(await db.from('service_sessions').update({ status: 'ended', ended_at: endedAt }).eq('id', id).eq('memo', memo).select('id').single())
  const ended = (await read(true)).find(session => session.id === id)
  assert.equal(ended?.status, 'ended')
  assert.equal(Date.parse(ended.ended_at), Date.parse(endedAt))
  assert.equal(ended.started_at, started.started_at)
  console.log(JSON.stringify({ phase: 'start-end-readback', sessionId: id, startedVisible: true, endedVisible: true, timestampsPreserved: true }))
} finally {
  if (id) unwrap(await db.from('service_sessions').delete().eq('id', id).eq('memo', memo).select('id').single())
  const after = await read(false)
  assert.deepEqual(after, before)
  console.log(JSON.stringify({ phase: 'cleaned', fullRows: after.length, originalSessionsUnchanged: true }))
}
