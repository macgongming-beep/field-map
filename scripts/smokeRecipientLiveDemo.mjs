import { readFileSync } from 'node:fs'
import { parseEnv } from 'node:util'
import { createInterface } from 'node:readline/promises'
import { createClient } from '@supabase/supabase-js'

// Manual browser observation between a demo-only write and its compensating undo.
if (!process.argv.includes('--confirm-demo') || !process.env.DEMO_ENV_FILE) throw new Error('Explicit demo confirmation required')
const config = parseEnv(readFileSync(process.env.DEMO_ENV_FILE, 'utf8'))
const origin = 'https://itjlykpjmlcvanqpmkmc.supabase.co'
if (config.VITE_SUPABASE_URL !== origin) throw new Error('Demo project mismatch')
const options = { auth: { persistSession: false, autoRefreshToken: false } }
const loginClient = createClient(origin, config.VITE_SUPABASE_ANON_KEY, options)
const unwrap = (response) => { if (response.error) throw response.error; return response.data }
const login = unwrap(await loginClient.rpc('auth_login', { p_login_id: config.TEST_LOGIN_ID, p_pin: config.TEST_LOGIN_PIN }))
const user = Array.isArray(login) ? login[0] : login
if (!user?.token) throw new Error('Demo login failed')
const db = createClient(origin, config.VITE_SUPABASE_ANON_KEY, { ...options, global: { headers: { 'x-session-token': user.token } } })
const progressCase = process.argv.includes('--progress-case')
const building = unwrap(await db.from('buildings').select('id,card_id').eq('name', progressCase ? '한동빌라' : '라비스타').eq('card_id', 1).single())
const unit = unwrap(await db.from('units').select('id,status').eq('building_id', building.id).eq('number', progressCase ? '102' : '샤랄랄라').single())
const before = unwrap(await db.rpc('get_card_summaries', { p_token: user.token, p_card_ids: [1] }))
const memo = `recipient-live-smoke-${Date.now()}`
let historyId
const terminal = createInterface({ input: process.stdin, output: process.stdout })
try {
  unwrap(await db.from('units').update({ status: '만남' }).eq('id', unit.id).eq('status', unit.status))
  const history = unwrap(await db.from('visit_histories').insert({ unit_id: unit.id, visitor_name: user.name,
    result: '만남', visited_at: new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' }), time_slot: '오후', memo }).select('id').single())
  historyId = history.id
  const after = unwrap(await db.rpc('get_card_summaries', { p_token: user.token, p_card_ids: [1] }))
  console.log(JSON.stringify({ phase: 'saved', unitId: unit.id, historyId, beforeProgress: before[0].progress, afterProgress: after[0].progress }))
  await terminal.question('Observe demo preview, then press Enter to invalidate this test visit and restore status: ')
} finally {
  terminal.close()
  if (historyId) unwrap(await db.rpc('invalidate_visit_history_tx', { p_token: user.token, p_history_id: historyId, p_reason: memo }))
  unwrap(await db.from('units').update({ status: unit.status }).eq('id', unit.id))
  const after = unwrap(await db.rpc('get_card_summaries', { p_token: user.token, p_card_ids: [1] }))
  console.log(JSON.stringify({ phase: 'restored', unitId: unit.id, status: unit.status, progress: after[0].progress }))
}
