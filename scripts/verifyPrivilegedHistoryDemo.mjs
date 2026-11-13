import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { parseEnv } from 'node:util'
import { randomBytes } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

const mode = process.argv[2]
assert.ok(['setup', 'check', 'cleanup'].includes(mode) && process.argv.includes('--confirm-demo'))
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
assert.ok(['admin', 'developer'].includes(actor.role))
const db = createClient(origin, config.VITE_SUPABASE_ANON_KEY, { ...options, global: { headers: { 'x-session-token': actor.token } } })
const file = '/tmp/field-map-privileged-history-fixture.json'
async function activeCount() {
  const result = await db.from('visit_histories').select('id', { count: 'exact', head: true }).is('invalidated_at', null)
    .gte('created_at', new Date(Date.now() - 365 * 86400000).toISOString())
  unwrap(result)
  return result.count
}
if (mode === 'setup') {
  assert.ok(!existsSync(file), 'Existing fixture must be cleaned first')
  const building = unwrap(await db.from('buildings').select('id,card_id,name').eq('id', 1).single())
  const before = await activeCount()
  const marker = `history-check-${randomBytes(4).toString('hex')}`
  const unit = unwrap(await db.from('units').insert({ building_id: building.id, number: marker,
    status: '미방문', is_chinese: true, memo: 'Temporary demo verification; remove after save/cancel test.' }).select('id,number,status').single())
  const fixture = { building, unit, before }
  writeFileSync(file, JSON.stringify(fixture), { mode: 0o600 })
  console.log(JSON.stringify(fixture))
} else {
  const fixture = JSON.parse(readFileSync(file, 'utf8'))
  const histories = unwrap(await db.from('visit_histories').select('id,result,invalidated_at,memo')
    .eq('unit_id', fixture.unit.id))
  if (mode === 'cleanup') {
    assert.ok(histories.every(h => h.invalidated_at), 'Cancel test records before cleanup')
    const current = unwrap(await db.from('units').select('id,number,building_id').eq('id', fixture.unit.id).single())
    assert.equal(current.number, fixture.unit.number)
    assert.equal(current.building_id, fixture.building.id)
    let removed = unwrap(await db.rpc('delete_place_or_request_tx', {
      p_token: actor.token, p_target_type: 'unit', p_target_id: fixture.unit.id,
      p_request_type: 'remove_place', p_note: 'Remove disposable history-demand demo verification unit',
    }))
    if (removed.action === 'requested') {
      const request = unwrap(await db.from('place_change_requests').select('unit_id,unit_number,note')
        .eq('id', removed.request_id).single())
      assert.equal(request.unit_id, fixture.unit.id)
      assert.equal(request.unit_number, fixture.unit.number)
      assert.equal(request.note, 'Remove disposable history-demand demo verification unit')
      removed = unwrap(await db.rpc('execute_place_deletion_request_tx', {
        p_token: actor.token, p_request_id: removed.request_id,
      }))
    }
    assert.equal(removed.action, 'deleted')
    assert.equal(unwrap(await db.from('units').select('id').eq('id', fixture.unit.id)).length, 0)
    assert.equal(await activeCount(), fixture.before)
    unlinkSync(file)
    console.log(JSON.stringify({ cleaned: true, activeHistories: fixture.before }))
  } else {
    const unit = unwrap(await db.from('units').select('id,status').eq('id', fixture.unit.id).single())
    console.log(JSON.stringify({ unit, histories, activeHistories: await activeCount(), baseline: fixture.before }))
  }
}
