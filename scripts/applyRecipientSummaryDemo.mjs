import { readFileSync, mkdirSync, chmodSync } from 'node:fs'
import { parseEnv } from 'node:util'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const file = process.env.DEMO_ENV_FILE
if (!file || !process.argv.includes('--confirm-demo')) throw new Error('Requires DEMO_ENV_FILE and --confirm-demo')
const config = parseEnv(readFileSync(file, 'utf8'))
const url = new URL(config.SUPABASE_DB_URL)
if (decodeURIComponent(url.username) !== 'postgres.itjlykpjmlcvanqpmkmc'
  || config.VITE_SUPABASE_URL !== 'https://itjlykpjmlcvanqpmkmc.supabase.co') throw new Error('Demo allowlist mismatch')
const env = { ...process.env, PGHOST: url.hostname, PGPORT: url.port || '5432', PGUSER: decodeURIComponent(url.username),
  PGDATABASE: url.pathname.slice(1), PGPASSWORD: decodeURIComponent(url.password), PGSSLMODE: 'require', PGCONNECT_TIMEOUT: '15' }
function run(command, args) {
  const result = spawnSync(command, args, { env, encoding: 'utf8' })
  if (result.error) throw result.error
  if (result.status) throw new Error(result.stderr || `${command} failed`)
  return result.stdout.trim()
}
const exists = run('psql', ['-X', '-At', '-v', 'ON_ERROR_STOP=1', '-c',
  "select to_regprocedure('public.get_card_summaries(uuid,integer[])') is not null"])
if (exists !== 'f') throw new Error('Already installed: refusing to replace the RPC')
const directory = resolve('backups', `recipient-summary-demo-${new Date().toISOString().replaceAll(':', '-')}`)
mkdirSync(directory, { recursive: true, mode: 0o700 })
const backup = resolve(directory, 'before.dump')
run('pg_dump', ['--format=custom', '--no-owner', '--no-privileges', '--schema=public', '--schema=private', '--file', backup])
chmodSync(backup, 0o600)
run('pg_restore', ['--list', backup])
run('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '--single-transaction', '-f', 'supabase/migrations/20261005_1200_card_summaries.sql'])
console.log(`Demo summary RPC installed. Backup archive checked: ${backup}`)
