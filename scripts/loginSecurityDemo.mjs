import assert from 'node:assert/strict'
import { readFileSync, mkdirSync, chmodSync, writeFileSync } from 'node:fs'
import { parseEnv } from 'node:util'
import { spawn, spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { resolve } from 'node:path'

const file = process.env.DEMO_ENV_FILE
const mode = process.argv[2]
if (!file || !['inspect', 'apply', 'apply-followup', 'smoke'].includes(mode) || !process.argv.includes('--confirm-demo')) {
  throw new Error('Requires DEMO_ENV_FILE, inspect|apply|apply-followup|smoke and --confirm-demo')
}
const config = parseEnv(readFileSync(file, 'utf8'))
const dbUrl = new URL(config.SUPABASE_DB_URL)
const project = 'itjlykpjmlcvanqpmkmc'
assert.equal(decodeURIComponent(dbUrl.username), `postgres.${project}`)
assert.equal(config.VITE_SUPABASE_URL, `https://${project}.supabase.co`)
assert.ok(dbUrl.hostname.endsWith('.pooler.supabase.com'))
assert.equal(dbUrl.port, '5432')
const env = { ...process.env, PGHOST: dbUrl.hostname, PGPORT: '5432',
  PGUSER: decodeURIComponent(dbUrl.username), PGDATABASE: dbUrl.pathname.slice(1),
  PGPASSWORD: decodeURIComponent(dbUrl.password), PGSSLMODE: 'require', PGCONNECT_TIMEOUT: '15' }
function run(command, args, input) {
  const result = spawnSync(command, args, { env, encoding: 'utf8', input, maxBuffer: 16 * 1024 * 1024 })
  if (result.error) throw result.error
  if (result.status) throw new Error(result.stderr || `${command} failed`)
  return result.stdout.trim()
}
const sql = (query) => run('psql', ['-X', '-At', '-v', 'ON_ERROR_STOP=1'], query)
const installed = () => sql("select to_regclass('private.login_attempt_guard') is not null") === 't'
const followupInstalled = () => sql("select exists(select 1 from pg_trigger where tgrelid='public.app_users'::regclass and tgname='app_users_unlock_login_after_pin_reset' and not tgisinternal)") === 't'
async function checkForeignKeyLock(id, loginId) {
  const holder = spawn('psql', ['-X', '-At', '-v', 'ON_ERROR_STOP=1'], { env, stdio: ['pipe', 'pipe', 'pipe'] })
  let output = ''
  let errors = ''
  holder.stderr.on('data', (chunk) => { errors += chunk })
  const exited = new Promise((resolve) => { holder.on('close', (code) => resolve(code)); holder.on('error', () => resolve(-1)) })
  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Login lock holder timed out')), 15_000)
      holder.stdout.on('data', (chunk) => {
        output += chunk
        if (output.includes('LOGIN_LOCK_HELD')) { clearTimeout(timeout); resolve() }
      })
      holder.once('close', () => { clearTimeout(timeout); if (!output.includes('LOGIN_LOCK_HELD')) reject(new Error(errors || 'Lock holder closed early')) })
      holder.once('error', (error) => { clearTimeout(timeout); reject(error) })
      holder.stdin.end(`begin; select * from public.auth_login('${loginId}','wrong');
        select 'LOGIN_LOCK_HELD'; select pg_sleep(3); rollback;`)
    })
    // A second connection must acquire the FK KEY SHARE while login's transaction is open.
    sql(`begin; set local lock_timeout='500ms'; insert into auth_sessions(user_id) values(${id}); rollback;`)
  } finally {
    if (holder.exitCode === null && !output.includes('LOGIN_LOCK_HELD')) holder.kill()
    const code = await exited
    assert.equal(code, 0, errors)
  }
}
if (mode === 'inspect') {
  console.log(sql(`select p.oid::regprocedure, p.prosecdef from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='auth_login';
    select policyname,cmd,qual from pg_policies where schemaname='public' and tablename='app_users';
    select count(*) from auth_sessions where expires_at>now();`))
  console.log(`Demo login guard installed: ${installed()}`)
  console.log(`Demo followup installed: ${followupInstalled()}`)
} else if (mode.startsWith('apply')) {
  const followup = mode === 'apply-followup'
  if (followup ? !installed() || followupInstalled() : installed()) throw new Error('Unexpected migration state; inspect first')
  // Fail on unexpected overloads instead of leaving an unguarded login route.
  assert.equal(sql("select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='auth_login'"), '1')
  assert.equal(sql("select to_regprocedure('public.auth_login(text,text,text,text)') is not null"), 't')
  const directory = resolve('backups', `login-security-demo-${new Date().toISOString().replaceAll(':', '-')}`)
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const backup = resolve(directory, 'before.dump')
  run('pg_dump', ['--format=custom', '--no-owner', '--no-privileges', '--schema=public', '--schema=private', '--file', backup])
  chmodSync(backup, 0o600)
  run('pg_restore', ['--list', backup])
  const definition = sql("select pg_get_functiondef('public.auth_login(text,text,text,text)'::regprocedure)")
  const policies = sql(`select format('CREATE POLICY %I ON public.app_users AS %s FOR %s TO %s%s%s;',
    policyname,permissive,cmd,array_to_string(array(select quote_ident(r) from unnest(roles) r),','),
    case when qual is null then '' else ' USING ('||qual||')' end,
    case when with_check is null then '' else ' WITH CHECK ('||with_check||')' end)
    from pg_policies where schemaname='public' and tablename='app_users'
      and policyname in ('app_users_select_all','app_users_require_session_read')`)
  writeFileSync(resolve(directory, 'rollback.sql'), `${definition}\n
    REVOKE ALL ON FUNCTION public.auth_login(text,text,text,text) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.auth_login(text,text,text,text) TO anon, authenticated;
    DROP POLICY IF EXISTS app_users_select_all ON public.app_users;
    DROP POLICY IF EXISTS app_users_require_session_read ON public.app_users;
    ${policies}\n${followup ? 'DROP TRIGGER IF EXISTS app_users_unlock_login_after_pin_reset ON public.app_users; DROP FUNCTION IF EXISTS private.unlock_login_after_admin_pin_reset();' : ''}
    NOTIFY pgrst, 'reload schema';\n`, { mode: 0o600 })
  run('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '--single-transaction', '-f', followup
    ? 'supabase/migrations/20261109_1900_login_guard_followup.sql' : 'supabase/migrations/20261109_1800_login_attempt_guard.sql'])
  assert.ok(installed())
  console.log(`Demo migration applied. Checked backup and exact previous-function/policy rollback: ${directory}`)
} else {
  assert.ok(installed(), 'Apply migration first')
  const marker = `login_guard_smoke_${randomBytes(8).toString('hex')}`
  const pin = randomBytes(16).toString('hex')
  const checks = []
  const check = (name, condition) => { assert.ok(condition, name); checks.push(name); console.log(`PASS ${name}`) }
  const rest = async (path, body, token, method) => {
    const response = await fetch(`${config.VITE_SUPABASE_URL}/rest/v1/${path}`, {
      method: method ?? (body === undefined ? 'GET' : 'POST'),
      headers: { apikey: config.VITE_SUPABASE_ANON_KEY, 'Content-Type': 'application/json',
        Prefer: 'return=representation',
        ...(token ? { 'x-session-token': token } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30_000),
    })
    const data = await response.json()
    assert.ok(response.ok, `HTTP ${response.status}: ${JSON.stringify(data)}`)
    return data
  }
  const login = (id, password = pin, legacy = false) => rest('rpc/auth_login', {
    p_login_id: id, p_pin: password,
    ...(legacy ? {} : { p_device_label: marker, p_user_agent: 'login-security-demo-smoke' }),
  })
  let fixtureId
  let actorId
  let eventId
  try {
    fixtureId = Number(sql(`insert into app_users(login_id,name,pin,role,approval_status,is_active)
      values('${marker}','${marker}',extensions.crypt('${pin}',extensions.gen_salt('bf',6)),'user','approved',true)
      returning id;`).split('\n')[0])
    assert.ok(Number.isSafeInteger(fixtureId) && fixtureId > 0)
    check('anonymous directory hidden', (await rest('app_users?select=id,login_id&limit=1')).length === 0)
    const normal = await login(marker)
    check('normal login token and user role', normal[0]?.id === fixtureId && normal[0]?.token && normal[0]?.role === 'user')
    const token = normal[0].token
    check('logged-in directory still readable', (await rest(`app_users?select=id,login_id&id=eq.${fixtureId}`, undefined, token))[0]?.id === fixtureId)
    if (followupInstalled()) {
      await checkForeignKeyLock(fixtureId, marker)
      check('login row lock allows concurrent session FK insert', true)
    }
    for (let i = 0; i < 4; i++) assert.deepEqual(await login(marker, 'wrong'), [])
    check('correct login after four failures', Boolean((await login(marker, pin, true))[0]?.token))
    check('successful login resets failures', sql(`select failed_attempts from private.login_attempt_guard where user_id=${fixtureId}`) === '0')
    // Actual concurrent HTTP requests, not PGlite's serialized connection.
    const parallel = await Promise.all(Array.from({ length: 12 }, () => login(marker, 'wrong')))
    check('12 simultaneous wrong attempts are all denied', parallel.every((r) => r.length === 0))
    check('concurrent failures stop at five and set lock', sql(`select failed_attempts=5 and locked_until>clock_timestamp() from private.login_attempt_guard where user_id=${fixtureId}`) === 't')
    const deadline = sql(`select locked_until from private.login_attempt_guard where user_id=${fixtureId}`)
    const rejected = await login(marker)
    check('correct password denied during lock', rejected.length === 0)
    check('two-argument login cannot bypass lock', (await login(marker, pin, true)).length === 0)
    check('nonexistent ID returns identical body', JSON.stringify(await login(`${marker}_absent`)) === JSON.stringify(rejected))
    check('locked retries do not extend deadline', sql(`select locked_until from private.login_attempt_guard where user_id=${fixtureId}`) === deadline)
    check('existing session survives login lock', await rest('rpc/verify_session', { p_token: token }, token) === fixtureId)
    check('existing session can still read directory', (await rest(`app_users?select=id&id=eq.${fixtureId}`, undefined, token)).length === 1)
    if (followupInstalled()) {
      actorId = Number(sql(`insert into app_users(login_id,name,pin,role,approval_status,is_active)
        values('${marker}_admin','${marker}_admin',extensions.crypt('${pin}',extensions.gen_salt('bf',6)),'admin','approved',true)
        returning id;`).split('\n')[0])
      const adminToken = (await login(`${marker}_admin`))[0].token
      const changed = await rest(`app_users?id=eq.${fixtureId}&select=id`, { pin }, adminToken, 'PATCH')
      check('actual admin PIN-reset PATCH succeeds', changed[0]?.id === fixtureId)
      check('admin reset removes lock in the same transaction', sql(`select count(*) from private.login_attempt_guard where user_id=${fixtureId}`) === '0')
      check('normal login immediately after admin reset', Boolean((await login(marker))[0]?.token))
      sql(`update app_users set role='leader' where id=${actorId};`)
      const leaderToken = (await login(`${marker}_admin`))[0].token
      eventId = Number(sql(`insert into calendar_events(event_date,title,time,leader_name,allow_applications)
        values('2030-01-01','${marker}','10:00','${marker}_admin',true) returning id;`).split('\n')[0])
      const joined = await rest('event_participants?select=id', { event_id: eventId, user_name: marker, role: '신청' }, token)
      check('participant application passes session-gated user policy', Boolean(joined[0]?.id))
      const comment = await rest('comments?select=id', { target_type: 'calendar_event', target_id: eventId,
        author_id: fixtureId, author_name: marker, content: marker }, token)
      check('comment insert passes session-gated user policy', Boolean(comment[0]?.id))
      check('return-visit invoker RPC still reads current user', Array.isArray(await rest('rpc/get_recipient_return_visit_card_ids', { p_token: token }, token)))
      sql(`update app_users set role='admin' where id=${fixtureId};`)
      await rest(`calendar_events?id=eq.${eventId}&select=id`, { title: `${marker}_updated` }, token, 'PATCH')
      const notifications = await rest(`notifications?user_id=eq.${actorId}&type=eq.event_change&select=id`, undefined, leaderToken)
      check('event edit creates a leader notification visible via leader token', notifications.length > 0)
      sql(`update app_users set role='user' where id=${fixtureId};`)
      const cancelled = await rest(`event_participants?id=eq.${joined[0].id}&select=id`, undefined, token, 'DELETE')
      check('participant cancellation passes session-gated user policy', cancelled[0]?.id === joined[0].id)
      for (let i = 0; i < 5; i++) assert.deepEqual(await login(marker, 'wrong'), [])
    }
    // Expire ONLY the synthetic account's lock; never shorten real users' locks.
    sql(`update private.login_attempt_guard set locked_until=clock_timestamp()-interval '1 second' where user_id=${fixtureId};`)
    check('expired lock permits normal login', Boolean((await login(marker))[0]?.token))
    for (const role of ['leader', 'admin', 'developer']) {
      sql(`update app_users set role='${role}' where id=${fixtureId};`)
      const session = await login(marker)
      check(`${role} login preserves role and directory access`, session[0]?.role === role
        && Boolean(session[0]?.token)
        && (await rest(`app_users?select=id&id=eq.${fixtureId}`, undefined, session[0].token)).length === 1)
    }
    sql(`update app_users set approval_status='pending' where id=${fixtureId};`)
    const pending = await login(marker)
    check('pending account keeps approval response without token', pending[0]?.approval_status === 'pending' && pending[0]?.token === null)
    sql(`update app_users set approval_status='approved',is_active=false where id=${fixtureId};`)
    const blocked = await login(marker)
    check('inactive account keeps blocked response without token', blocked[0]?.approval_status === 'blocked' && blocked[0]?.token === null)
    check('inactive session loses directory access', (await rest(`app_users?select=id&id=eq.${fixtureId}`, undefined, token)).length === 0)
  } finally {
    if (eventId) sql(`delete from comments where target_type='calendar_event' and target_id=${eventId};
      delete from notifications where user_id in (${fixtureId},${actorId}); delete from calendar_events where id=${eventId};`)
    if (actorId) sql(`delete from notifications where user_id=${actorId}; delete from login_logs where user_id=${actorId};
      delete from auth_sessions where user_id=${actorId}; delete from app_users where id=${actorId} and login_id='${marker}_admin';`)
    if (fixtureId) {
      sql(`delete from login_logs where user_id=${fixtureId}; delete from auth_sessions where user_id=${fixtureId};
        delete from app_users where id=${fixtureId} and login_id='${marker}';`)
      assert.equal(sql(`select count(*) from app_users where id=${fixtureId}`), '0')
      assert.equal(sql(`select count(*) from private.login_attempt_guard where user_id=${fixtureId}`), '0')
      console.log('Synthetic account, sessions, login logs and lock state removed')
    }
  }
  const report = { target: project, at: new Date().toISOString(), checks, productionTouched: false }
  mkdirSync('scratch', { recursive: true })
  writeFileSync('scratch/login-security-demo-results.json', `${JSON.stringify(report, null, 2)}\n`)
  console.log(`PASS ${checks.length} live demo checks`)
}
