import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DEMO_PROJECT, TEAM, inspectArtifact } from '../scripts/deployDemo.mjs'

const run = process.env.BENCH_RUN ?? 'sections-matched-nov20'
assert.match(run, /^[a-z0-9-]+$/i)
const directory = resolve('scratch', run)
const phase = process.argv[2] ?? 'verify'
assert.ok(['verify', 'stage'].includes(phase))
const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
const entries = execFileSync('git', ['ls-tree', '-r', '-z', 'HEAD', 'src'], { encoding: 'utf8' }).split('\0').filter(Boolean)
const sourceFiles = []
for (const entry of entries) {
  const [info, path] = entry.split('\t')
  const [mode, type, expected] = info.split(' ')
  assert.equal(type, 'blob')
  assert.ok(mode === '100644' || mode === '100755')
  const bytes = readFileSync(`${directory}/current/${path}`)
  const actual = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')
  assert.equal(actual, expected, `Captured source differs from HEAD: ${path}`)
  sourceFiles.push({ path, blob: actual })
}
function files(path, prefix = '') {
  return readdirSync(path, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap(entry => {
    assert.ok(!entry.isSymbolicLink())
    const name = `${prefix}${entry.name}`
    return entry.isDirectory() ? files(`${path}/${entry.name}`, `${name}/`) : [name]
  })
}
assert.deepEqual(files(`${directory}/current/src`).map(path => `src/${path}`).sort(), sourceFiles.map(file => file.path).sort(), 'Captured source contains extra or missing files')
const sourceHash = createHash('sha256').update(JSON.stringify(sourceFiles)).digest('hex')
function treeHash(path) {
  const hash = createHash('sha256')
  for (const file of files(path)) {
    const bytes = readFileSync(`${path}/${file}`)
    hash.update(JSON.stringify([file, bytes.length])).update(bytes)
  }
  return hash.digest('hex')
}
const dist = `${directory}/current/dist`
const verification = { commit: head, sourceFiles: sourceFiles.length, sourceHash, distHash: treeHash(dist), verifiedAt: new Date().toISOString() }
writeFileSync(`${directory}/source-verification.json`, JSON.stringify(verification, null, 2))
if (phase === 'stage') {
  const comparison = JSON.parse(readFileSync(`${directory}/comparison.json`, 'utf8'))
  assert.deepEqual(comparison.failures, { before: [], after: [] })
  assert.equal(comparison.coldPairs.length, 3)
  assert.equal(comparison.userCalendarPairs.length, 3)
  assert.equal(comparison.assignmentPairs.length, 3)
  assert.ok(comparison.rows.every(row => !row.missingAfter))
  const smoke = JSON.parse(readFileSync(`${directory}/pending-navigation-smoke.json`, 'utf8'))
  assert.deepEqual(smoke.failures, [])
  assert.ok(smoke.heldCount > 0)
  assert.ok(smoke.snapshots.some(state => state.step === 'zone-recovered' && state.regionRows > 0 && !state.loadingVisible))
  const project = JSON.parse(readFileSync('.vercel/project.json', 'utf8'))
  assert.equal(project.projectId, DEMO_PROJECT)
  assert.equal(project.orgId, TEAM)
  const stage = `${directory}/current-release`
  assert.ok(!existsSync(stage), 'Do not overwrite a staged artifact')
  mkdirSync(`${stage}/.vercel/output`, { recursive: true })
  cpSync(dist, `${stage}/.vercel/output/static`, { recursive: true })
  writeFileSync(`${stage}/.vercel/project.json`, JSON.stringify(project))
  writeFileSync(`${stage}/.vercel/output/config.json`, JSON.stringify({ version: 3, routes: [
    { handle: 'filesystem' }, { src: '/_vercel/insights/.*', status: 404 }, { src: '/.*', dest: '/index.html' },
  ] }))
  assert.equal(treeHash(`${stage}/.vercel/output/static`), verification.distHash, 'Stage must contain the exact measured dist, without rebuilding')
  const staged = { ...verification, artifact: stage, artifactHash: inspectArtifact(stage), projectId: project.projectId, deployed: false }
  writeFileSync(`${directory}/staged-artifact.json`, JSON.stringify(staged, null, 2))
  console.log(JSON.stringify(staged, null, 2))
} else console.log(JSON.stringify(verification, null, 2))
