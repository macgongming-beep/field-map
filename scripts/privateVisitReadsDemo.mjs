import assert from 'node:assert/strict'
import { readFileSync, mkdirSync, writeFileSync, chmodSync } from 'node:fs'
import { parseEnv } from 'node:util'
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'

const mode = process.argv[2]
assert.ok(['apply', 'smoke'].includes(mode) && process.argv.includes('--confirm-demo'))
const config = parseEnv(readFileSync(process.env.DEMO_ENV_FILE, 'utf8'))
const db = new URL(config.SUPABASE_DB_URL)
const project = 'itjlykpjmlcvanqpmkmc'
assert.equal(config.VITE_SUPABASE_URL, `https://${project}.supabase.co`)
assert.equal(decodeURIComponent(db.username), `postgres.${project}`)
assert.ok(db.hostname.endsWith('.pooler.supabase.com'))
assert.equal(db.port, '5432')
process.umask(0o077)
const env = { ...process.env, PGHOST: db.hostname, PGPORT: db.port, PGUSER: decodeURIComponent(db.username),
  PGDATABASE: db.pathname.slice(1), PGPASSWORD: decodeURIComponent(db.password), PGSSLMODE: 'require', PGCONNECT_TIMEOUT: '15' }
function run(command, args, input) {
  const r = spawnSync(command, args, { env, input, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  if (r.error || r.status) throw r.error ?? Error(r.stderr)
  return r.stdout.trim()
}
const sql = q => run('psql', ['-X', '-At', '-v', 'ON_ERROR_STOP=1'], q)
const tables = ['visit_histories', 'return_visits', 'return_visit_logs']
const migration = 'supabase/migrations/20261110_1000_private_visit_reads.sql'
const policies = () => sql("select json_agg(x order by tablename,policyname) from (select * from pg_policies where schemaname='public' and tablename in ('visit_histories','return_visits','return_visit_logs') and cmd<>'SELECT') x")
const digest = () => tables.map(table => sql(`select count(*)||':'||md5(coalesce(jsonb_agg(to_jsonb(x) order by id)::text,'')) from ${table} x`))
if (mode === 'apply') {
  assert.equal(sql("select count(*) from pg_policies where policyname in ('visit_histories_require_session_read','return_visits_require_session_read','return_visit_logs_require_session_read')"), '0', 'Already applied; inspect instead of overwriting rollback')
  const dir = resolve('backups', `private-visit-reads-demo-${Date.now()}`)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const dump = resolve(dir, 'before.dump')
  run('pg_dump', ['--format=custom', '--no-owner', '--schema=public', '--schema=private', '--file', dump])
  chmodSync(dump, 0o600)
  run('pg_restore', ['--list', dump])
  const before = { policies: policies(), digest: digest() }
  writeFileSync(resolve(dir, 'before.json'), JSON.stringify(before, null, 2))
  writeFileSync(resolve(dir, 'rollback.sql'), tables.map(t => `DROP POLICY ${t}_require_session_read ON public.${t};`).join('\n') + "\nNOTIFY pgrst,'reload schema';\n")
  run('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '--single-transaction', '-f', migration])
  assert.equal(policies(), before.policies, 'Existing writes must not change')
  assert.deepEqual(digest(), before.digest, 'Existing data must not change')
  console.log(JSON.stringify({ backup: dir, rowsAndWritePoliciesUnchanged: true }))
} else {
  assert.equal(sql("select count(*) from pg_policies where policyname in ('visit_histories_require_session_read','return_visits_require_session_read','return_visit_logs_require_session_read') and permissive='RESTRICTIVE'"), '3')
  const marker = `private_reads_${randomBytes(6).toString('hex')}`
  const pin = randomBytes(16).toString('hex')
  const actors = [], checks = []
  let cardId, buildingId, unitId, returnId, realtime
  let signalCount = 0
  const check = (name, condition) => { assert.ok(condition, name); checks.push(name); console.log(`PASS ${name}`) }
  async function request(path, body, token, method, success = true) {
    const r = await fetch(`${config.VITE_SUPABASE_URL}/rest/v1/${path}`, {
      method: method ?? (body === undefined ? 'GET' : 'POST'),
      headers: { apikey: config.VITE_SUPABASE_ANON_KEY, 'Content-Type': 'application/json', Prefer: 'return=representation', ...(token ? { 'x-session-token': token } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(20000),
    })
    const data = await r.json()
    assert.equal(r.ok, success, JSON.stringify(data))
    return data
  }
  const waitSignal = async previous => {
    const deadline = Date.now() + 15000
    while (signalCount <= previous && Date.now() < deadline) await new Promise(r => setTimeout(r, 100))
    assert.ok(signalCount > previous, 'Territory signal not received')
  }
  const count = async (table, token) => {
    const r = await fetch(`${config.VITE_SUPABASE_URL}/rest/v1/${table}?select=id`, {
      method: 'HEAD', headers: { apikey: config.VITE_SUPABASE_ANON_KEY, 'x-session-token': token, Prefer: 'count=exact' }, signal: AbortSignal.timeout(20000),
    })
    assert.ok(r.ok)
    return Number(r.headers.get('content-range').split('/')[1])
  }
  try {
    for (const role of ['user', 'leader', 'admin', 'developer']) {
      const name = `${marker}_${role}`
      const id = Number(sql(`insert into app_users(login_id,name,pin,role,approval_status,is_active) values('${name}','${name}',extensions.crypt('${pin}',extensions.gen_salt('bf',6)),'${role}','approved',true) returning id;`).split('\n')[0])
      actors.push({ id, name, role })
      actors.at(-1).token = (await request('rpc/auth_login', { p_login_id: name, p_pin: pin }))[0].token
    }
    const user = actors[0], reader = actors[1]
    cardId = Number(sql(`insert into cards(name,area,region,type) values('${marker}','test','test','전체') returning id;`).split('\n')[0])
    buildingId = Number(sql(`insert into buildings(card_id,name,address,type,lat,lng) values(${cardId},'${marker}','테스트로 123','주택',37.3,127.1) returning id;`).split('\n')[0])
    unitId = Number(sql(`insert into units(building_id,number,status) values(${buildingId},'101','미방문') returning id;`).split('\n')[0])
    realtime = createClient(config.VITE_SUPABASE_URL, config.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
    const channel = realtime.channel(marker).on('postgres_changes', { event: '*', schema: 'public', table: 'territory_change_signals', filter: `building_id=eq.${buildingId}` }, () => { signalCount++ })
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('Signal subscription timeout')), 15000)
      channel.subscribe(status => { if (status === 'SUBSCRIBED') { clearTimeout(timer); resolve() } else if (status === 'CHANNEL_ERROR') { clearTimeout(timer); reject(Error(status)) } })
    })
    const previous = signalCount
    const visit = (await request('visit_histories?select=id,memo,created_by_user_id', { unit_id: unitId, visitor_name: user.name,
      result: '부재', time_slot: '오후', visited_at: new Date().toISOString().slice(0, 10), memo: marker }, user.token))[0]
    check('visit save returns the stored memo and owner', visit?.memo === marker && visit.created_by_user_id === user.id)
    await waitSignal(previous)
    check('other device receives territory signal and reads saved visit', (await request(`visit_histories?id=eq.${visit.id}&select=memo`, undefined, reader.token))[0]?.memo === marker)
    check('unit status reflects saved visit', (await request(`units?id=eq.${unitId}&select=status`, undefined, reader.token))[0]?.status === '부재')
    const returned = await request('rpc/create_return_visit_tx', { p_token: user.token, p_display_name: marker,
      p_address: '', p_memo: marker, p_first_result: '만남', p_unit_id: unitId }, user.token)
    returnId = returned.id
    assert.ok(Number.isSafeInteger(returnId))
    for (const actor of actors) {
      for (const table of tables) check(`${actor.role}: complete ${table} count preserved`, await count(table, actor.token) === Number(sql(`select count(*) from ${table}`)))
    }
    for (const token of [undefined, 'malformed', '00000000-0000-0000-0000-000000000000']) {
      for (const table of tables) check(`${token ?? 'missing'} session cannot read ${table}`, (await request(`${table}?select=*&limit=1`, undefined, token)).length === 0)
    }
    const embedded = await request(`units?id=eq.${unitId}&select=id,visit_histories(id,memo)`)
    check('anonymous embedded history is empty', embedded[0]?.visit_histories?.length === 0)
    const linked = (await request(`return_visits?id=eq.${returnId}&select=id,building_id,unit_id,address`, undefined, user.token))[0]
    check('linked return visit retains building, unit and address', linked?.building_id === buildingId && linked.unit_id === unitId && linked.address === '테스트로 123')
    const cards = await request('rpc/get_recipient_return_visit_card_ids', { p_token: user.token }, user.token)
    check('recipient map-scope RPC includes linked return card', cards.includes(cardId))
    check('linked map building and unit remain readable', (await request(`buildings?id=eq.${buildingId}&select=id,lat,lng,units(id,number)`, undefined, user.token))[0]?.units.some(x => x.id === unitId))
    const log = (await request(`return_visit_logs?return_visit_id=eq.${returnId}&select=id,memo&invalidated_at=is.null`, undefined, user.token))[0]
    check('initial return-visit memo is readable', log?.memo === marker)
    const added = (await request('return_visit_logs?select=id,memo', { return_visit_id: returnId, visited_at: new Date().toISOString(), result: '부재', memo: `${marker}_new`, created_by: user.name }, user.token))[0]
    check('return detail save returns representation', added?.memo === `${marker}_new`)
    const edited = await request('rpc/update_return_visit_log_tx', { p_token: user.token, p_log_id: added.id, p_result: '만남', p_memo: `${marker}_edited`, p_reason: '' }, user.token)
    check('return detail edit still succeeds', edited.ok === true && (await request(`return_visit_logs?id=eq.${added.id}&select=memo`, undefined, user.token))[0]?.memo === `${marker}_edited`)
    await request('rpc/invalidate_return_visit_log_tx', { p_token: user.token, p_log_id: added.id, p_reason: '' }, user.token)
    check('return detail cancel is excluded from valid records', (await request(`return_visit_logs?id=eq.${added.id}&invalidated_at=is.null&select=id`, undefined, user.token)).length === 0)
    const signalsBeforeCancel = signalCount
    await request('rpc/invalidate_visit_history_tx', { p_token: user.token, p_history_id: visit.id, p_reason: '' }, user.token)
    await waitSignal(signalsBeforeCancel)
    check('other device sees cancelled visit absent after signal', (await request(`visit_histories?id=eq.${visit.id}&invalidated_at=is.null&select=id`, undefined, reader.token)).length === 0)
    check('unit status recomputed after cancel', (await request(`units?id=eq.${unitId}&select=status`, undefined, reader.token))[0]?.status === '미방문')
    sql(`update auth_sessions set expires_at=now()-interval '1 second' where user_id=${user.id};`)
    for (const table of tables) check(`expired live session cannot read ${table}`, (await request(`${table}?select=*&limit=1`, undefined, user.token)).length === 0)
  } finally {
    if (realtime) await realtime.removeAllChannels()
    if (returnId) sql(`delete from return_visit_logs where return_visit_id=${returnId}; delete from return_visits where id=${returnId};`)
    if (unitId) sql(`delete from visit_histories where unit_id=${unitId}; delete from regular_visits where unit_id=${unitId}; delete from units where id=${unitId};`)
    if (buildingId) sql(`delete from buildings where id=${buildingId}; delete from territory_change_signals where building_id=${buildingId};`)
    if (cardId) sql(`delete from cards where id=${cardId} and name='${marker}';`)
    if (actors.length) {
      const ids = actors.map(x => x.id).join(',')
      sql(`delete from service_logs where actor_id in (${ids}); delete from notifications where user_id in (${ids}); delete from login_logs where user_id in (${ids}); delete from auth_sessions where user_id in (${ids}); delete from app_users where id in (${ids}) and login_id like '${marker}%';`)
    }
    check('test accounts and card removed', sql(`select count(*) from app_users where login_id like '${marker}%'; select count(*) from cards where name='${marker}';`) === '0\n0')
  }
  mkdirSync('scratch', { recursive: true })
  writeFileSync('scratch/private-visit-reads-demo-results.json', JSON.stringify({ at: new Date().toISOString(), project, checks, signalCount }, null, 2))
}
