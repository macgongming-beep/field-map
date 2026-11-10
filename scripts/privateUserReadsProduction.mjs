import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdirSync, cpSync } from 'node:fs'
import { parseEnv } from 'node:util'
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { resolve } from 'node:path'

// Phase 3 is deliberately not supported by this production runner.
const mode = process.argv[2]
const project = 'qdxemvdorasoryfysuoq'
assert.ok(['inspect', 'apply-rpcs', 'repair-rpc', 'smoke', 'fixture', 'cleanup'].includes(mode))
assert.ok(process.argv.includes(`--confirm=${project}`))
const config = parseEnv(readFileSync(process.env.PRODUCTION_ENV_FILE, 'utf8'))
const db = new URL(config.SUPABASE_DB_URL)
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
const policyState = () => sql("select coalesce(json_agg(p order by policyname)::text,'[]') from pg_policies p where schemaname='public' and tablename='app_users'")
const noRestriction = () => assert.equal(sql("select count(*) from pg_policies where schemaname='public' and tablename='app_users' and policyname='app_users_self_admin_read'"), '0', 'Phase 3 must remain unapplied')
const functionCount = () => Number(sql("select count(*) from pg_proc where pronamespace='public'::regnamespace and proname in ('get_user_directory','get_event_leader_contacts')"))
noRestriction()
if (mode === 'inspect') {
  console.log(JSON.stringify({ project, phase3Applied: false, functions: functionCount(), policies: JSON.parse(policyState()) }))
  process.exit(0)
}
if (mode === 'apply-rpcs' || mode === 'repair-rpc') {
  const repairing = mode === 'repair-rpc'
  assert.equal(functionCount(), repairing ? 2 : 0, 'Review existing functions rather than overwrite')
  const original = readFileSync('supabase/migrations/20261110_1400_private_user_directory.sql', 'utf8')
  if (repairing) assert.equal(sql("select prosrc from pg_proc where oid='public.get_user_directory()'::regprocedure").trim(), original.match(/AS \$\$([\s\S]*?)\$\$/)[1].trim())
  const dir = resolve('backups', `private-user-reads-production-additive-${Date.now()}`)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const dump = resolve(dir, 'before.dump')
  run('pg_dump', ['--format=custom', '--no-owner', '--schema=public', '--schema=private', '--file', dump])
  run('pg_restore', ['--list', dump])
  const policies = policyState()
  const before = sql("select count(*)||':'||md5(coalesce(jsonb_agg(to_jsonb(u) order by id)::text,'')) from app_users u")
  const compatibility = readFileSync('supabase/migrations/20261110_1410_directory_optional_cart_fields.sql', 'utf8')
  const migration = repairing ? compatibility : original + '\n' + compatibility
  writeFileSync(resolve(dir, 'before.json'), JSON.stringify({ at: new Date().toISOString(), project, policies: JSON.parse(policies), userDigest: before, migration }, null, 2))
  writeFileSync(resolve(dir, 'rollback.sql'), repairing
    ? sql("select pg_get_functiondef('public.get_user_directory()'::regprocedure)") + ";\nNOTIFY pgrst,'reload schema';\n"
    : "DROP FUNCTION public.get_event_leader_contacts(integer);\nDROP FUNCTION public.get_user_directory();\nNOTIFY pgrst,'reload schema';\n")
  assert.equal(functionCount(), repairing ? 2 : 0)
  noRestriction()
  const guarded = `SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
    CREATE TEMP TABLE original_policies AS SELECT * FROM pg_policies WHERE schemaname='public' AND tablename='app_users';
    ${migration}
    DO $$ BEGIN
      IF EXISTS(SELECT * FROM original_policies EXCEPT SELECT * FROM pg_policies)
        OR EXISTS(SELECT * FROM pg_policies WHERE schemaname='public' AND tablename='app_users' EXCEPT SELECT * FROM original_policies)
      THEN RAISE EXCEPTION 'User policies changed'; END IF;
    END $$;`
  run('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '--single-transaction', '-f', '-'], guarded)
  assert.equal(functionCount(), 2)
  assert.equal(policyState(), policies)
  noRestriction()
  const after = sql("select count(*)||':'||md5(coalesce(jsonb_agg(to_jsonb(u) order by id)::text,'')) from app_users u")
  writeFileSync(resolve(dir, 'after.json'), JSON.stringify({ policiesUnchanged: true, phase3Applied: false, userDigest: after, userDigestUnchanged: before === after }))
  const durable = resolve('/Users/gm/Documents/New project/field-map-recipient-perf/backups', dir.split('/').at(-1))
  cpSync(dir, durable, { recursive: true, errorOnExist: true, force: false })
  console.log(JSON.stringify({ backup: dir, durableBackup: durable, policiesUnchanged: true, userDigestUnchanged: before === after, phase3Applied: false }))
  process.exit(0)
}
const fixtureFile = resolve('scratch/private-user-reads-production-fixture.json')
function cleanup(f) {
  assert.match(f.marker, /^private_users_prod_[a-f0-9]{12}$/)
  const ids = f.actors.map(a => { assert.ok(Number.isSafeInteger(a.id)); return a.id }).join(',')
  if (!ids) return
  if (f.eventId) {
    assert.ok(Number.isSafeInteger(f.eventId))
    assert.equal(sql(`select count(*) from calendar_events where id=${f.eventId} and title='${f.marker}'`), '1')
    sql(`delete from comments where target_type='calendar_event' and target_id=${f.eventId} and author_id in (${ids}); delete from calendar_events where id=${f.eventId} and title='${f.marker}';`)
  }
  assert.equal(Number(sql(`select count(*) from app_users where id in (${ids}) and login_id like '${f.marker}%'`)), f.actors.length)
  sql(`delete from notifications where user_id in (${ids}); delete from service_logs where actor_id in (${ids});
    delete from login_logs where user_id in (${ids}); delete from auth_sessions where user_id in (${ids});
    delete from private.login_attempt_guard where user_id in (${ids});
    delete from app_users where id in (${ids}) and login_id like '${f.marker}%';`)
  assert.equal(sql(`select count(*) from app_users where id in (${ids})`), '0')
  if (f.eventId) assert.equal(sql(`select count(*) from calendar_events where id=${f.eventId}`), '0')
}
if (mode === 'cleanup') {
  cleanup(JSON.parse(readFileSync(fixtureFile, 'utf8')))
  console.log('Exact production fixtures removed; phase 3 remains absent')
  process.exit(0)
}
assert.equal(functionCount(), 2)
const f = { marker: `private_users_prod_${randomBytes(6).toString('hex')}`, pin: randomBytes(6).toString('hex'), actors: [], eventId: null }
const checks = []
const check = (name, value) => { assert.ok(value, name); checks.push(name); console.log(`PASS ${name}`) }
async function rest(path, body, token, method, ok = true) {
  const r = await fetch(`${config.VITE_SUPABASE_URL}/rest/v1/${path}`, {
    method: method ?? (body === undefined ? 'GET' : 'POST'),
    headers: { apikey: config.VITE_SUPABASE_ANON_KEY, 'Content-Type': 'application/json', Prefer: 'return=representation', ...(token ? { 'x-session-token': token } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(20000),
  })
  const data = await r.json()
  assert.equal(r.ok, ok, JSON.stringify(data))
  return data
}
let retained = false
try {
  for (const role of ['user', 'leader', 'admin', 'developer']) {
    const name = `${f.marker}_${role}`
    const id = Number(sql(`insert into app_users(login_id,name,pin,role,phone,approval_status,is_active) values
      ('${name}','${name}',extensions.crypt('${f.pin}',extensions.gen_salt('bf',6)),'${role}','01000000000','approved',true) returning id;`).split('\n')[0])
    const actor = { id, name, role }
    f.actors.push(actor)
    actor.token = (await rest('rpc/auth_login', { p_login_id: name, p_pin: f.pin }))[0].token
  }
  const [user, leader, admin, developer] = f.actors
  f.eventId = Number(sql(`insert into calendar_events(event_date,time,title,type,place,leader_name,allow_applications)
    values((now() at time zone 'Asia/Seoul')::date,'23:55','${f.marker}','주택','검증용','${leader.name}',true) returning id;`).split('\n')[0])
  if (mode === 'fixture') {
    mkdirSync('scratch', { recursive: true })
    writeFileSync(fixtureFile, JSON.stringify(f, null, 2))
    retained = true
    console.log(JSON.stringify({ fixtureFile, eventId: f.eventId, accounts: f.actors.map(({ id, name, role }) => ({ id, name, role })) }))
  } else {
    const policies = policyState()
    for (const actor of f.actors) {
      const rows = await rest('app_users?select=id,login_id,phone', undefined, actor.token)
      check(`${actor.role}: old-client full directory still readable`, rows.some(x => x.id === user.id) && rows.some(x => x.id === leader.id))
      const directory = await rest('rpc/get_user_directory', {}, actor.token)
      check(`${actor.role}: safe directory excludes private fields`, directory.some(x => x.id === user.id) && directory.every(x => !('phone' in x) && !('login_id' in x) && !('last_login_at' in x) && !('pin' in x)))
      const contacts = await rest('rpc/get_event_leader_contacts', { p_event_id: f.eventId }, actor.token)
      check(`${actor.role}: contacts limited to actual event leader`, contacts.length === 1 && contacts[0].id === leader.id && contacts[0].phone === '01000000000')
    }
    for (const token of [undefined, 'malformed', '00000000-0000-0000-0000-000000000000']) {
      check('invalid session: private table remains hidden', (await rest('app_users?select=id,phone,login_id', undefined, token)).length === 0)
      for (const rpc of ['get_user_directory', 'get_event_leader_contacts']) check(`invalid session: ${rpc} denied`, (await rest(`rpc/${rpc}`, rpc === 'get_user_directory' ? {} : { p_event_id: f.eventId }, token, 'POST', false)).code === '42501')
    }
    check('unknown event yields no contacts', (await rest('rpc/get_event_leader_contacts', { p_event_id: -1 }, user.token)).length === 0)
    check('own phone edit returns representation', (await rest(`app_users?id=eq.${leader.id}&select=id,phone`, { phone: '01000000009' }, leader.token, 'PATCH'))[0]?.phone === '01000000009')
    check('member contact read reflects leader phone edit', (await rest('rpc/get_event_leader_contacts', { p_event_id: f.eventId }, user.token))[0]?.phone === '01000000009')
    check('cannot modify another user', (await rest(`app_users?id=eq.${leader.id}&select=id`, { phone: '01000000002' }, user.token, 'PATCH')).length === 0)
    const loginId = `${user.name}_edited`
    check('admin edits identity/group', (await rest(`app_users?id=eq.${user.id}&select=id,login_id,group_name`, { login_id: loginId, group_name: 'privacy-test' }, admin.token, 'PATCH'))[0]?.login_id === loginId)
    const changedPin = randomBytes(6).toString('hex')
    check('admin resets PIN', (await rest(`app_users?id=eq.${user.id}&select=id`, { pin: changedPin }, admin.token, 'PATCH'))[0]?.id === user.id)
    const newToken = (await rest('rpc/auth_login', { p_login_id: loginId, p_pin: changedPin }))[0]?.token
    check('updated identity/PIN login works', !!newToken)
    const participant = (await rest('event_participants?select=id', { event_id: f.eventId, user_name: user.name, role: '신청' }, newToken))[0]
    check('application still works', !!participant?.id)
    check('cancellation still works', (await rest(`event_participants?id=eq.${participant.id}&select=id`, undefined, newToken, 'DELETE')).length === 1)
    check('comment write works', !!(await rest('comments?select=id', { target_type: 'calendar_event', target_id: f.eventId, author_id: user.id, author_name: user.name, content: f.marker }, newToken))[0]?.id)
    check('leader comment notification preserved', Number(sql(`select count(*) from notifications where user_id=${leader.id} and type='comment' and link like '%${f.eventId}%'`)) > 0)
    check('return-card RPC works', Array.isArray(await rest('rpc/get_recipient_return_visit_card_ids', { p_token: newToken }, newToken)))
    check('developer reads updated private identity', (await rest(`app_users?id=eq.${user.id}&select=login_id,phone`, undefined, developer.token))[0]?.login_id === loginId)
    noRestriction()
    check('all app_users policies unchanged', policyState() === policies)
  }
} finally {
  if (!retained) cleanup(f)
}
if (mode === 'smoke') {
  noRestriction()
  mkdirSync('scratch', { recursive: true })
  writeFileSync('scratch/private-user-reads-production-results.json', JSON.stringify({ project, at: new Date().toISOString(), checks, phase3Applied: false, fixturesRemoved: true }, null, 2))
  console.log(JSON.stringify({ checks: checks.length, phase3Applied: false, fixturesRemoved: true }))
}
