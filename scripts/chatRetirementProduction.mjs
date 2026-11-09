import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdirSync, chmodSync, cpSync } from 'node:fs'
import { parseEnv } from 'node:util'
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { resolve } from 'node:path'

const project = 'qdxemvdorasoryfysuoq'
const mode = process.argv[2]
assert.ok(['inspect', 'backup', 'apply', 'smoke'].includes(mode))
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
function run(command, args, input, extra = {}) {
  const r = spawnSync(command, args, { env: { ...env, ...extra }, input, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  if (r.error || r.status) throw r.error ?? Error(r.stderr || `${command} failed`)
  return r.stdout.trim()
}
const sql = q => run('psql', ['-X', '-At', '-v', 'ON_ERROR_STOP=1'], q)
const migration = readFileSync('supabase/migrations/20261109_2100_retire_chat_writes.sql', 'utf8')
const predicate = migration.match(/DELETE FROM public.notifications\s+WHERE ([\s\S]+?);/)[1]
const funcs = "n.nspname='public' and p.proname in ('send_chat_message','send_chat_image','create_system_chat_message')"
const state = () => JSON.parse(sql(`select json_build_object(
  'functions',(select json_agg(json_build_object('signature',p.oid::regprocedure::text,'md5',md5(pg_get_functiondef(p.oid)),'acl',p.proacl) order by p.oid::regprocedure::text) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where ${funcs}),
  'uploadPolicies',(select coalesce(json_agg(row_to_json(x)),'[]'::json) from (select * from pg_policies where schemaname='storage' and tablename='objects' and policyname='chat_attachments_upload') x),
  'deleteCounts',(select coalesce(json_object_agg(type,c),'{}'::json) from (select type,count(*) c from notifications where ${predicate} group by type) x),
  'messages',(select count(*) from chat_messages));`))
const exact = s => { assert.equal(s.functions.length, 3); assert.deepEqual(s.deleteCounts, { chat: 33 }); assert.equal(s.uploadPolicies.length, 1) }
if (mode === 'inspect') {
  console.log(JSON.stringify(state(), null, 2))
} else if (mode === 'backup') {
  const before = state()
  exact(before)
  const dir = resolve('backups', `chat-retirement-production-${Date.now()}`)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  console.log(run('npm', ['run', 'backup'], undefined, config))
  const day = new Date().toLocaleDateString('en-CA')
  const meta = JSON.parse(readFileSync(`backups/${day}/_meta.json`, 'utf8'))
  assert.equal(meta.supabaseUrl, config.VITE_SUPABASE_URL)
  assert.equal(meta.tablesFailed, 0)
  for (const table of ['chat_messages','chat_read_status','chat_message_signals','chat_room_mutes','notifications','comments']) {
    assert.ok(Array.isArray(JSON.parse(readFileSync(`backups/${day}/${table}.json`, 'utf8'))))
  }
  cpSync(`backups/${day}`, resolve(dir, 'json'), { recursive: true })
  const dump = resolve(dir, 'before.dump')
  run('pg_dump', ['--format=custom', '--no-owner', '--schema=public', '--schema=storage', '--file', dump])
  chmodSync(dump, 0o600)
  run('pg_restore', ['--list', dump])
  const definitions = sql(`select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where ${funcs}`)
  const grants = sql(`select format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated;',p.oid::regprocedure)
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace where ${funcs};
    select format('GRANT %s ON FUNCTION %s TO %s%s;',a.privilege_type,p.oid::regprocedure,
      case when a.grantee=0 then 'PUBLIC' else quote_ident(pg_get_userbyid(a.grantee)) end,
      case when a.is_grantable then ' WITH GRANT OPTION' else '' end)
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace,
      lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where ${funcs};`)
  const policy = sql(`select format('CREATE POLICY %I ON storage.objects AS %s FOR %s TO %s%s%s;',
    policyname,permissive,cmd,array_to_string(array(select quote_ident(r) from unnest(roles) r),','),
    case when qual is null then '' else ' USING ('||qual||')' end,
    case when with_check is null then '' else ' WITH CHECK ('||with_check||')' end)
    from pg_policies where schemaname='storage' and tablename='objects' and policyname='chat_attachments_upload';`)
  writeFileSync(resolve(dir, 'rollback.sql'), `${definitions}\n${grants}\nDROP POLICY IF EXISTS chat_attachments_upload ON storage.objects;\n${policy}\nNOTIFY pgrst,'reload schema';\n`)
  const targets = JSON.parse(sql(`select json_agg(n order by id) from notifications n where ${predicate}`))
  assert.equal(targets.length, 33)
  writeFileSync(resolve(dir, 'notifications-to-delete.json'), JSON.stringify(targets, null, 2))
  assert.deepEqual(state(), before, 'State changed during backup; inspect again')
  writeFileSync(resolve(dir, 'manifest.json'), JSON.stringify({ project, at: new Date().toISOString(), before, migration, ids: targets.map(x => x.id) }, null, 2))
  console.log(`BACKUP ${dir}`)
} else if (mode === 'apply') {
  const dir = resolve(process.env.CHAT_BACKUP_DIR)
  const manifest = JSON.parse(readFileSync(resolve(dir, 'manifest.json'), 'utf8'))
  assert.equal(manifest.project, project)
  assert.equal(manifest.migration, migration)
  assert.ok(Date.now() - Date.parse(manifest.at) < 30 * 60 * 1000, 'Backup must be fresh')
  assert.deepEqual(state(), manifest.before, 'Production changed after backup')
  exact(manifest.before)
  run('pg_restore', ['--list', resolve(dir, 'before.dump')])
  assert.ok(manifest.ids.every(Number.isSafeInteger))
  // Lock only for the migration: recheck the exact approved rows and preserve all others.
  const guarded = `SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
    LOCK TABLE public.notifications IN SHARE ROW EXCLUSIVE MODE;
    DO $$ BEGIN
      IF (SELECT count(*) FROM notifications WHERE ${predicate}) <> 33
        OR EXISTS(SELECT 1 FROM notifications WHERE (${predicate}) AND id NOT IN (${manifest.ids.join(',')}))
      THEN RAISE EXCEPTION 'Chat notification targets changed'; END IF;
    END $$;
    CREATE TEMP TABLE preserved_notifications AS SELECT * FROM notifications WHERE (${predicate}) IS NOT TRUE;
    CREATE TEMP TABLE preserved_chat_messages AS SELECT * FROM chat_messages;
    ${migration}
    DO $$ BEGIN
      IF EXISTS(SELECT * FROM preserved_notifications EXCEPT SELECT * FROM notifications)
        OR EXISTS(SELECT * FROM notifications EXCEPT SELECT * FROM preserved_notifications)
        OR EXISTS(SELECT * FROM preserved_chat_messages EXCEPT SELECT * FROM chat_messages)
        OR EXISTS(SELECT * FROM chat_messages EXCEPT SELECT * FROM preserved_chat_messages)
        OR EXISTS(SELECT 1 FROM notifications WHERE ${predicate})
      THEN RAISE EXCEPTION 'Unexpected data change during chat retirement'; END IF;
    END $$;`
  console.log(run('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '--single-transaction', '-f', '-'], guarded))
  const after = state()
  assert.deepEqual(after.deleteCounts, {})
  assert.equal(after.uploadPolicies.length, 0)
  assert.equal(after.messages, manifest.before.messages)
  writeFileSync(resolve(dir, 'after.json'), JSON.stringify(after, null, 2))
  console.log('PASS exactly 33 approved chat alerts removed; every other notification and message preserved')
} else {
  assert.deepEqual(state().deleteCounts, {})
  const marker = `chat_retirement_prod_${randomBytes(6).toString('hex')}`
  const pin = randomBytes(16).toString('hex')
  const ids = [], checks = []
  let eventId
  const check = (name, condition) => { assert.ok(condition, name); checks.push(name); console.log(`PASS ${name}`) }
  const request = async (path, body, token, method, ok = true) => {
    const response = await fetch(`${config.VITE_SUPABASE_URL}/rest/v1/${path}`, {
      method: method ?? (body === undefined ? 'GET' : 'POST'),
      headers: { apikey: config.VITE_SUPABASE_ANON_KEY, 'Content-Type': 'application/json', Prefer: 'return=representation',
        ...(token ? { 'x-session-token': token } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30000),
    })
    const data = await response.json()
    assert.equal(response.ok, ok, JSON.stringify(data))
    return data
  }
  try {
    for (const [suffix, role] of [['writer','admin'],['reader','leader']]) {
      ids.push(Number(sql(`insert into app_users(login_id,name,pin,role,approval_status,is_active)
        values('${marker}_${suffix}','${marker}_${suffix}',extensions.crypt('${pin}',extensions.gen_salt('bf',6)),'${role}','approved',true) returning id;`).split('\n')[0]))
    }
    assert.ok(ids.every(id => Number.isSafeInteger(id) && id > 0))
    const tokens = []
    for (const suffix of ['writer','reader']) tokens.push((await request('rpc/auth_login', { p_login_id: `${marker}_${suffix}`, p_pin: pin }))[0].token)
    eventId = Number(sql(`insert into calendar_events(event_date,title,time,leader_name,allow_applications)
      values('2030-01-01','${marker}','10:00','${marker}_reader',true) returning id;`).split('\n')[0])
    const baseline = sql(`select count(*) from chat_messages where event_id=${eventId}; select count(*) from event_participants where event_id=${eventId}; select count(*) from notifications where user_id in (${ids.join(',')});`)
    for (const [fn, args] of [
      ['send_chat_message', { p_content: marker }], ['send_chat_image', { p_image_url: 'https://example.invalid/image.png' }],
      ['create_system_chat_message', { p_content: marker }],
    ]) {
      const response = await request(`rpc/${fn}`, { p_token: tokens[0], p_event_id: eventId, ...args }, tokens[0], 'POST', false)
      check(`${fn} denied`, response.message?.includes('채팅이 종료되었습니다'))
    }
    check('no auto-join, message or alert from denied chat writes', baseline === sql(`select count(*) from chat_messages where event_id=${eventId}; select count(*) from event_participants where event_id=${eventId}; select count(*) from notifications where user_id in (${ids.join(',')});`))
    check('old-client chat read RPC remains allowed', Array.isArray(await request('rpc/get_my_chat_reads', { p_token: tokens[0] }, tokens[0])))
    const upload = await fetch(`${config.VITE_SUPABASE_URL}/storage/v1/object/chat-attachments/${marker}.png`, {
      method: 'POST', headers: { apikey: config.VITE_SUPABASE_ANON_KEY, Authorization: `Bearer ${config.VITE_SUPABASE_ANON_KEY}`,
        'x-session-token': tokens[0], 'Content-Type': 'image/png' },
      body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a/QsAAAAASUVORK5CYII=', 'base64'), signal: AbortSignal.timeout(30000),
    })
    const result = await upload.json()
    check('valid photo upload denied by RLS', !upload.ok && /row-level security/i.test(result.message ?? ''))
    for (const mention of [false, true]) {
      const rows = await request('comments?select=id', { target_type: 'calendar_event', target_id: eventId,
        author_id: ids[0], author_name: `${marker}_writer`, content: `${marker} ${mention ? '@'+marker+'_reader' : 'comment'}`,
        mention_ids: mention ? [ids[1]] : [], mention_names: mention ? [`${marker}_reader`] : [] }, tokens[0])
      const list = await request(`comments?select=id&target_type=eq.calendar_event&target_id=eq.${eventId}`, undefined, tokens[1])
      check(`other account reads ${mention ? 'mention' : 'plain'} comment`, list.some(x => x.id === rows[0].id))
      const notices = await request('rpc/get_my_notifications', { p_token: tokens[1], p_limit: 50 }, tokens[1])
      check(`other account receives ${mention ? 'mention' : 'comment'} notification with event link`, notices.some(x => x.related_id === rows[0].id && x.type === (mention ? 'mention' : 'comment') && x.link === `/calendar?openEvent=${eventId}`))
    }
    const changed = await request(`calendar_events?id=eq.${eventId}&select=id`, { title: `${marker}_updated` }, tokens[0], 'PATCH')
    check('test event update persisted', changed[0]?.id === eventId)
    const notices = await request('rpc/get_my_notifications', { p_token: tokens[1], p_limit: 50 }, tokens[1])
    check('leader still receives event-change notification', notices.some(x => x.type === 'event_change' && x.related_id === eventId))
  } finally {
    if (eventId) sql(`delete from comments where target_type='calendar_event' and target_id=${eventId}; delete from calendar_events where id=${eventId};`)
    if (ids.length) sql(`delete from notifications where user_id in (${ids.join(',')}); delete from login_logs where user_id in (${ids.join(',')}); delete from auth_sessions where user_id in (${ids.join(',')}); delete from app_users where id in (${ids.join(',')}) and login_id like '${marker}%';`)
    check('synthetic accounts and event cleaned up', sql(`select count(*) from app_users where login_id like '${marker}%'; select count(*) from calendar_events where title like '${marker}%';`) === '0\n0')
  }
  mkdirSync('scratch', { recursive: true })
  writeFileSync('scratch/chat-retirement-production-results.json', JSON.stringify({ project, at: new Date().toISOString(), checks }, null, 2))
}
