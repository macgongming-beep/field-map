import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseEnv } from 'node:util'
import { spawnSync } from 'node:child_process'

assert.ok(process.argv.includes('--read-only'))
const config = parseEnv(readFileSync(process.env.PRODUCTION_ENV_FILE, 'utf8'))
const api = new URL(config.VITE_SUPABASE_URL)
const db = new URL(config.SUPABASE_DB_URL)
assert.ok(api.hostname.endsWith('.supabase.co'))
assert.notEqual(api.hostname, 'itjlykpjmlcvanqpmkmc.supabase.co')
assert.equal(decodeURIComponent(db.username), `postgres.${api.hostname.split('.')[0]}`)
assert.ok(db.hostname.endsWith('.pooler.supabase.com') && db.port === '5432')
const query = `BEGIN READ ONLY;
SELECT json_build_object(
 'summary_functions', (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='get_card_summaries'),
 'summary_definition', pg_get_functiondef('public.get_card_summaries(uuid,integer[])'::regprocedure),
 'cards', (SELECT count(*) FROM public.cards),
 'buildings', (SELECT count(*) FROM public.buildings),
 'units', (SELECT count(*) FROM public.units)
);
ROLLBACK;`
const result = spawnSync('psql', ['-X', '-Atq', '-v', 'ON_ERROR_STOP=1'], {
  input: query, encoding: 'utf8', env: { ...process.env,
    PGHOST: db.hostname, PGPORT: db.port, PGDATABASE: db.pathname.slice(1),
    PGUSER: decodeURIComponent(db.username), PGPASSWORD: decodeURIComponent(db.password),
    PGSSLMODE: 'require', PGCONNECT_TIMEOUT: '15', PGOPTIONS: '-c default_transaction_read_only=on',
  },
})
assert.equal(result.status, 0, result.stderr)
const { summary_definition: definition, ...counts } = JSON.parse(result.stdout.trim())
assert.equal(counts.summary_functions, 1)
assert.ok(definition.includes('verify_session') && definition.includes('progress') && definition.includes('> 200'))
console.log(JSON.stringify({ ...counts, summarySessionCheck: true, batchLimit: 200, readOnly: true }))
