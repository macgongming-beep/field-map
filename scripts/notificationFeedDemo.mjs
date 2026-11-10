import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { parseEnv } from 'node:util'
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { resolve } from 'node:path'

const mode = process.argv[2]
assert.ok(['apply', 'smoke'].includes(mode) && process.argv.includes('--confirm-demo'))
const config = parseEnv(readFileSync(process.env.DEMO_ENV_FILE, 'utf8'))
const project = 'itjlykpjmlcvanqpmkmc'
const origin = `https://${project}.supabase.co`
const app = 'https://chinese-territory-app-demo.vercel.app'
const db = new URL(config.SUPABASE_DB_URL)
assert.equal(config.VITE_SUPABASE_URL, origin)
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
const sql = q => run('psql', ['-X', '-Atq', '-v', 'ON_ERROR_STOP=1'], q)
const protectedFunctions = `('get_my_notifications','notify_on_comment','insert_notifications',
  'dispatch_push_notification','filter_notification_recipients','mark_notification_read',
  'mark_all_notifications_read','clear_read_notifications')`
const definitions = () => sql(`select pg_get_functiondef(oid) from pg_proc where
  pronamespace='public'::regnamespace and proname in ${protectedFunctions} order by oid`)
const policies = () => sql("select jsonb_agg(p order by schemaname,tablename,policyname) from pg_policies p")
if (mode === 'apply') {
  assert.equal(sql("select count(*) from pg_proc where pronamespace='public'::regnamespace and proname='get_my_notification_feed'"), '0')
  const dir = resolve('backups', `notification-feed-demo-${Date.now()}`)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const dump = resolve(dir, 'before.dump')
  run('pg_dump', ['--format=custom', '--no-owner', '--schema=public', '--schema=private', '--file', dump])
  run('pg_restore', ['--list', dump])
  const before = definitions(), beforePolicies = policies()
  writeFileSync(resolve(dir, 'unchanged-functions.sql'), before)
  writeFileSync(resolve(dir, 'rollback.sql'), "DROP FUNCTION public.get_my_notification_feed(uuid,integer);\nNOTIFY pgrst,'reload schema';\n")
  run('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '--single-transaction', '-f', 'supabase/migrations/20261110_1600_notification_feed_without_comments.sql'])
  assert.equal(definitions(), before)
  assert.equal(policies(), beforePolicies)
  const audit = run('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-f', 'supabase/tools/_AUDIT_anon이_부를수있는_definer.sql'])
  writeFileSync(resolve(dir, 'definer-audit.txt'), audit)
  assert.match(audit, /get_my_notification_feed.*읽기.*검사있음/)
  console.log(JSON.stringify({ backup: dir, existingFunctionsAndAllPoliciesUnchanged: true, newRpcAuthenticatedRead: true }))
  process.exit(0)
}

const checks = [], f = { marker: `notification_feed_${randomBytes(6).toString('hex')}`, actors: [], eventId: null }
const check = (name, value) => { assert.ok(value, name); checks.push(name); console.log(`PASS ${name}`) }
async function rest(path, body, token, ok = true) {
  const response = await fetch(`${origin}/rest/v1/${path}`, {
    method: 'POST', headers: { apikey: config.VITE_SUPABASE_ANON_KEY, 'Content-Type': 'application/json',
      Prefer: 'return=representation', ...(token ? { 'x-session-token': token } : {}) },
    body: JSON.stringify(body), signal: AbortSignal.timeout(20_000),
  })
  const text = await response.text()
  const data = text ? JSON.parse(text) : null
  assert.equal(response.ok, ok, JSON.stringify(data))
  return data
}
const beforeFunctions = definitions()
try {
  for (const role of ['user', 'leader']) {
    const name = `${f.marker}_${role}`, pin = randomBytes(16).toString('hex')
    const id = Number(sql(`insert into app_users(login_id,name,pin,role,approval_status,is_active) values
      ('${name}','${name}',extensions.crypt('${pin}',extensions.gen_salt('bf',6)),'${role}','approved',true) returning id`))
    const actor = { id, name, role }
    f.actors.push(actor)
    actor.token = (await rest('rpc/auth_login', { p_login_id: name, p_pin: pin }))[0].token
  }
  const [writer, reader] = f.actors
  f.eventId = Number(sql(`insert into calendar_events(event_date,time,title,type,place,leader_name,allow_applications)
    values((now() at time zone 'Asia/Seoul')::date,'10:00','${f.marker}','주택','테스트','${reader.name}',true) returning id`))
  const args = { p_token: reader.token, p_limit: 50 }
  const full = name => rest(`rpc/${name}`, args, reader.token)
  const postComment = mention => rest('comments?select=id', { target_type: 'calendar_event', target_id: f.eventId,
    author_id: writer.id, author_name: writer.name, content: `${f.marker} ${mention ? 'mention' : 'ordinary'}`,
    mention_ids: mention ? [reader.id] : [], mention_names: mention ? [reader.name] : [] }, writer.token)
  const ordinary = (await postComment(false))[0], mention = (await postComment(true))[0]
  check('ordinary comment and mention saved by authenticated API', ordinary.id > 0 && mention.id > 0)
  check('ordinary notification still generated', Number(sql(`select count(*) from notifications where user_id=${reader.id} and type='comment' and related_id=${ordinary.id}`)) === 1)
  check('comment mention still generated', Number(sql(`select count(*) from notifications where user_id=${reader.id} and type='mention' and related_id=${mention.id}`)) === 1)
  const mentionRows = (await full('get_my_notification_feed')).filter(n => n.type === 'mention' && n.related_id === mention.id)
  check('mention body and event link retained', mentionRows.length === 1 && mentionRows[0].body.includes(f.marker) && mentionRows[0].link === `/calendar?openEvent=${f.eventId}`)

  // Fill beyond LIMIT so the test distinguishes server filtering from UI filtering.
  sql(`insert into notifications(user_id,type,title,body,link,related_id,created_at)
    select ${reader.id},'comment','hidden comment','${f.marker}','/calendar?openEvent=${f.eventId}',${ordinary.id},now()+interval '1 minute'
    from generate_series(1,60)`)
  const oldRows = await full('get_my_notifications'), newRows = await full('get_my_notification_feed')
  check('old reader remains compatible with 50 recent hidden comments', oldRows.length === 50 && oldRows.every(n => n.type === 'comment'))
  check('new reader filters before LIMIT and keeps older mention', newRows.every(n => n.type !== 'comment') && newRows.some(n => n.id === mentionRows[0].id))
  check('reader cannot obtain writer notifications', newRows.every(n => n.user_id === reader.id))
  const columns = 'id,user_id,type,link,related_id,is_read,created_at'
  const badgeRows = await rest(`rpc/get_my_notification_feed?select=${columns}`, args, reader.token)
  check('badge projection retains IDs/read state without body', badgeRows.every(n => !('title' in n) && !('body' in n)) && JSON.stringify(badgeRows.map(n => [n.id,n.is_read])) === JSON.stringify(newRows.map(n => [n.id,n.is_read])))
  for (const token of [null, '00000000-0000-0000-0000-000000000000']) {
    await rest('rpc/get_my_notification_feed', { p_token: token }, undefined, false)
    check('invalid or missing session rejected', true)
  }
  await rest('rpc/mark_notification_read', { p_token: reader.token, p_notification_id: mentionRows[0].id }, reader.token)
  check('single read still persists', (await full('get_my_notification_feed')).find(n => n.id === mentionRows[0].id)?.is_read)
  const hiddenUnread = sql(`select count(*) from notifications where user_id=${reader.id} and type='comment' and not is_read`)
  check('filtered reads do not mark hidden comments', Number(hiddenUnread) === 61)

  // pg_net processes requests after COMMIT. Inspect the actual push queue inside
  // a transaction, then roll it back; no device notification is sent by this probe.
  const pushProbe = sql(`begin;
    do $probe$ begin
      perform set_config('app.push_edge_function_url','https://notification-probe.invalid/push',true);
      perform set_config('app.push_edge_function_key','transaction-only-probe',true);
    end $probe$;
    insert into comments(target_type,target_id,author_id,author_name,content,mention_ids,mention_names)
      values('calendar_event',${f.eventId},${writer.id},'${writer.name}','${f.marker} queue ordinary','{}','{}'),
      ('calendar_event',${f.eventId},${writer.id},'${writer.name}','${f.marker} queue mention',array[${reader.id}],array['${reader.name}']);
    select coalesce(jsonb_agg(convert_from(body,'UTF8')::jsonb->>'type' order by convert_from(body,'UTF8')::jsonb->>'type'),'[]')
      from net.http_request_queue where (convert_from(body,'UTF8')::jsonb->>'related_id')::integer in
        (select id from comments where author_id=${writer.id} and target_id=${f.eventId}
          and content in ('${f.marker} queue ordinary','${f.marker} queue mention'));
    rollback;`)
  const pushTypes = JSON.parse(pushProbe)
  check('actual ordinary and mention push dispatch both queue requests', pushTypes.includes('comment') && pushTypes.includes('mention'))

  const sizes = { oldRows: oldRows.length, newRows: newRows.length,
    oldJsonBytes: Buffer.byteLength(JSON.stringify(oldRows)), newJsonBytes: Buffer.byteLength(JSON.stringify(newRows)),
    oldGzipBytes: gzipSync(JSON.stringify(oldRows)).length, newGzipBytes: gzipSync(JSON.stringify(newRows)).length }
  let browserResults = null
  if (process.env.PLAYWRIGHT_MODULE) {
    const { chromium } = await import(process.env.PLAYWRIGHT_MODULE)
    const browser = await chromium.launch({ headless: true })
    try {
      const context = await browser.newContext({ viewport: { width: 430, height: 932 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' })
      await context.route('**/*.supabase.co/**', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort())
      await context.addInitScript(({ actor, app }) => {
        if (location.origin !== app) return
        localStorage.setItem('auth_token', actor.token)
        localStorage.setItem('auth_session', JSON.stringify({ id: actor.id, loginId: actor.name, name: actor.name, role: actor.role, phone: null, authToken: actor.token }))
        localStorage.setItem('currentVisitor', actor.name)
      }, { actor: reader, app })
      const page = await context.newPage(), reads = [], errors = []
      page.on('pageerror', e => errors.push(e.message))
      page.on('request', req => {
        if (/\/rpc\/get_my_notification/.test(req.url()) && req.method() === 'POST') reads.push({ name: new URL(req.url()).pathname.split('/').at(-1), badge: new URL(req.url()).searchParams.has('select') })
      })
      await page.goto(app, { waitUntil: 'networkidle' })
      const bell = page.getByRole('button', { name: /^알림(?: \d+개)?$/ }).first()
      await bell.click()
      await page.locator('.notification-row').first().waitFor()
      check('deployed demo renders mention, not ordinary comments', (await page.locator('.notification-row').allTextContents()).some(t => t.includes(f.marker)) && !(await page.locator('.notification-row').allTextContents()).some(t => t.includes('hidden comment')))
      await page.screenshot({ path: 'scratch/demo-notification-comment-skip.png', fullPage: true })
      check('deployed demo badge and panel use new RPC exclusively', reads.length >= 2 && reads.every(r => r.name === 'get_my_notification_feed') && reads.some(r => r.badge) && reads.some(r => !r.badge))
      await page.locator('.notification-row').first().click()
      await page.getByText(`${f.marker} ordinary`, { exact: true }).waitFor()
      await page.getByText(`${f.marker} mention`, { exact: true }).waitFor()
      // The calendar consumes openEvent and removes it after opening the sheet.
      check('mention opens event detail with both ordinary and mentioned comments intact',
        new URL(page.url()).pathname === '/calendar'
        && await page.getByText(`${f.marker} ordinary`, { exact: true }).isVisible()
        && await page.getByText(`${f.marker} mention`, { exact: true }).isVisible())
      await page.screenshot({ path: 'scratch/demo-notification-mention-comments.png', fullPage: true })
      check('no browser errors', errors.length === 0)
      browserResults = { reads, errors }
    } finally { await browser.close() }
  }
  await rest('rpc/mark_all_notifications_read', { p_token: reader.token }, reader.token)
  check('mark all retains existing behavior', Number(sql(`select count(*) from notifications where user_id=${reader.id} and not is_read`)) === 0)
  await rest('rpc/clear_read_notifications', { p_token: reader.token }, reader.token)
  check('clear read retains existing behavior', (await full('get_my_notification_feed')).length === 0)
  check('notification and push functions unchanged', definitions() === beforeFunctions)
  writeFileSync('scratch/notification-feed-demo-results.json', JSON.stringify({ project, at: new Date().toISOString(), checks, sizes, pushTypes, browserResults }, null, 2))
  console.log(JSON.stringify({ checks: checks.length, sizes, pushTypes, browserResults }))
} finally {
  if (f.actors.length) {
    const ids = f.actors.map(a => { assert.ok(Number.isSafeInteger(a.id)); return a.id }).join(',')
    if (f.eventId) sql(`delete from comments where target_type='calendar_event' and target_id=${f.eventId} and author_id in (${ids}); delete from calendar_events where id=${f.eventId} and title='${f.marker}';`)
    sql(`delete from notifications where user_id in (${ids}); delete from service_logs where actor_id in (${ids});
      delete from login_logs where user_id in (${ids}); delete from auth_sessions where user_id in (${ids});
      delete from private.login_attempt_guard where user_id in (${ids});
      delete from app_users where id in (${ids}) and login_id like '${f.marker}%';`)
    assert.equal(sql(`select count(*) from app_users where id in (${ids})`), '0')
    console.log('Exact demo fixture cleaned')
  }
}
