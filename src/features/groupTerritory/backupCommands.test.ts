// @vitest-environment node
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

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
    if (sql.includes("to_regclass('public.card_group_assignments')")) return 't'
    if (sql.includes('select jsonb_build_object(')) {
      return JSON.stringify(Object.fromEntries(io.present.map(table => [table,io.files[`${table}.json`]])))
    }
    return ''
  },
}))

let argv: string[]
let exitCode: typeof process.exitCode
beforeEach(() => {
  vi.resetModules()
  argv = process.argv
  exitCode = process.exitCode
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
  }
  io.present = ['service_groups','app_users','cards','card_group_assignments','app_settings']
  io.restReads = []; io.sql = []; io.upserts = []; io.writes.clear(); io.missingTable = null
})
afterEach(() => {
  process.argv = argv
  process.exitCode = exitCode
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
  process.argv.push('--write')
  await import('../../../scripts/restore.js')
  await finished('넣기 완료')
  expect(io.upserts.find(call => call.table === 'app_settings')?.rows).toEqual([{key:'ordinary_setting',value:'kept'}])
  expect(io.upserts.find(call => call.table === 'app_users')?.rows).toEqual(io.files['app_users.json'])
  expect(io.sql.some(sql => sql.includes('select private.publish_service_group_directory('))).toBe(true)
  expect(io.sql.some(sql => sql.includes('alter table public.cards enable trigger'))).toBe(true)
  expect(io.upserts.some(call => ['cards','service_groups','card_group_assignments'].includes(call.table))).toBe(false)
})

test('backup without owner connection stops before all table exports', async () => {
  vi.stubEnv('SUPABASE_DB_URL','')
  await import('../../../scripts/backup.js')
  await vi.waitFor(() => expect(process.exit).toHaveBeenCalledWith(1))
  expect(io.sql).toEqual([])
  expect(io.restReads).toEqual([])
  expect(io.writes.size).toBe(0)
})

test('write restore stops on missing table after earlier work and warns about partial completion', async () => {
  process.argv.push('--write')
  io.files['buildings.json'] = [{id:20}]
  io.files['calendar_events.json'] = [{id:30}]
  io.missingTable = 'buildings'
  await import('../../../scripts/restore.js')
  await vi.waitFor(() => expect(process.exit).toHaveBeenCalledWith(1))
  expect(io.sql.some(sql => sql.includes('insert into public."card_group_assignments"'))).toBe(true)
  expect(io.upserts.some(call => call.table === 'calendar_events')).toBe(false)
  expect(console.error).toHaveBeenCalledWith(expect.stringContaining('앞서 성공한 표는 이미 반영'))
  expect(console.log).not.toHaveBeenCalledWith('🎉 넣기 완료')
})
