import assert from 'node:assert/strict'
import { readFileSync, mkdirSync, writeFileSync, chmodSync } from 'node:fs'
import { parseEnv } from 'node:util'
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { resolve } from 'node:path'

const mode = process.argv[2]
assert.ok(['apply', 'smoke', 'ui-prepare', 'ui-clean'].includes(mode) && process.argv.includes('--confirm-demo'))
const config = parseEnv(readFileSync(process.env.DEMO_ENV_FILE, 'utf8'))
const db = new URL(config.SUPABASE_DB_URL)
const project = 'itjlykpjmlcvanqpmkmc'
assert.equal(decodeURIComponent(db.username), `postgres.${project}`)
assert.equal(config.VITE_SUPABASE_URL, `https://${project}.supabase.co`)
assert.ok(db.hostname.endsWith('.pooler.supabase.com'))
const env = { ...process.env, PGHOST: db.hostname, PGPORT: db.port, PGUSER: decodeURIComponent(db.username),
  PGDATABASE: db.pathname.slice(1), PGPASSWORD: decodeURIComponent(db.password), PGSSLMODE: 'require' }
function run(command, args, input) {
  const r = spawnSync(command, args, { env, input, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
  if (r.error || r.status) throw r.error ?? Error(r.stderr)
  return r.stdout.trim()
}
const sql = q => run('psql', ['-X', '-At', '-v', 'ON_ERROR_STOP=1'], q)
const migration = 'supabase/migrations/20261109_2100_retire_chat_writes.sql'
const funcs = "n.nspname='public' and p.proname in ('send_chat_message','send_chat_image','create_system_chat_message')"
if (mode === 'ui-prepare') {
  const marker = `chat_retirement_ui_${randomBytes(6).toString('hex')}`
  const eventId = Number(sql(`insert into calendar_events(event_date,title,time,leader_name,allow_applications)
    values(current_date,'${marker}','10:00','관리자',true) returning id;`).split('\n')[0])
  writeFileSync('scratch/chat-retirement-ui-fixture.json', JSON.stringify({ marker, eventId }, null, 2))
  console.log(JSON.stringify({ marker, eventId }))
} else if (mode === 'ui-clean') {
  const { marker, eventId } = JSON.parse(readFileSync('scratch/chat-retirement-ui-fixture.json', 'utf8'))
  assert.match(marker, /^chat_retirement_ui_[a-f0-9]+$/)
  assert.ok(Number.isSafeInteger(eventId) && eventId > 0)
  assert.equal(sql(`select title from calendar_events where id=${eventId}`), marker)
  sql(`delete from notifications where (type in ('comment','mention') and related_id in
    (select id from comments where target_type='calendar_event' and target_id=${eventId}))
    or (type='event_change' and related_id=${eventId});
    delete from comments where target_type='calendar_event' and target_id=${eventId};
    delete from calendar_events where id=${eventId};`)
  console.log('UI fixture and its comments/alerts removed')
} else if (mode === 'apply') {
  assert.equal(sql(`select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where ${funcs}`), '3')
  const dir = resolve('backups', `chat-retirement-demo-${Date.now()}`)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const dump = resolve(dir, 'before.dump')
  run('pg_dump', ['--format=custom', '--no-owner', '--no-privileges', '--schema=public', '--schema=storage', '--file', dump])
  chmodSync(dump, 0o600)
  run('pg_restore', ['--list', dump])
  const definitions = sql(`select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where ${funcs}`)
  const policies = sql(`select format('CREATE POLICY %I ON storage.objects AS %s FOR %s TO %s WITH CHECK (%s);',
    policyname,permissive,cmd,array_to_string(array(select quote_ident(r) from unnest(roles) r),','),with_check)
    from pg_policies where schemaname='storage' and policyname='chat_attachments_upload';`)
  writeFileSync(resolve(dir, 'rollback.sql'), `${definitions}\nDROP POLICY IF EXISTS chat_attachments_upload ON storage.objects;\n${policies}\nNOTIFY pgrst,'reload schema';\n`, { mode: 0o600 })
  const before = sql('select count(*) from chat_messages; select count(*) from notifications;')
  run('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '--single-transaction', '-f', migration])
  console.log(JSON.stringify({ backup: dir, before, after: sql('select count(*) from chat_messages; select count(*) from notifications;') }))
} else {
  const marker = `chat_retirement_${randomBytes(6).toString('hex')}`
  const pin = randomBytes(16).toString('hex')
  const ids = []
  let eventId
  const checks = []
  const check = (label, value) => { assert.ok(value, label); checks.push(label); console.log(`PASS ${label}`) }
  async function request(path, body, token, expected = true, method) {
    const response = await fetch(`${config.VITE_SUPABASE_URL}/rest/v1/${path}`, {
      method: method ?? (body === undefined ? 'GET' : 'POST'),
      headers: { apikey: config.VITE_SUPABASE_ANON_KEY, 'Content-Type': 'application/json', Prefer: 'return=representation',
        ...(token ? { 'x-session-token': token } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30_000),
    })
    const data = await response.json()
    assert.equal(response.ok, expected, JSON.stringify(data))
    return data
  }
  try {
    for (const suffix of ['writer','reader']) {
      const name = `${marker}_${suffix}`
      ids.push(Number(sql(`insert into app_users(login_id,name,pin,role,approval_status,is_active)
        values('${name}','${name}',extensions.crypt('${pin}',extensions.gen_salt('bf',6)),'user','approved',true) returning id;`).split('\n')[0]))
    }
    const tokens = []
    for (const suffix of ['writer','reader']) tokens.push((await request('rpc/auth_login', { p_login_id: `${marker}_${suffix}`, p_pin: pin }))[0].token)
    eventId = Number(sql(`insert into calendar_events(event_date,title,time,leader_name,allow_applications)
      values(current_date,'${marker}','10:00','${marker}_reader',true) returning id;`).split('\n')[0])
    // Check migration cleanup using synthetic rows only; rerunning is idempotent.
    sql(`insert into notifications(user_id,type,title,body,link) values
      (${ids[1]},'chat','${marker}_old','test','/calendar?openChat=${eventId}'),
      (${ids[1]},'mention','${marker}_oldmention','test','/calendar?openChat=${eventId}'),
      (${ids[1]},'mention','${marker}_keepmention','test','/calendar?openEvent=${eventId}'),
      (${ids[1]},'event_change','${marker}_keepchange','test','/calendar?openChat=${eventId}');`)
    run('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '--single-transaction', '-f', migration])
    check('old chat alerts removed, comment mention and event-change retained',
      sql(`select string_agg(title,',' order by title) from notifications where user_id=${ids[1]}`) === `${marker}_keepchange,${marker}_keepmention`)
    const baseline = sql(`select count(*) from chat_messages; select count(*) from event_participants where event_id=${eventId}; select count(*) from notifications where user_id in (${ids.join(',')});`)
    for (const [name, args] of [
      ['send_chat_message', { p_content: 'must not send' }],
      ['send_chat_image', { p_image_url: 'https://example.invalid/image.jpg' }],
      ['create_system_chat_message', { p_content: 'must not join' }],
    ]) {
      const denied = await request(`rpc/${name}`, { p_token: tokens[0], p_event_id: eventId, ...args }, tokens[0], false)
      check(`${name} denied to old client`, denied.message?.includes('채팅이 종료되었습니다'))
    }
    check('denied writes do not create messages, participants or notifications', baseline === sql(`select count(*) from chat_messages; select count(*) from event_participants where event_id=${eventId}; select count(*) from notifications where user_id in (${ids.join(',')});`))
    check('chat read RPC remains usable', Array.isArray(await request('rpc/get_my_chat_reads', { p_token: tokens[0] }, tokens[0])))
    const upload = await fetch(`${config.VITE_SUPABASE_URL}/storage/v1/object/chat-attachments/${marker}.png`, {
      method: 'POST', headers: { apikey: config.VITE_SUPABASE_ANON_KEY, Authorization: `Bearer ${config.VITE_SUPABASE_ANON_KEY}`,
        'x-session-token': tokens[0], 'Content-Type': 'image/png' },
      body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a/QsAAAAASUVORK5CYII=', 'base64'), signal: AbortSignal.timeout(30_000),
    })
    const deniedUpload = await upload.json()
    assert.ok(!upload.ok, 'Unexpected upload success; remove only the synthetic object before continuing')
    check(`photo uploads denied by RLS (${deniedUpload.message ?? deniedUpload.error})`, /row-level security/i.test(deniedUpload.message ?? ''))
    const comments = []
    for (const mention of [false, true]) {
      const created = await request('comments?select=id', { target_type: 'calendar_event', target_id: eventId,
        author_id: ids[0], author_name: `${marker}_writer`, content: `${marker} ${mention ? '@'+marker+'_reader' : 'comment'}`,
        mention_ids: mention ? [ids[1]] : [], mention_names: mention ? [`${marker}_reader`] : [] }, tokens[0])
      comments.push(created[0].id)
      const list = await request(`comments?select=id&target_type=eq.calendar_event&target_id=eq.${eventId}`, undefined, tokens[1])
      check(`other account sees ${mention ? 'mention' : 'plain'} comment`, list.some(row => row.id === created[0].id))
      const notifications = await request('rpc/get_my_notifications', { p_token: tokens[1], p_limit: 50 }, tokens[1])
      check(`other account receives ${mention ? 'mention' : 'comment'} alert with event link`, notifications.some(row => row.type === (mention ? 'mention' : 'comment') && row.related_id === created[0].id && row.link === `/calendar?openEvent=${eventId}`))
    }
    writeFileSync('scratch/chat-retirement-demo-results.json', JSON.stringify({ timestamp: new Date().toISOString(), checks }, null, 2))
  } finally {
    if (eventId) sql(`delete from comments where target_type='calendar_event' and target_id=${eventId}; delete from calendar_events where id=${eventId};`)
    if (ids.length) sql(`delete from notifications where user_id in (${ids.join(',')}); delete from login_logs where user_id in (${ids.join(',')}); delete from auth_sessions where user_id in (${ids.join(',')}); delete from app_users where id in (${ids.join(',')});`)
  }
}
