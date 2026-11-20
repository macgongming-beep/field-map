import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdirSync, chmodSync, cpSync, existsSync } from 'node:fs'
import { parseEnv } from 'node:util'
import { spawnSync } from 'node:child_process'
import { createClient } from '@supabase/supabase-js'
import { DEMO_PROJECT, TEAM } from './deployDemo.mjs'
import { assignmentInventorySql, assertAssignmentInventory } from './assignmentDefinerInventory.mjs'

const mode = process.argv[2]
assert.ok(['inspect', 'apply', 'seed', 'audit', 'build'].includes(mode))
const origin = 'https://itjlykpjmlcvanqpmkmc.supabase.co'
const config = parseEnv(readFileSync(process.env.DEMO_ENV_FILE ?? '../chinese-territory-app/.env.test.local', 'utf8'))
assert.equal(config.VITE_SUPABASE_URL, origin)
const url = new URL(config.SUPABASE_DB_URL)
assert.equal(decodeURIComponent(url.username), 'postgres.itjlykpjmlcvanqpmkmc', 'Demo database only')
const dbEnv = { ...process.env, PGHOST: url.hostname, PGPORT: url.port || '5432', PGUSER: decodeURIComponent(url.username),
  PGDATABASE: url.pathname.slice(1), PGPASSWORD: decodeURIComponent(url.password), PGSSLMODE: 'require', PGCONNECT_TIMEOUT: '15' }
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { env: dbEnv, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, ...options })
  assert.equal(result.status, 0, result.stderr || `${command} failed`)
  return result.stdout.trim()
}
const sql = query => run('psql', ['-X', '-At', '-v', 'ON_ERROR_STOP=1'], { input: query })
const migration = 'supabase/migrations/20261120_1600_territory_group_assignments.sql'
const directory = 'backups/group-territory-demo'
const protectedTables = ['cards', 'card_leader_assignments', 'card_assignments', 'calendar_events', 'event_participants', 'event_card_assignments', 'event_card_assignment_cards', 'buildings', 'units', 'visit_histories', 'service_sessions']
const snapshot = () => JSON.parse(sql(`begin read only;select jsonb_build_object(${protectedTables.map(table => `'${table}',(select md5(coalesce(jsonb_agg(to_jsonb(t)-'group_assignment_revision' order by to_jsonb(t)::text)::text,'[]')) from public.${table} t)`).join(',')});rollback;`).split('\n').find(line => line.startsWith('{')))
if (mode === 'inspect') {
  console.log(JSON.stringify({ demo: true, installed: sql("select to_regclass('public.card_group_assignments') is not null") === 't',
    groups: JSON.parse(sql("select jsonb_agg(jsonb_build_object('code',code,'name',display_name,'active',is_active) order by sort_order) from service_groups")),
    cards: Number(sql('select count(*) from cards')) }))
} else if (mode === 'apply') {
  assert.ok(process.argv.includes('--confirm-demo'))
  assert.equal(sql("select to_regclass('public.card_group_assignments') is not null"), 'f', 'Already installed; do not replace')
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  assert.ok(!existsSync(`${directory}/before.dump`), 'Do not overwrite backup')
  run('pg_dump', ['--format=custom', '--no-owner', '--schema=public', '--schema=private', '--file', `${directory}/before.dump`])
  chmodSync(`${directory}/before.dump`, 0o600)
  run('pg_restore', ['--list', `${directory}/before.dump`])
  const before = snapshot()
  writeFileSync(`${directory}/before.json`, JSON.stringify(before), { mode: 0o600 })
  run('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '--single-transaction', '-c', "set local lock_timeout='5s';set local statement_timeout='60s'", '-f', migration])
  assert.deepEqual(snapshot(), before, 'Existing data changed')
  console.log(JSON.stringify({ demo: true, installed: true, existingDataUnchanged: true, backup: `${directory}/before.dump` }))
} else if (mode === 'seed') {
  assert.ok(process.argv.includes('--confirm-demo'))
  const unwrap = result => { assert.equal(result.error, null, JSON.stringify(result.error)); return result.data }
  const auth = { persistSession: false, autoRefreshToken: false }
  const login = unwrap(await createClient(origin, config.VITE_SUPABASE_ANON_KEY, { auth }).rpc('auth_login', { p_login_id: config.TEST_LOGIN_ID, p_pin: config.TEST_LOGIN_PIN }))[0]
  assert.ok(['admin', 'developer'].includes(login.role))
  const client = createClient(origin, config.VITE_SUPABASE_ANON_KEY, { auth, global: { headers: { 'x-session-token': login.token } } })
  const groups = unwrap(await client.from('service_groups').select('code,display_name').eq('is_active', true).order('sort_order'))
  const cards = unwrap(await client.from('cards').select('id,name,group_assignment_revision,card_group_assignments(group_code)').order('id').limit(4))
  assert.ok(cards.length === 4 && groups.length >= 2)
  assert.ok(cards.every(card => card.card_group_assignments.length === 0), 'Seed only untouched demo ownership')
  const before = snapshot()
  const plan = [{ code: groups[0].code, ids: [cards[0].id, cards[1].id] }, { code: groups[1].code, ids: [cards[0].id, cards[2].id] }]
  if (groups[2]) plan.push({ code: groups[2].code, ids: [cards[3].id] })
  if (groups[3]) plan.push({ code: groups[3].code, ids: [cards[3].id] })
  for (const entry of plan) {
    const current = unwrap(await client.from('cards').select('id,group_assignment_revision').in('id', entry.ids))
    unwrap(await client.rpc('set_territory_group_assignments_tx', { p_token: login.token, p_group_code: entry.code, p_card_ids: entry.ids, p_action: 'add',
      p_expected: Object.fromEntries(current.map(card => [card.id, String(card.group_assignment_revision)])) }))
  }
  assert.deepEqual(snapshot(), before, 'Legacy data changed while seeding')
  const result = { demo: true, plan, cards: cards.map(card => ({ id: card.id, name: card.name })), groups, legacyDataUnchanged: true }
  writeFileSync('scratch/group-territory-demo-seed.json', JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result))
} else if (mode === 'audit') {
  assert.deepEqual(snapshot(), JSON.parse(readFileSync(`${directory}/before.json`, 'utf8')), 'Existing territory, visits or event data changed')
  const inventory = assertAssignmentInventory(JSON.parse(sql(assignmentInventorySql)))
  const audit = run('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-f', 'supabase/tools/_AUDIT_anon이_부를수있는_definer.sql'])
  writeFileSync('scratch/group-territory-definers.txt', audit)
  const privileges = JSON.parse(sql(`select jsonb_build_object(
    'read',has_function_privilege('anon','public.can_read_group_territories()','execute'),
    'save',has_function_privilege('anon','public.set_territory_group_assignments_tx(uuid,text,integer[],text,jsonb)','execute'),
    'trigger',has_function_privilege('anon','private.track_territory_group_revision()','execute'),
    'directWrite',has_table_privilege('anon','public.card_group_assignments','INSERT,UPDATE,DELETE'))`))
  assert.deepEqual(privileges, { read: true, save: true, trigger: false, directWrite: false })
  const auth = { persistSession: false, autoRefreshToken: false }
  const fixture = JSON.parse(readFileSync('scratch/group-tabs-fixture.json', 'utf8'))
  const roles = []
  for (const role of ['leader','user']) {
    const actor = fixture.actors.find(item => item.role === role)
    const signed = await createClient(origin, config.VITE_SUPABASE_ANON_KEY, { auth }).rpc('auth_login', { p_login_id: actor.name, p_pin: '0000' })
    assert.equal(signed.error, null);const login = signed.data[0];assert.equal(login.role,role)
    const client = createClient(origin, config.VITE_SUPABASE_ANON_KEY, { auth, global: { headers: { 'x-session-token': login.token } } })
    const read = await client.from('card_group_assignments').select('card_id,group_code')
    assert.equal(read.error,null)
    if (role === 'leader') assert.ok(read.data.length > 0);else assert.equal(read.data.length,0)
    const write = await client.rpc('set_territory_group_assignments_tx', { p_token:login.token,p_group_code:'dongtan',p_card_ids:[1],p_action:'remove',p_expected:{1:'0'} })
    assert.equal(write.error?.code,'42501')
    roles.push({ role,readableLinks:read.data.length,writeDenied:true })
  }
  const anonymous = await createClient(origin,config.VITE_SUPABASE_ANON_KEY,{auth}).from('card_group_assignments').select('card_id')
  assert.equal(anonymous.error,null);assert.deepEqual(anonymous.data,[])
  const result={demo:true,legacyDataUnchanged:true,assignmentDefiners:inventory.length,privileges,roles,anonymousLinks:0}
  writeFileSync('scratch/group-territory-db-audit.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result))
} else {
  const flags = { ...JSON.parse(readFileSync('scratch/sections-matched-nov20/build-env.json', 'utf8')), VITE_GROUP_TERRITORY_ENABLED: 'true' }
  assert.equal(flags.VITE_SUPABASE_URL, origin)
  assert.ok(flags.VITE_VAPID_PUBLIC_KEY)
  const clean = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('VITE_') && !key.startsWith('SENTRY_')))
  const output = run('npm', ['run', 'build', '--', '--outDir', 'scratch/group-territory-dist'], { env: { ...clean, ...flags } })
  writeFileSync('scratch/group-territory-build.log', output)
  const stage = process.env.DEMO_ARTIFACT ?? 'scratch/group-territory-release'
  assert.match(stage, /^scratch\/group-territory-release(?:-[a-z0-9]+)?$/)
  assert.ok(!existsSync(stage), 'Do not overwrite staged artifact')
  mkdirSync(`${stage}/.vercel/output`, { recursive: true })
  cpSync('scratch/group-territory-dist', `${stage}/.vercel/output/static`, { recursive: true })
  writeFileSync(`${stage}/.vercel/project.json`, JSON.stringify({ projectId: DEMO_PROJECT, orgId: TEAM, projectName: 'chinese-territory-app-demo' }))
  writeFileSync(`${stage}/.vercel/output/config.json`, JSON.stringify({ version: 3, routes: [{ handle: 'filesystem' }, { src: '/_vercel/insights/.*', status: 404 }, { src: '/.*', dest: '/index.html' }] }))
  console.log(JSON.stringify({ demo: true, built: true, stage, deployed: false }))
}
