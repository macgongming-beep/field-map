import { readFileSync } from 'node:fs'
import { parseEnv } from 'node:util'
import { spawnSync } from 'node:child_process'

const file = process.env.DEMO_ENV_FILE || '.env.test.local'
const env = parseEnv(readFileSync(file, 'utf8'))
const url = new URL(env.SUPABASE_DB_URL)
if (decodeURIComponent(url.username) !== 'postgres.itjlykpjmlcvanqpmkmc') {
  throw new Error('This rollback-only check is restricted to the demo project')
}
const result = spawnSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-f',
  new URL('../supabase/tools/_TEST_history_signal_recovery.sql', import.meta.url).pathname], {
  encoding: 'utf8',
  env: { ...process.env, PGHOST: url.hostname, PGPORT: url.port || '5432',
    PGDATABASE: url.pathname.slice(1), PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password), PGSSLMODE: 'require' },
})
process.stdout.write(result.stdout || '')
process.stderr.write(result.stderr || '')
if (result.error) throw result.error
process.exitCode = result.status ?? 1
