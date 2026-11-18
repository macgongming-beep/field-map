import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, readdirSync, rmdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const DEMO_PROJECT = 'prj_txJm1ruq4OiRnZi3cjz9IXLkGKPG'
export const TEAM = 'team_x5DMFAR7DAqaqjoochn7Af5q'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export function inspectArtifact(artifact) {
  const project = JSON.parse(readFileSync(join(artifact, '.vercel/project.json'), 'utf8'))
  assert.equal(project.projectId, DEMO_PROJECT, 'Only the demo project is allowed')
  assert.equal(project.orgId, TEAM, 'Unexpected Vercel team')
  const output = join(artifact, '.vercel/output')
  const config = JSON.parse(readFileSync(join(output, 'config.json'), 'utf8'))
  assert.equal(config.version, 3, 'Expected a prebuilt Vercel artifact')
  assert.ok(readFileSync(join(output, 'static/index.html')).length, 'Missing built app')
  const hash = createHash('sha256')
  function visit(directory, prefix = '') {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      assert.ok(!entry.isSymbolicLink(), 'Symlinks are not allowed in release artifacts')
      const name = `${prefix}${entry.name}`
      if (entry.isDirectory()) visit(join(directory, entry.name), `${name}/`)
      else {
        assert.ok(entry.isFile(), 'Unexpected artifact entry')
        const bytes = readFileSync(join(directory, entry.name))
        hash.update(JSON.stringify([name, bytes.length]))
        hash.update(bytes)
      }
    }
  }
  visit(output)
  return hash.digest('hex')
}

export function releaseDemo({ artifact, publish = false, vercel, log = console.log }) {
  const digest = inspectArtifact(artifact)
  const project = JSON.parse(vercel(['api', `/v9/projects/${DEMO_PROJECT}?teamId=${TEAM}`]))
  assert.equal(project.id, DEMO_PROJECT, 'Unexpected remote project')
  assert.equal(project.gitProviderOptions?.createDeployments, 'disabled', 'Disable automatic demo deployments first')
  if (project.targets?.production?.meta?.demoArtifactSha === digest) {
    log('Skipped: this exact demo artifact is already live.')
    return 'unchanged'
  }
  if (!publish) {
    log('Demo artifact verified. No deployment created. Use --publish after local validation.')
    return 'checked'
  }
  vercel(['deploy', artifact, '--prebuilt', '--prod', '--scope', 'gms-projects-3b3e1c8b', '--meta', `demoArtifactSha=${digest}`], true)
  return 'published'
}

export function parseArgs(args) {
  let artifact
  let publish = false
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--artifact' && args[index + 1] && !artifact) artifact = args[++index]
    else if (args[index] === '--publish' && !publish) publish = true
    else throw new Error(`Unknown or incomplete argument: ${args[index]}`)
  }
  assert.ok(artifact, 'Usage: npm run deploy:demo -- --artifact <verified-prebuilt-directory> [--publish]')
  return { artifact: resolve(artifact), publish }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  let lock
  try {
    const options = parseArgs(process.argv.slice(2))
    // Shared Git metadata prevents simultaneous uploads from local worktrees.
    const common = execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd: root, encoding: 'utf8' }).trim()
    lock = resolve(root, common, 'demo-release.lock')
    mkdirSync(lock)
    try {
      releaseDemo({
        ...options,
        vercel: (args, upload = false) => execFileSync('vercel', args, {
          cwd: root, encoding: 'utf8', stdio: upload ? 'inherit' : 'pipe',
          env: { ...process.env, VERCEL_PROJECT_ID: DEMO_PROJECT, VERCEL_ORG_ID: TEAM },
        }),
      })
    } finally {
      rmdirSync(lock)
    }
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
