// @vitest-environment node
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { chmodSync } from 'node:fs'

const io = vi.hoisted(() => ({
  files: {} as Record<string, Record<string, unknown>[]>,
  present: [] as string[],
  restReads: [] as string[],
  sql: [] as string[],
  upserts: [] as { table: string; rows: Record<string, unknown>[] }[],
  writes: new Map<string, string>(),
  missingTable: null as string | null,
}))
vi.mock('node:fs', async importOriginal => ({
  ...await importOriginal<typeof import('node:fs')>(),
  existsSync: (path: string) => !path.endsWith('.env.local') &&
    (path.endsWith('/backups') || path.endsWith('/2026-11-20') || path.split('/').at(-1)! in io.files),
  readFileSync: (path: string) => {
    const file = path.split('/').at(-1)!
    if (!(file in io.files)) throw new Error(`Unexpected filesystem read: ${file}`)
    return JSON.stringify(io.files[file])
  },
  readdirSync: (path: string) => path.endsWith('/backups') ? ['2026-11-20'] : Object.keys(io.files),
  mkdirSync: vi.fn(),
  chmodSync: vi.fn(),
  writeFileSync: (path: string, contents: string) => io.writes.set(path.split('/').at(-1)!, contents),
}))
vi.mock('node:child_process', () => ({
  spawnSync: (_bin: string, args: string[]) => {
    if (!args.includes('--version') && !args.includes('--data-only')) throw new Error('Unexpected process')
    return { status: 0, stdout: '', stderr: '' }
  },
}))
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: (table: string) => ({
  select: (_columns: string, options?: {head?: boolean}) => options?.head
    ? Promise.resolve({count: 0, error: table === io.missingTable ? {message:'missing'} : null})
    : {range: async () => { io.restReads.push(table); return {data: [{restOnly:table}], error:null} }},
  upsert: async (rows: Record<string, unknown>[]) => {
    io.upserts.push({table,rows: structuredClone(rows)})
    return {error:null}
  },
}) }) }))
vi.mock('../../../scripts/groupTerritoryBackup.mjs', async importOriginal => ({
  ...await importOriginal<typeof import('../../../scripts/groupTerritoryBackup.mjs')>(),
  runOwnerSql: (sql: string) => {
    io.sql.push(sql)
    if (sql.includes('from pg_tables')) return JSON.stringify(io.present)
    if (sql.includes('create temporary table restore_input')) {
      if (io.missingTable) throw new Error('Target unavailable; rolled back')
      return '{}'
    }
    if (sql.includes("to_regclass('public.card_group_assignments')")) return 't'
    if (sql.includes('select jsonb_build_object(')) {
      return JSON.stringify(Object.fromEntries(io.present.map(table => [table,io.files[`${table}.json`]])))
    }
    return ''
  },
}))

let argv: string[]
let exitCode: typeof process.exitCode
let umask: number
beforeEach(() => {
  vi.resetModules()
  argv = process.argv
  exitCode = process.exitCode
  umask = process.umask()
  process.exitCode = undefined
  process.argv = ['node','script','2026-11-20']
  vi.stubEnv('VITE_SUPABASE_URL','https://fixture.supabase.co')
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY','test-only')
  vi.stubEnv('SUPABASE_DB_URL','postgresql://postgres.fixture:test-only@aws-0.pooler.supabase.com:5432/postgres')
  vi.stubGlobal('fetch', () => { throw new Error('Network is forbidden in command tests') })
  vi.spyOn(process,'exit').mockImplementation(() => undefined as never)
  vi.spyOn(console,'log').mockImplementation(() => {})
  vi.spyOn(console,'error').mockImplementation(() => {})
  io.files = {
    'service_groups.json': [{code:'a',display_name:'A',label_ko:'A',label_zh:'A',legacy_name:'A',is_active:true,sort_order:0}],
    'app_users.json': [{id:1,group_name:'A'}],
    'cards.json': [{id:10,group_assignment_revision:1}],
    'card_group_assignments.json': [{card_id:10,group_code:'a',assigned_by:1}],
    'app_settings.json': [{key:'service_group_directory',value:'stale directory'}, {key:'user_groups',value:'stale names'}, {key:'ordinary_setting',value:'kept'}],
    'event_meeting_access.json': [{event_id:1,passcode:'fixture-only'}],
    'place_change_requests.json': [{id:1,note:'fixture-only'}],
    'territory_report_shares.json': [{id:'fixture-only',snapshot:{}}],
  }
  io.present = ['service_groups','app_users','cards','card_group_assignments','app_settings','event_meeting_access','place_change_requests','territory_report_shares']
  io.restReads = []; io.sql = []; io.upserts = []; io.writes.clear(); io.missingTable = null
})
afterEach(() => {
  process.argv = argv
  process.exitCode = exitCode
  process.umask(umask)
  vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals()
})
async function finished(text: string) {
  await vi.waitFor(() => expect(console.log).toHaveBeenCalledWith(expect.stringContaining(text)))
  expect(process.exit).not.toHaveBeenCalled()
  expect(process.exitCode).toBeUndefined()
}

test.each([true,false])('backup entry point uses one read-only snapshot, group feature installed=%s', async installed => {
  if (!installed) io.present = io.present.filter(table => table !== 'card_group_assignments')
  await import('../../../scripts/backup.js')
  await finished('백업 완료')
  const snapshots = io.sql.filter(sql => sql.includes('select jsonb_build_object('))
  expect(snapshots).toHaveLength(1)
  expect(snapshots[0]).toContain('set transaction read only;')
  for (const table of io.present) {
    expect(snapshots[0]).toContain(`from public."${table}"`)
    expect(io.restReads).not.toContain(table)
    expect(JSON.parse(io.writes.get(`${table}.json`)!)).toEqual(io.files[`${table}.json`])
  }
  expect(io.restReads).toContain('buildings')
  expect(JSON.parse(io.writes.get('buildings.json')!)).toEqual([{restOnly:'buildings'}])
  expect(io.upserts).toEqual([])
  expect(JSON.parse(io.writes.get('_meta.json')!).tablesFailed).toBe(0)
})

test('restore entry point skips only derived settings and still restores ordinary settings', async () => {
  process.argv.push('--write','--maintenance')
  await import('../../../scripts/restore.js')
  await finished('넣기 완료')
  const writes = io.sql.filter(sql => sql.includes('create temporary table restore_input'))
  expect(writes).toHaveLength(1)
  expect(writes[0]).toContain('ordinary_setting')
  expect(writes[0]).not.toContain('stale directory')
  expect(writes[0]).not.toContain('stale names')
  expect(writes[0]).toContain(JSON.stringify(io.files['app_users.json']))
  expect(writes[0]).toContain('perform private.publish_service_group_directory(')
  expect(io.upserts).toEqual([])
})

test('backup without owner connection stops before all table exports', async () => {
  vi.stubEnv('SUPABASE_DB_URL','')
  await import('../../../scripts/backup.js')
  await vi.waitFor(() => expect(process.exit).toHaveBeenCalledWith(1))
  expect(io.sql).toEqual([])
  expect(io.restReads).toEqual([])
  expect(io.writes.size).toBe(0)
})

test('write restore uses one owner transaction and reports rollback on missing table', async () => {
  process.argv.push('--write','--maintenance')
  io.files['buildings.json'] = [{id:20}]
  io.files['calendar_events.json'] = [{id:30}]
  io.missingTable = 'buildings'
  await import('../../../scripts/restore.js')
  await vi.waitFor(() => expect(process.exit).toHaveBeenCalledWith(1))
  expect(io.sql.filter(sql => sql.includes('create temporary table restore_input'))).toHaveLength(1)
  expect(io.upserts).toEqual([])
  expect(console.error).toHaveBeenCalledWith(expect.stringContaining('SQL 오류는 전체 취소'))
  expect(console.log).not.toHaveBeenCalledWith('🎉 넣기 완료')
})

test('write restore requires explicit maintenance acknowledgement before database access', async () => {
  process.argv.push('--write')
  await import('../../../scripts/restore.js')
  await vi.waitFor(() => expect(process.exit).toHaveBeenCalledWith(1))
  expect(io.sql).toEqual([])
  expect(io.upserts).toEqual([])
})

test.each(['extra file','explicit table'])('unreviewed restore %s is refused before DB access', async selection => {
  process.argv.push('--write','--maintenance')
  if (selection === 'extra file') io.files['unexpected_table.json'] = [{id:1}]
  else process.argv.push('--table','unexpected_table')
  await import('../../../scripts/restore.js')
  await vi.waitFor(() => expect(process.exit).toHaveBeenCalledWith(1))
  expect(io.sql).toEqual([])
  expect(io.upserts).toEqual([])
  expect(console.error).toHaveBeenCalledWith('❌', expect.objectContaining({message:expect.stringContaining('Unreviewed')}))
})

test('backup tightens sensitive data files to owner-only access, including existing files', async () => {
  await import('../../../scripts/backup.js')
  await finished('백업 완료')
  expect(chmodSync).toHaveBeenCalledWith(expect.stringMatching(/\/backups\/\d{4}-\d{2}-\d{2}$/),0o700)
  for (const name of ['event_meeting_access','app_users','place_change_requests','territory_report_shares']) {
    expect(io.writes.has(`${name}.json`)).toBe(true)
    expect(chmodSync).toHaveBeenCalledWith(expect.stringContaining(`/${name}.json`),0o600)
  }
  expect(chmodSync).toHaveBeenCalledWith(expect.stringContaining('/private_duplicate_building_merge_audits.sql'),0o600)
  expect(process.umask()).toBe(0o077)
})
