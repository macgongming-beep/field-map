import { readFileSync, mkdirSync, chmodSync } from 'node:fs'
import { parseEnv } from 'node:util'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const envFile = process.env.MEETING_TEST_ENV
if (!envFile || !process.argv.includes('--confirm-demo')) throw new Error('Requires MEETING_TEST_ENV and --confirm-demo')
const e = parseEnv(readFileSync(envFile, 'utf8'))
const u = new URL(e.SUPABASE_DB_URL)
if (u.username !== 'postgres.itjlykpjmlcvanqpmkmc' || e.VITE_SUPABASE_URL !== 'https://itjlykpjmlcvanqpmkmc.supabase.co') throw new Error('Demo allowlist mismatch')
const env = { ...process.env, PGHOST: u.hostname, PGPORT: u.port || '5432', PGUSER: decodeURIComponent(u.username), PGDATABASE: u.pathname.slice(1), PGPASSWORD: decodeURIComponent(u.password), PGSSLMODE: 'require', PGCONNECT_TIMEOUT: '15' }
const check = spawnSync('psql', ['-X', '-At', '-v', 'ON_ERROR_STOP=1', '-c', "select to_regclass('public.service_meeting_notes') is not null"], { env, encoding: 'utf8' })
if (check.status) throw new Error(check.stderr)
if (check.stdout.trim() !== 'f') throw new Error('Already installed: refusing to reapply')
const dir = resolve('backups', `meeting-demo-${new Date().toISOString().replaceAll(':', '-')}`)
mkdirSync(dir, { recursive: true, mode: 0o700 })
const backup = resolve(dir, 'before.dump')
const dump = spawnSync('pg_dump', ['--format=custom', '--no-owner', '--no-privileges', '--schema=public', '--schema=private', '--file', backup], { env, encoding: 'utf8' })
if (dump.status) throw new Error(dump.stderr)
chmodSync(backup, 0o600)
const result = spawnSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '--single-transaction', '-f', 'supabase/migrations/20261001_1500_service_meeting_notes.sql'], { env, encoding: 'utf8' })
if (result.status) throw new Error(result.stderr)
console.log(`Demo migration applied. Backup: ${backup}`)
