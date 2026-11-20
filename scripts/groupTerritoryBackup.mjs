import { spawnSync } from 'node:child_process'

export const GROUP_BACKUP_TABLES = ['service_groups', 'app_users', 'app_settings', 'cards', 'card_group_assignments']
export const OWNER_BACKUP_TABLES = [...GROUP_BACKUP_TABLES, 'event_meeting_access', 'place_change_requests', 'territory_report_shares']
export const GROUP_CONFLICT_KEYS = { service_groups: 'code', card_group_assignments: 'card_id,group_code' }
export const DIRECTORY_KEYS = new Set(['service_group_directory', 'user_groups'])
const quote = value => `"${value.replaceAll('"', '""')}"`
const literal = value => `'${value.replaceAll("'", "''")}'`

// No credentials in argv, no inherited PGOPTIONS/PGSERVICE, and no mixed-project restore.
export function ownerConnection(dbUrl, apiUrl) {
  if (!dbUrl) throw new Error('SUPABASE_DB_URL is required for protected group backup/restore')
  const url = new URL(dbUrl), api = new URL(apiUrl)
  const ref = api.hostname.match(/^([a-z0-9]+)\.supabase\.co$/)?.[1]
  const user = decodeURIComponent(url.username)
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !ref ||
    !(url.hostname === `db.${ref}.supabase.co` || (url.hostname.endsWith('.pooler.supabase.com') && user === `postgres.${ref}`))) {
    throw new Error('Database and API project must match')
  }
  if ([...url.searchParams].some(([key,value]) => key !== 'sslmode' || value !== 'require')) {
    throw new Error('Only sslmode=require is allowed in database URL parameters')
  }
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('PG')))
  return { ...env, PGHOST: url.hostname, PGPORT: url.port || '5432', PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
    PGUSER: user, PGPASSWORD: decodeURIComponent(url.password), PGSSLMODE: 'require', PGCONNECT_TIMEOUT: '15' }
}

export function runOwnerSql(sql, env) {
  const bin = [process.env.PSQL_BIN, '/opt/homebrew/opt/libpq/bin/psql', '/usr/local/opt/libpq/bin/psql', 'psql']
    .filter(Boolean).find(candidate => spawnSync(candidate, ['--version'], { stdio: 'ignore' }).status === 0)
  if (!bin) throw new Error('psql is required')
  const result = spawnSync(bin, ['-XqAt', '--single-transaction', '-v', 'ON_ERROR_STOP=1'], {
    env, input: `set local standard_conforming_strings=on;set local lock_timeout='10s';set local statement_timeout='120s';\n${sql}`,
    encoding: 'utf8', maxBuffer: 128 * 1024 * 1024,
  })
  // PostgreSQL errors can echo entire records (including PIN hashes); do not log stderr.
  if (result.status !== 0) throw new Error('Protected database operation failed. SQL errors roll back; after a connection loss, verify target state before retrying. Check schema, owner access and backup data.')
  return result.stdout.trim()
}

export function snapshotSql(tables) {
  if (tables.some(table => !OWNER_BACKUP_TABLES.includes(table))) throw new Error('Unexpected snapshot table')
  return `set transaction read only;select jsonb_build_object(${tables.map(table =>
    `${literal(table)},(select coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text),'[]'::jsonb) from public.${quote(table)} r)`
  ).join(',')});`
}

export function assertGroupBackup(files, featureInstalled) {
  if (!featureInstalled) return
  for (const table of ['service_groups', 'cards', 'card_group_assignments']) {
    if (!Array.isArray(files[table])) throw new Error(`Incomplete group backup: ${table}.json is required`)
  }
  const groups = new Set(files.service_groups.map(row => row.code))
  const cards = new Set(files.cards.map(row => row.id))
  for (const row of files.card_group_assignments) {
    if (!groups.has(row.group_code) || !cards.has(row.card_id)) throw new Error('Group backup has missing parent rows')
  }
}

function upsertSql(table, rows, replace) {
  if (!['service_groups', 'cards', 'card_group_assignments'].includes(table)) throw new Error('Unexpected protected restore table')
  if (!Array.isArray(rows) || rows.some(row => !row || typeof row !== 'object' || Array.isArray(row))) throw new Error('Invalid backup rows')
  if (!rows.length) return ''
  const columns = Object.keys(rows[0]).sort()
  if (!columns.length || rows.some(row => JSON.stringify(Object.keys(row).sort()) !== JSON.stringify(columns))) throw new Error('Backup rows must have the same columns')
  const keys = (GROUP_CONFLICT_KEYS[table] || 'id').split(',')
  if (keys.some(key => !columns.includes(key))) throw new Error('Missing conflict key')
  const updates = columns.filter(column => !keys.includes(column)).map(column => {
    const value = table === 'cards' && column === 'group_assignment_revision'
      ? `greatest(target.${quote(column)},excluded.${quote(column)})+1` : `excluded.${quote(column)}`
    return `${quote(column)}=${value}`
  })
  return `insert into public.${quote(table)} as target (${columns.map(quote).join(',')})
    select ${columns.map(quote).join(',')} from jsonb_populate_recordset(null::public.${quote(table)},${literal(JSON.stringify(rows))}::jsonb)
    on conflict (${keys.map(quote).join(',')}) ${replace && updates.length ? `do update set ${updates.join(',')}` : 'do nothing'};`
}

export const GROUP_RESTORE_PREFLIGHT = `
do $$ begin
  if not exists(select 1 from pg_trigger where tgrelid='public.cards'::regclass
    and tgname='guard_territory_group_revision' and tgenabled='O') then
    raise exception 'Expected enabled group revision guard';
  end if;
  if not pg_has_role(current_user,(select relowner from pg_class where oid='public.cards'::regclass),'USAGE') then
    raise exception 'Table owner required';
  end if;
  perform 'private.publish_service_group_directory(bigint)'::regprocedure;
end $$;`

export function restoreGroupTableSql(table, rows, replace) {
  const upsert = upsertSql(table, rows, replace)
  if (!upsert) return 'select 0;'
  if (table === 'cards') return `${GROUP_RESTORE_PREFLIGHT}
    select pg_advisory_xact_lock(20261118,2300);
    lock table public.cards in access exclusive mode;
    alter table public.cards disable trigger guard_territory_group_revision;
    ${upsert}
    alter table public.cards enable trigger guard_territory_group_revision;`
  if (table === 'service_groups') return `
    select pg_advisory_xact_lock(20261118,2300);
    create temporary table restore_memberships on commit drop as
      select u.id,g.code from public.app_users u join public.service_groups g
        on u.group_name in(g.code,g.label_ko,g.label_zh,g.legacy_name,g.display_name);
    ${upsert}
    update public.app_users u set group_name=case when g.is_active then g.display_name else null end
      from restore_memberships m join public.service_groups g on g.code=m.code
      where u.id=m.id and u.group_name is distinct from (case when g.is_active then g.display_name else null end);
    select private.publish_service_group_directory(coalesce((select (value::jsonb->>'revision')::bigint
      from public.app_settings where key='service_group_directory'),0)+1);`
  return `select pg_advisory_xact_lock(20261118,2300);${upsert}`
}
