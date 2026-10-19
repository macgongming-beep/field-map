import { readFileSync, mkdirSync, chmodSync } from 'node:fs'
import { parseEnv } from 'node:util'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const ref = 'qdxemvdorasoryfysuoq'
const file = process.env.PRODUCTION_ENV_FILE
if (!file || !process.argv.includes(`--confirm-production=${ref}`)) throw new Error('Explicit production confirmation required')
const config = parseEnv(readFileSync(file, 'utf8'))
const url = new URL(config.SUPABASE_DB_URL)
if (decodeURIComponent(url.username) !== `postgres.${ref}`
  || config.VITE_SUPABASE_URL !== `https://${ref}.supabase.co`) throw new Error('Production allowlist mismatch')
const env = { ...process.env, PGHOST: url.hostname, PGPORT: url.port || '5432', PGUSER: decodeURIComponent(url.username),
  PGDATABASE: url.pathname.slice(1), PGPASSWORD: decodeURIComponent(url.password), PGSSLMODE: 'require', PGCONNECT_TIMEOUT: '15' }
function run(command, args) {
  const result = spawnSync(command, args, { env, encoding: 'utf8' })
  if (result.error) throw result.error
  if (result.status) throw new Error(result.stderr || `${command} failed`)
  return result.stdout.trim()
}
const signature = 'public.browse_restaurants(uuid,text,text,text,integer,integer,boolean)'
const exists = run('psql', ['-X', '-At', '-v', 'ON_ERROR_STOP=1', '-c', `select to_regprocedure('${signature}') is not null`])
if (exists !== 'f') throw new Error('Already installed: refusing to replace the RPC')
const directory = resolve('backups', `restaurant-catalog-production-${new Date().toISOString().replaceAll(':', '-')}`)
mkdirSync(directory, { recursive: true, mode: 0o700 })
const backup = resolve(directory, 'before.dump')
// Restrict the file from creation, not only after the dump contains data.
process.umask(0o077)
run('pg_dump', ['--format=custom', '--no-owner', '--no-privileges', '--schema=public', '--schema=private', '--file', backup])
chmodSync(backup, 0o600)
run('pg_restore', ['--list', backup])
run('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '--single-transaction', '-f', 'supabase/migrations/20261019_1200_restaurant_catalog.sql'])
console.log(`Production catalog RPC installed. Backup archive checked: ${backup}`)
