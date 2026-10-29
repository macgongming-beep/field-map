import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs'
import { parseEnv } from 'node:util'
import { createClient } from '@supabase/supabase-js'

const mode = process.argv[2]
if (!['setup', 'check', 'cleanup'].includes(mode) || !process.env.DEMO_ENV_FILE) throw new Error('Explicit demo environment and mode required')
const config = parseEnv(readFileSync(process.env.DEMO_ENV_FILE, 'utf8'))
for (const key of ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY', 'TEST_LOGIN_ID', 'TEST_LOGIN_PIN']) {
  if (process.env[key]) config[key] = process.env[key]
}
const origin = 'https://itjlykpjmlcvanqpmkmc.supabase.co'
if (config.VITE_SUPABASE_URL !== origin) throw new Error('Demo project mismatch')
if (!config.VITE_SUPABASE_ANON_KEY || !config.TEST_LOGIN_ID || !config.TEST_LOGIN_PIN) {
  throw new Error('Explicit demo key and test account required')
}
const statePath = '/tmp/field-map-scoped-history-demo.json'
const options = { auth: { persistSession: false, autoRefreshToken: false } }
const unwrap = ({ data, error }) => { if (error) throw error; return data }
const login = unwrap(await createClient(origin, config.VITE_SUPABASE_ANON_KEY, options).rpc('auth_login', {
  p_login_id: config.TEST_LOGIN_ID, p_pin: config.TEST_LOGIN_PIN,
}))
const actor = Array.isArray(login) ? login[0] : login
if (!actor?.token) throw new Error('Demo login failed')
const db = createClient(origin, config.VITE_SUPABASE_ANON_KEY, { ...options, global: { headers: { 'x-session-token': actor.token } } })
const username = '데모 봉사자'
if (mode === 'setup') {
  if (existsSync(statePath)) throw new Error('Clean existing fixture first')
  const unit = unwrap(await db.from('units').select('id,status,building_id').eq('id', 2).single())
  if (unit.building_id !== 1 || unit.status !== '미방문') throw new Error('Unexpected fixture unit')
  const histories = unwrap(await db.from('visit_histories').select('id').eq('unit_id', 2))
  const event = unwrap(await db.from('calendar_events').insert({
    event_date: new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' }), time: '10:00',
    title: '방문기록 범위 검증', type: '주택', place: '데모 검증', leader_name: actor.name,
    card_name: '', memo: 'Temporary scoped-history verification', has_meeting: false, allow_applications: true,
  }).select('id').single())
  writeFileSync(statePath, JSON.stringify({ eventId: event.id, unit, historyIds: histories.map(row => row.id) }))
  unwrap(await db.from('event_participants').insert({ event_id: event.id, user_name: username, role: '입명' }))
  const assigned = unwrap(await db.rpc('assign_cards_bulk_tx', {
    p_token: actor.token, p_event_id: event.id,
    p_assignments: [{ userName: username, cardIds: [1], teamKey: null }], p_status: 'confirmed', p_expected_shared_at: null,
  }))
  if (!assigned?.ok) throw new Error('Fixture assignment failed')
  console.log(JSON.stringify({ phase: 'ready', eventId: event.id, unitId: unit.id }))
} else {
  const state = JSON.parse(readFileSync(statePath, 'utf8'))
  if (mode === 'cleanup') {
    const newRows = unwrap(await db.from('visit_histories').select('id,invalidated_at').eq('unit_id', state.unit.id))
      .filter(row => !state.historyIds.includes(row.id))
    for (const row of newRows) if (!row.invalidated_at) unwrap(await db.rpc('invalidate_visit_history_tx', {
      p_token: actor.token, p_history_id: row.id, p_reason: 'Demo scoped-history verification cleanup',
    }))
    unwrap(await db.from('units').update({ status: state.unit.status }).eq('id', state.unit.id))
    unwrap(await db.from('service_sessions').delete().eq('calendar_event_id', state.eventId).eq('user_name', username))
    unwrap(await db.from('calendar_events').delete().eq('id', state.eventId).eq('title', '방문기록 범위 검증'))
    unlinkSync(statePath)
  }
  const unit = unwrap(await db.from('units').select('id,status').eq('id', state.unit.id).single())
  const records = unwrap(await db.from('visit_histories').select('id,unit_id,result,invalidated_at').order('id'))
  const sessions = unwrap(await db.from('service_sessions').select('id,status').eq('calendar_event_id', state.eventId))
  console.log(JSON.stringify({ phase: mode, unit, activeHistories: records.filter(row => !row.invalidated_at),
    testHistories: records.filter(row => row.unit_id === state.unit.id && !state.historyIds.includes(row.id)), sessions }))
}
