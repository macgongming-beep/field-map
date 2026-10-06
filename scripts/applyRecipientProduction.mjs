import { readFileSync, mkdirSync, chmodSync } from 'node:fs'
import { parseEnv } from 'node:util'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const ref = 'qdxemvdorasoryfysuoq'
const config = parseEnv(readFileSync(process.env.PRODUCTION_ENV_FILE, 'utf8'))
const url = new URL(config.SUPABASE_DB_URL)
if (config.VITE_SUPABASE_URL !== `https://${ref}.supabase.co`
  || decodeURIComponent(url.username) !== `postgres.${ref}` || url.port !== '5432') throw new Error('Production target mismatch')
const env = { ...process.env, PGHOST: url.hostname, PGPORT: '5432', PGUSER: decodeURIComponent(url.username),
  PGDATABASE: url.pathname.slice(1), PGPASSWORD: decodeURIComponent(url.password), PGSSLMODE: 'require', PGCONNECT_TIMEOUT: '15' }
function run(command, args) {
  const result = spawnSync(command, args, { env, encoding: 'utf8' })
  if (result.error) throw result.error
  if (result.status) throw new Error(result.stderr || `${command} failed`)
  return result.stdout.trim()
}
const sql = (query) => run('psql', ['-X', '-At', '-v', 'ON_ERROR_STOP=1', '-c', query])
const signatures = ['public.get_card_summaries(uuid,integer[])', 'public.get_recipient_return_visit_card_ids(uuid)']
const exists = signatures.map((name) => sql(`select to_regprocedure('${name}') is not null`))
console.log(JSON.stringify({ project: ref, installed: exists }))
if (process.argv.includes('--apply')) {
  if (!process.argv.includes(`--confirm=${ref}`) || exists.some((value) => value !== 'f')) throw new Error('Explicit confirmation and absent functions required')
  const directory = resolve('backups', `recipient-production-${new Date().toISOString().replaceAll(':', '-')}`)
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const backup = resolve(directory, 'before.dump')
  run('pg_dump', ['--format=custom', '--no-owner', '--no-privileges', '--schema=public', '--schema=private', '--file', backup])
  chmodSync(backup, 0o600)
  run('pg_restore', ['--list', backup])
  console.log(`Backup archive checked: ${backup}`)
  run('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '--single-transaction',
    '-f', 'supabase/migrations/20261005_1200_card_summaries.sql',
    '-f', 'supabase/migrations/20261005_1500_recipient_return_visit_scope.sql'])
  console.log('Both migrations committed together')
}
console.log(sql("select proname, prosecdef, has_function_privilege('anon',p.oid,'EXECUTE') from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname in ('get_card_summaries','get_recipient_return_visit_card_ids','territory_sync_clock') order by proname"))
