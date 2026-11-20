// Disposable local PostgreSQL only. No .env or remote database is read.
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir, userInfo } from 'node:os'
import { join } from 'node:path'
import { spawn, spawnSync } from 'node:child_process'

const root = mkdtempSync(join(tmpdir(), 'territory-concurrency-'))
const data = join(root, 'data'), port = '55439'
const cleanEnvironment = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('PG')))
const env = { ...cleanEnvironment, PGHOST: root, PGPORT: port, PGDATABASE: 'postgres', PGUSER: userInfo().username }
const run = (cmd, args, input) => {
  const result = spawnSync(cmd, args, { env, input, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  return result.stdout.trim()
}
const sql = input => run('psql', ['-XAt', '-v', 'ON_ERROR_STOP=1'], input)
const children = new Set()
function connection(name) {
  const child = spawn('psql', ['-XAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose'], { env: { ...env, PGAPPNAME: name } })
  children.add(child)
  const state = { out: '', err: '', done: false, status: null, child }
  child.stdout.on('data', chunk => { state.out += chunk })
  child.stderr.on('data', chunk => { state.err += chunk })
  state.closed = new Promise(resolve => child.on('close', code => { state.done = true; state.status = code; children.delete(child); resolve() }))
  return state
}
const pause = () => new Promise(resolve => setTimeout(resolve, 30))
async function until(predicate, message) {
  const end = Date.now() + 10000
  while (!predicate()) { assert.ok(Date.now() < end, message); await pause() }
}
const call = (id, group, expected) => `select set_territory_group_assignments_tx('00000000-0000-0000-0000-000000000001','${group}',array[${id}],'add','{"${id}":"${expected}"}');`
async function race(name, held, pending, expectedError) {
  const a = connection(`${name}_a`), b = connection(`${name}_b`)
  a.child.stdin.write(`begin;set local statement_timeout='12s';${held}\nselect 'READY';\n`)
  await until(() => a.out.includes('READY') || a.done, 'holder did not start')
  assert.ok(!a.done, a.err)
  b.child.stdin.end(`set statement_timeout='12s';${pending}\n`)
  await until(() => b.done || sql(`select count(*) from pg_stat_activity where application_name='${name}_b' and wait_event_type='Lock'`) === '1', 'contender did not block')
  assert.equal(b.done, false, `must wait for holder: ${b.err}`)
  a.child.stdin.end('commit;\n')
  await a.closed; await b.closed
  assert.equal(a.status, 0, a.err)
  assert.notEqual(b.status, 0)
  assert.match(b.err, expectedError)
  return { name, blocked: true, rejectedAfterCommit: true }
}
let started = false
try {
  run('initdb', ['-D', data, '-A', 'trust', '--no-locale', '--encoding=UTF8'])
  run('pg_ctl', ['-D', data, '-l', join(root, 'server.log'), '-o', `-k ${root} -p ${port} -h ''`, '-w', 'start']); started = true
  sql(`create role anon;create role authenticated;create schema private;
    create table app_users(id integer primary key,role text,is_active boolean,approval_status text);
    insert into app_users values(1,'admin',true,'approved');
    create function verify_session(t uuid) returns integer language sql as $$select 1$$;
    create function private.request_session_user_id() returns integer language sql as $$select 1$$;
    create table cards(id integer primary key);
    insert into cards values(10),(11),(12);
    create table service_groups(code text primary key,is_active boolean);
    insert into service_groups values('a',true),('b',true),('retiring',true);`)
  for (const file of ['20261120_1600_territory_group_assignments.sql', '20261120_1700_territory_group_review.sql']) {
    let body = readFileSync(`supabase/migrations/${file}`, 'utf8')
    if (process.env.MUTATION === 'no-advisory' && file.includes('1600')) body = body.replace('perform pg_advisory_xact_lock(20261118,2300);', '')
    if (process.env.MUTATION === 'no-row-lock' && file.includes('1600')) body = body.replace('order by id for update loop', 'order by id loop')
    sql(`begin;${body}commit;`)
  }
  const result = []
  result.push(await race('same_revision', call(10, 'a', 0), call(10, 'b', 0), /PT409.*Territory assignments changed/))
  assert.equal(sql("select string_agg(group_code,',') from card_group_assignments where card_id=10"), 'a')
  result.push(await race('archive', "select pg_advisory_xact_lock(20261118,2300);update service_groups set is_active=false where code='retiring';", call(11, 'retiring', 0), /22023.*Unknown or retired group/))
  result.push(await race('card_delete', 'delete from cards where id=12;', call(12, 'a', 0), /PT409.*Territory not found/))
  const output = { localPostgres: true, version: sql('show server_version'), independentConnections: 2, productionAccess: false, tests: result }
  writeFileSync('scratch/group-territory-concurrency.json', JSON.stringify(output, null, 2))
  console.log(JSON.stringify(output))
} finally {
  for (const child of children) child.kill('SIGTERM')
  if (started) run('pg_ctl', ['-D', data, '-m', 'immediate', '-w', 'stop'])
  rmSync(root, { recursive: true, force: true })
}
