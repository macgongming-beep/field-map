import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { spawnSync } from 'node:child_process'
import { parseEnv } from 'node:util'

const root = process.cwd()
assert.equal(root, '/Users/gm/Documents/New project/field-map-recipient-perf')
const phase = process.argv[2]
assert.ok(['baseline', 'current'].includes(phase))
const run = process.env.BENCH_RUN ?? 'sections-matched-nov20'
assert.match(run, /^[a-z0-9-]+$/i)
const runDir = resolve('scratch', run)
mkdirSync(runDir, { recursive: true, mode: 0o700 })
const baseline = 'fec585966d5ba742dabc44efa392c1f15ee96361'
const demoSupabase = 'https://itjlykpjmlcvanqpmkmc.supabase.co'
const hash = value => createHash('sha256').update(value).digest('hex')
const envPath = `${runDir}/build-env.json`

if (phase === 'baseline') {
  assert.ok(!existsSync(envPath), 'Choose a new BENCH_RUN instead of replacing frozen settings')
  const remote = parseEnv(readFileSync('scratch/nov18-demo.env.local', 'utf8'))
  const local = parseEnv(readFileSync('../chinese-territory-app/.env.test.local', 'utf8'))
  const production = parseEnv(readFileSync('backups/candidate-settings-20261117/production.env.local', 'utf8'))
  const values = {
    ...Object.fromEntries(Object.entries(production).filter(([key]) => key.startsWith('VITE_'))),
    ...Object.fromEntries(Object.entries(remote).filter(([key, value]) => key.startsWith('VITE_') && value)),
    VITE_SUPABASE_URL: local.VITE_SUPABASE_URL,
    VITE_SUPABASE_ANON_KEY: local.VITE_SUPABASE_ANON_KEY,
    VITE_APP_URL: 'https://chinese-territory-app-demo.vercel.app',
    VITE_DEMO_MODE: 'false', VITE_SENTRY_DSN: '',
    VITE_GROUP_SERVICE_ENABLED: 'true', VITE_ASSIGNMENT_REVISION_ENABLED: 'true',
    VITE_SERVICE_CALENDAR_REUSE_ENABLED: 'true', VITE_RECIPIENT_INITIAL_PARALLEL_ENABLED: 'true',
    VITE_CALENDAR_METADATA_REFRESH_ENABLED: 'false',
    VITE_ROUTE_LIGHTWEIGHT_ENABLED: 'true', VITE_RECIPIENT_DISCOVERY_REUSE_ENABLED: 'true',
  }
  assert.equal(values.VITE_SUPABASE_URL, demoSupabase)
  assert.ok(values.VITE_SUPABASE_ANON_KEY)
  assert.ok(values.VITE_VAPID_PUBLIC_KEY, 'Preserve the existing demo push key')
  writeFileSync(envPath, JSON.stringify(values), { mode: 0o600 })
}
const values = JSON.parse(readFileSync(envPath, 'utf8'))
assert.equal(values.VITE_SUPABASE_URL, demoSupabase)
assert.equal(values.VITE_DEMO_MODE, 'false')
assert.equal(values.VITE_ROUTE_LIGHTWEIGHT_ENABLED, 'true')
assert.equal(values.VITE_RECIPIENT_DISCOVERY_REUSE_ENABLED, 'true')
assert.ok(values.VITE_VAPID_PUBLIC_KEY)
const source = `${runDir}/${phase}`
assert.ok(!existsSync(source), 'Do not overwrite a measured source/build')
mkdirSync(source)
function command(program, args, options = {}) {
  const result = spawnSync(program, args, { cwd: root, encoding: 'utf8', ...options })
  assert.equal(result.status, 0, `${program} failed: ${result.stderr ?? ''}`)
  return result.stdout
}
if (phase === 'baseline') {
  command('git', ['archive', '--format=tar', `--output=${runDir}/baseline.tar`, baseline])
  command('tar', ['-xf', `${runDir}/baseline.tar`, '-C', source])
} else {
  // Copy tracked working files and new source modules, without copying any local env files.
  const tracked = command('git', ['ls-files', '-z']).split('\0').filter(Boolean)
  const added = command('git', ['ls-files', '--others', '--exclude-standard', '-z', 'src']).split('\0').filter(Boolean)
  for (const file of new Set([...tracked, ...added])) {
    if (!existsSync(file)) continue
    assert.ok(!file.startsWith('../') && !file.startsWith('/'))
    const target = resolve(source, file)
    mkdirSync(dirname(target), { recursive: true })
    cpSync(file, target)
  }
}
symlinkSync(resolve('node_modules'), `${source}/node_modules`, 'dir')
const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('VITE_') && !key.startsWith('SENTRY_')))
const envHash = hash(JSON.stringify(Object.entries(values).sort(([a], [b]) => a.localeCompare(b))))
const metadata = {
  phase, baseline, source, envHash, demoSupabase, demoMode: values.VITE_DEMO_MODE,
  vapidHash: hash(values.VITE_VAPID_PUBLIC_KEY),
  flags: Object.fromEntries(Object.entries(values).filter(([, value]) => /^(true|false)$/.test(value)).sort()),
  workspaceHead: command('git', ['rev-parse', 'HEAD']).trim(),
  workspaceDiffHash: hash(command('git', ['diff', '--', 'src'])),
  builtAt: new Date().toISOString(),
}
writeFileSync(`${runDir}/${phase}-metadata.json`, JSON.stringify(metadata, null, 2))
const build = spawnSync('npm', ['run', 'build'], { cwd: source, env: { ...cleanEnv, ...values }, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 })
writeFileSync(`${runDir}/${phase}-build.log`, `${build.stdout}\n${build.stderr}`)
assert.equal(build.status, 0, `Build failed; see ${runDir}/${phase}-build.log`)
console.log(JSON.stringify({ ...metadata, output: `${source}/dist` }, null, 2))
