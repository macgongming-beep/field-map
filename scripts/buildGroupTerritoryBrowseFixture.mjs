import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { build } from 'vite'
import react from '@vitejs/plugin-react'
const env = JSON.parse(readFileSync(process.env.BROWSE_BUILD_ENV ?? 'scratch/sections-matched-nov20/build-env.json', 'utf8'))
assert.equal(env.VITE_SUPABASE_URL, 'https://itjlykpjmlcvanqpmkmc.supabase.co')
assert.ok(env.VITE_NAVER_MAP_CLIENT_ID, 'Real map verification requires the demo map key')
await build({ configFile: false, base: '/scratch/browse-ui/', plugins: [react()], define: { 'import.meta.env.VITE_NAVER_MAP_CLIENT_ID': JSON.stringify(env.VITE_NAVER_MAP_CLIENT_ID) }, build: { outDir: 'scratch/browse-ui', rollupOptions: { input: 'scripts/fixtures/groupTerritoryBrowse.html' } } })
