import { readFileSync } from 'node:fs'
import { parseEnv } from 'node:util'
import { spawnSync } from 'node:child_process'

// Explicit fixture DB allowlist; never read production credentials.
const file = process.env.MEETING_TEST_ENV
if (!file) throw new Error('Set MEETING_TEST_ENV to the dedicated test env file')
const env = parseEnv(readFileSync(file, 'utf8'))
const url = new URL(env.SUPABASE_DB_URL)
if (url.username !== 'postgres.itjlykpjmlcvanqpmkmc' || env.VITE_SUPABASE_URL !== 'https://itjlykpjmlcvanqpmkmc.supabase.co') throw new Error('Not the allowlisted test database')
const password = decodeURIComponent(url.password)
url.password = ''
let migration = readFileSync(new URL('../supabase/migrations/20261001_1500_service_meeting_notes.sql', import.meta.url), 'utf8')
if (process.argv.includes('--installed')) migration = ''
if (process.env.MEETING_MUTATION === 'cascade') migration = migration.replace('references public.calendar_events(id) on delete set null', 'references public.calendar_events(id) on delete cascade')
if (process.env.MEETING_MUTATION === 'role') migration = migration.replaceAll("if not exists(select 1 from public.app_users where id=v_user and role in ('admin','developer')) then", 'if false then')
if (process.env.MEETING_MUTATION === 'conflict') migration = migration.replaceAll('if v_row.updated_at is distinct from p_expected_updated_at then', 'if false then')
const test = readFileSync(new URL('../supabase/tools/_TEST_service_meeting_notes.sql', import.meta.url), 'utf8')
const rollback = process.argv.includes('--check-rollback') ? readFileSync(new URL('../supabase/tools/rollbacks/_ROLLBACK_20261001_1500_service_meeting_notes.sql', import.meta.url), 'utf8') + `\ndo $$ begin
  if to_regclass('public.service_meeting_notes') is not null or to_regprocedure('private.rename_user_name_references(uuid,text,text)') is not null or to_regprocedure('public.rename_user_name_references(uuid,text,text)') is null then raise exception 'rollback incomplete'; end if;
end $$;` : ''
const result = spawnSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '--single-transaction', '-f', '-'], {
  env: { ...process.env, PGHOST: url.hostname, PGPORT: url.port || '5432', PGDATABASE: url.pathname.slice(1), PGUSER: decodeURIComponent(url.username), PGPASSWORD: password, PGSSLMODE: 'require', PGCONNECT_TIMEOUT: '15' }, input: `${migration}\n${test}\n${rollback}\nROLLBACK;`, encoding: 'utf8',
})
// Suppress session-token rows; only diagnostics and pass/fail leave this script.
if (result.status !== 0) { console.error(result.stderr); process.exit(result.status ?? 1) }
console.log('Meeting migration / preservation / rename / role checks passed; all changes rolled back.')
