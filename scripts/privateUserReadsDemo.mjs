import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { parseEnv } from 'node:util'
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { resolve } from 'node:path'

const mode = process.argv[2]
assert.ok(['apply-rpcs', 'apply-policy', 'smoke', 'fixture', 'cleanup'].includes(mode) && process.argv.includes('--confirm-demo'))
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
const fixtureFile = 'scratch/private-user-reads-fixture.json'
const digest = () => sql("select count(*)||':'||md5(coalesce(jsonb_agg(to_jsonb(u) order by id)::text,'')) from app_users u")
if (mode.startsWith('apply')) {
  const policy = mode === 'apply-policy'
  assert.equal(sql(policy
    ? "select count(*) from pg_policies where policyname='app_users_self_admin_read'"
    : "select count(*) from pg_proc where pronamespace='public'::regnamespace and proname in ('get_user_directory','get_event_leader_contacts')"), '0')
  const dir = resolve('backups', `private-user-reads-demo-${mode}-${Date.now()}`)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const dump = resolve(dir, 'before.dump')
  run('pg_dump', ['--format=custom', '--no-owner', '--schema=public', '--schema=private', '--file', dump])
  run('pg_restore', ['--list', dump])
  writeFileSync(resolve(dir, 'rollback.sql'), policy
    ? "DROP POLICY app_users_self_admin_read ON public.app_users;\nNOTIFY pgrst,'reload schema';\n"
    : "DROP FUNCTION public.get_event_leader_contacts(integer);\nDROP FUNCTION public.get_user_directory();\nNOTIFY pgrst,'reload schema';\n")
  const before = digest()
  const writes = () => sql("select json_agg(p order by policyname) from pg_policies p where schemaname='public' and tablename='app_users' and cmd<>'SELECT'")
  const beforeWrites = writes()
  run('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '--single-transaction', '-f', `supabase/migrations/20261110_${policy ? '1500_private_user_rows' : '1400_private_user_directory'}.sql`])
  assert.equal(digest(), before)
  assert.equal(writes(), beforeWrites)
  console.log(JSON.stringify({ backup: dir, rowsAndWritePoliciesUnchanged: true }))
  process.exit(0)
}
function cleanup(f) {
  assert.match(f.marker, /^private_users_[a-f0-9]{12}$/)
  const ids = f.actors.map(a => { assert.ok(Number.isSafeInteger(a.id)); return a.id }).join(',')
  if (f.eventId) { assert.ok(Number.isSafeInteger(f.eventId)); sql(`delete from comments where target_type='calendar_event' and target_id=${f.eventId} and author_id in (${ids}); delete from calendar_events where id=${f.eventId} and title='${f.marker}';`) }
  sql(`delete from notifications where user_id in (${ids}); delete from service_logs where actor_id in (${ids});
    delete from login_logs where user_id in (${ids}); delete from auth_sessions where user_id in (${ids});
    delete from private.login_attempt_guard where user_id in (${ids});
    delete from app_users where id in (${ids}) and login_id like '${f.marker}%';`)
  assert.equal(sql(`select count(*) from app_users where id in (${ids})`), '0')
  if (f.eventId) assert.equal(sql(`select count(*) from calendar_events where id=${f.eventId}`), '0')
}
if (mode === 'cleanup') {
  cleanup(JSON.parse(readFileSync(fixtureFile, 'utf8')))
  console.log('Exact demo fixture removed')
  process.exit(0)
}
const f = { marker: `private_users_${randomBytes(6).toString('hex')}`, actors: [], eventId: null }
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
try {
  for (const role of ['user', 'leader', 'admin', 'developer']) {
    const name = `${f.marker}_${role}`
    const id = Number(sql(`insert into app_users(login_id,name,pin,role,phone,approval_status,is_active) values
      ('${name}','${name}',extensions.crypt('0000',extensions.gen_salt('bf',6)),'${role}','01000000000','approved',true) returning id;`).split('\n')[0])
    const token = (await rest('rpc/auth_login', { p_login_id: name, p_pin: '0000' }))[0].token
    f.actors.push({ id, name, role, token })
  }
  const [user, leader, admin, developer] = f.actors
  f.eventId = Number(sql(`insert into calendar_events(event_date,time,title,type,place,leader_name,allow_applications)
    values((now() at time zone 'Asia/Seoul')::date,'10:00','${f.marker}','주택','테스트','${leader.name}',true) returning id;`).split('\n')[0])
  if (mode === 'fixture') {
    writeFileSync(fixtureFile, JSON.stringify(f, null, 2))
    console.log(JSON.stringify({ eventId: f.eventId, accounts: f.actors.map(({ id, name, role }) => ({ id, name, role })), pin: '0000' }))
  } else {
    for (const actor of f.actors) {
      const rows = await rest('app_users?select=id,login_id,phone', undefined, actor.token)
      check(`${actor.role}: private table scope`, ['admin', 'developer'].includes(actor.role) ? rows.length > 4 : rows.length === 1 && rows[0].id === actor.id)
      const directory = await rest('rpc/get_user_directory', {}, actor.token)
      check(`${actor.role}: directory excludes contact/login fields`, directory.some(x => x.id === user.id) && directory.every(x => !('phone' in x) && !('login_id' in x) && !('last_login_at' in x)))
      const contacts = await rest('rpc/get_event_leader_contacts', { p_event_id: f.eventId }, actor.token)
      check(`${actor.role}: only event leader phone`, contacts.length === 1 && contacts[0].id === leader.id && contacts[0].phone === '01000000000')
    }
    for (const token of [undefined, 'malformed', '00000000-0000-0000-0000-000000000000']) {
      check('invalid session: private table empty', (await rest('app_users?select=id,phone,login_id', undefined, token)).length === 0)
      for (const rpc of ['get_user_directory', 'get_event_leader_contacts']) check(`invalid session: ${rpc} denied`, (await rest(`rpc/${rpc}`, rpc === 'get_user_directory' ? {} : { p_event_id: f.eventId }, token, 'POST', false)).code === '42501')
    }
    check('unknown event yields no contacts', (await rest('rpc/get_event_leader_contacts', { p_event_id: -1 }, user.token)).length === 0)
    const profile = await rest(`app_users?id=eq.${user.id}&select=id,phone`, { phone: '01000000001' }, user.token, 'PATCH')
    check('own profile edit returns representation', profile[0]?.phone === '01000000001')
    check('cannot modify someone else', (await rest(`app_users?id=eq.${leader.id}&select=id`, { phone: '01000000002' }, user.token, 'PATCH')).length === 0)
    const loginId = `${user.name}_edited`
    check('admin edits identity/group and reads full directory', (await rest(`app_users?id=eq.${user.id}&select=id,login_id,group_name`, { login_id: loginId, group_name: 'privacy-test' }, admin.token, 'PATCH'))[0]?.login_id === loginId)
    check('admin resets PIN', (await rest(`app_users?id=eq.${user.id}&select=id`, { pin: '0001' }, admin.token, 'PATCH'))[0]?.id === user.id)
    const newToken = (await rest('rpc/auth_login', { p_login_id: loginId, p_pin: '0001' }))[0]?.token
    check('changed identity and PIN can log in', !!newToken)
    const participant = (await rest('event_participants?select=id', { event_id: f.eventId, user_name: user.name, role: '신청' }, newToken))[0]
    check('self-referencing participant policy still permits application', !!participant?.id)
    check('self-referencing participant policy still permits cancellation', (await rest(`event_participants?id=eq.${participant.id}&select=id`, undefined, newToken, 'DELETE')).length === 1)
    const comment = (await rest('comments?select=id', { target_type: 'calendar_event', target_id: f.eventId, author_id: user.id, author_name: user.name, content: f.marker }, newToken))[0]
    check('self-referencing comment policy still permits write', !!comment?.id)
    check('leader comment notification preserved', Number(sql(`select count(*) from notifications where user_id=${leader.id} and type='comment' and link like '%${f.eventId}%'`)) > 0)
    check('recipient return card RPC still works', Array.isArray(await rest('rpc/get_recipient_return_visit_card_ids', { p_token: newToken }, newToken)))
    check('developer still sees updated private identity', (await rest(`app_users?id=eq.${user.id}&select=login_id,phone`, undefined, developer.token))[0]?.login_id === loginId)
    writeFileSync('scratch/private-user-reads-demo-results.json', JSON.stringify({ project, at: new Date().toISOString(), checks }, null, 2))
  }
} finally {
  if (mode !== 'fixture' && f.actors.length) cleanup(f)
}
