import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { DEMO_PROJECT, TEAM, inspectArtifact, parseArgs, releaseDemo } from './deployDemo.mjs'

function fixture(t, projectId = DEMO_PROJECT) {
  const artifact = mkdtempSync(join(tmpdir(), 'demo-release-'))
  t.after(() => rmSync(artifact, { recursive: true, force: true }))
  mkdirSync(join(artifact, '.vercel/output/static'), { recursive: true })
  writeFileSync(join(artifact, '.vercel/project.json'), JSON.stringify({ projectId, orgId: TEAM }))
  writeFileSync(join(artifact, '.vercel/output/config.json'), '{"version":3}')
  writeFileSync(join(artifact, '.vercel/output/static/index.html'), '<html>verified demo</html>')
  return artifact
}

function remote(options = {}) {
  const calls = []
  return {
    calls,
    vercel: args => {
      calls.push(args)
      return JSON.stringify({
        id: DEMO_PROJECT,
        gitProviderOptions: { createDeployments: 'disabled' },
        ...options,
      })
    },
  }
}

test('Git pushes cannot automatically deploy any branch', () => {
  const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'))
  assert.equal(config.git.deploymentEnabled, false)
  assert.deepEqual(config.rewrites, [{ source: '/(.*)', destination: '/index.html' }])
})

test('default command checks only, without uploading', t => {
  const server = remote()
  assert.equal(releaseDemo({ artifact: fixture(t), ...server, log() {} }), 'checked')
  assert.deepEqual(server.calls.map(args => args[0]), ['api'])
})

test('production artifact is rejected before any network call', t => {
  const server = remote()
  assert.throws(() => releaseDemo({ artifact: fixture(t, 'prj_cdo2L78J2YEEaBgxMMnNDfA5BDZs'), publish: true, ...server }), /Only the demo/)
  assert.equal(server.calls.length, 0)
})

test('automatic deployments must stay disabled', t => {
  const server = remote({ gitProviderOptions: { createDeployments: 'enabled' } })
  assert.throws(() => releaseDemo({ artifact: fixture(t), publish: true, ...server }), /Disable automatic/)
  assert.equal(server.calls.length, 1)
})

test('the same artifact is never published twice', t => {
  const artifact = fixture(t)
  const server = remote({ targets: { production: { meta: { demoArtifactSha: inspectArtifact(artifact) } } } })
  assert.equal(releaseDemo({ artifact, publish: true, ...server, log() {} }), 'unchanged')
  assert.equal(server.calls.length, 1)
})

test('documentation outside the built output does not change artifact identity', t => {
  const artifact = fixture(t)
  const before = inspectArtifact(artifact)
  writeFileSync(join(artifact, 'README.md'), 'Updated release notes')
  assert.equal(inspectArtifact(artifact), before)
  writeFileSync(join(artifact, '.vercel/output/static/index.html'), '<html>changed app</html>')
  assert.notEqual(inspectArtifact(artifact), before)
})

test('explicit publication sends exactly one prebuilt demo deployment', t => {
  const artifact = fixture(t)
  const server = remote()
  assert.equal(releaseDemo({ artifact, publish: true, ...server }), 'published')
  assert.deepEqual(server.calls[1], ['deploy', artifact, '--prebuilt', '--prod', '--scope', 'gms-projects-3b3e1c8b', '--meta', `demoArtifactSha=${inspectArtifact(artifact)}`])
  assert.equal(server.calls.length, 2)
})

test('missing or unknown command arguments fail closed', () => {
  assert.throws(() => parseArgs([]), /Usage/)
  assert.throws(() => parseArgs(['--artifact']), /incomplete/)
  assert.throws(() => parseArgs(['--artifact', 'demo', '--production']), /Unknown/)
  assert.equal(parseArgs(['--artifact', 'demo']).publish, false)
  assert.equal(parseArgs(['--artifact', 'demo', '--publish']).publish, true)
})
