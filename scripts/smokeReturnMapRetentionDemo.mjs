import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const mode = process.argv[2]
if (!['inspect', 'setup', 'cleanup'].includes(mode) || !process.argv.includes('--confirm-demo')) throw Error('Explicit demo mode required')
const root = 'https://chinese-territory-app-demo.vercel.app'
const origin = 'https://itjlykpjmlcvanqpmkmc.supabase.co'
const stateFile = '/tmp/field-map-return-map-fixtures.json'
const marker = 'DEMO map retention 1031'
const html = await (await fetch(root)).text()
const entry = html.match(/src="(\/assets\/index-[^"]+\.js)"/)?.[1]
if (!entry) throw Error('Demo entry missing')
const source = await (await fetch(root + entry)).text()
const module = source.match(/cardServiceScope-[\w-]+\.js/)?.[0]
if (!module) throw Error('Demo database module missing')
const databaseSource = await (await fetch(`${root}/assets/${module}`)).text()
if (!databaseSource.includes(origin)) throw Error('Demo project mismatch')
const anonKey = databaseSource.match(/sb_publishable_[\w-]+/)?.[0] ?? [...databaseSource.matchAll(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g)].map(m => m[0])
  .find(value => JSON.parse(Buffer.from(value.split('.')[1], 'base64url')).role === 'anon')
if (!anonKey) throw Error('Public demo anon key missing')
const unwrap = ({ data, error }) => { if (error) throw error; return data }
const options = { auth: { persistSession: false, autoRefreshToken: false } }
const login = unwrap(await createClient(origin, anonKey, options).rpc('auth_login', { p_login_id: '봉사자', p_pin: '0000' }))[0]
if (login.role !== 'user' || !login.token) throw Error('Demo volunteer required')
const db = createClient(origin, anonKey, { ...options, global: { headers: { 'x-session-token': login.token } } })
const unit = unwrap(await db.from('units').select('id,number,building_id,status').eq('building_id', 79).eq('number', '104').single())
const building = unwrap(await db.from('buildings').select('id,card_id,name,address').eq('id', 79).single())
if (mode === 'inspect') {
  const existing = unwrap(await db.from('regular_visits').select('unit_id').eq('unit_id', unit.id))
  const fixtures = unwrap(await db.from('return_visits').select('id,display_name,building_id,unit_id').like('display_name', `${marker}%`))
  console.log(JSON.stringify({ unit, building, existing: existing.length, fixtures }))
} else if (mode === 'setup') {
  const state = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')) : { marker, ids: [], unit, building }
  if (state.marker !== marker || state.unit.id !== unit.id) throw Error('Fixture state mismatch')
  if (state.ids.length) {
    const previous = unwrap(await db.from('return_visits').select('id,ended_at').in('id', state.ids))
    if (previous.length === state.ids.length && previous.every(row => row.ended_at)) state.ids = []
  }
  const existing = unwrap(await db.from('return_visits').select('id,display_name').eq('unit_id', unit.id).is('ended_at', null))
  if (existing.some(row => row.display_name !== `${marker} linked`)) throw Error('Unit has a non-test return visit')
  if (!state.ids.length && existing.length === 1) state.ids.push(existing[0].id)
  writeFileSync(stateFile, JSON.stringify(state))
  for (const [name, unitId, address] of [['linked', unit.id, ''], ['address', null, '경기도 용인시 처인구 금학로 225']]) {
    if ((name === 'linked' && state.ids.length >= 1) || (name === 'address' && state.ids.length >= 2)) continue
    const result = unwrap(await db.rpc('create_return_visit_tx', { p_token: login.token,
      p_display_name: `${marker} ${name}`, p_address: address, p_memo: '', p_first_result: null, p_unit_id: unitId }))
    if (!Number.isSafeInteger(result.id)) throw Error(`Fixture creation failed: ${JSON.stringify(result)}`)
    state.ids.push(result.id)
    writeFileSync(stateFile, JSON.stringify(state))
  }
  console.log(JSON.stringify(state))
} else {
  const state = JSON.parse(readFileSync(stateFile, 'utf8'))
  if (state.marker !== marker) throw Error('Fixture marker mismatch')
  for (const id of state.ids) {
    const visit = unwrap(await db.from('return_visits').select('id,display_name').eq('id', id).single())
    if (!visit.display_name.startsWith(marker)) throw Error('Not a test fixture')
    const result = unwrap(await db.rpc('end_return_visit_tx', { p_token: login.token, p_return_visit_id: id,
      p_reason: 'no_longer_assigned', p_issue_type: null, p_issue_note: '' }))
    if (!result.ok) throw Error('Cleanup failed')
    const ended = unwrap(await db.from('return_visits').select('ended_at').eq('id', id).single())
    if (!ended.ended_at) throw Error('Fixture remained active')
  }
  const restored = unwrap(await db.from('units').select('id,status').eq('id', state.unit.id).single())
  if (restored.status !== state.unit.status) throw Error('Unit status changed unexpectedly')
  console.log(JSON.stringify({ ended: state.ids, unit: restored }))
}
