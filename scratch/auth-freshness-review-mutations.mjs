import assert from 'node:assert/strict'
import { cpSync, mkdtempSync, readFileSync, writeFileSync, symlinkSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = process.cwd()
const copy = mkdtempSync(join(root, 'scratch/auth-freshness-review-'))
const results = []
try {
  for (const name of ['src', 'scripts', 'package.json', 'vitest.config.ts', 'tsconfig.json', 'tsconfig.app.json', 'tsconfig.node.json']) {
    cpSync(join(root, name), join(copy, name), { recursive: true })
  }
  symlinkSync(join(root, 'node_modules'), join(copy, 'node_modules'), 'dir')
  const path = join(copy, 'src/hooks/useAuth.ts')
  const original = readFileSync(path, 'utf8')
  const reset = '  if (directoryIdentity.current !== directoryKey) {\n    directoryFresh.current = null\n    directoryPending.current = null\n  }\n'
  const key = "fresh?.key === directoryKey && age >= 0"
  assert.equal(original.split(reset).length, 2)
  assert.equal(original.split(key).length, 2)
  const cases = [
    ['baseline', original, 0],
    ['reset-only-removed', original.replace(reset, ''), 0],
    ['key-only-removed', original.replace(key, 'fresh != null && age >= 0'), 0],
    ['both-removed', original.replace(reset, '').replace(key, 'fresh != null && age >= 0'), 3],
    ['restored', original, 0],
  ]
  for (const [label, code, expectedFailures] of cases) {
    writeFileSync(path, code)
    const report = join(copy, 'report.json')
    rmSync(report, { force: true })
    const run = spawnSync(join(root, 'node_modules/.bin/vitest'), ['run', 'src/hooks/AuthContext.test.tsx', '--reporter=json', `--outputFile=${report}`], { cwd: copy, encoding: 'utf8' })
    writeFileSync(join(root, `scratch/auth-freshness-${label}.log`), run.stdout + run.stderr)
    const data = JSON.parse(readFileSync(report, 'utf8'))
    const failed = data.testResults.flatMap(file => file.assertionResults).filter(test => test.status === 'failed').map(test => test.fullName)
    assert.equal(data.numFailedTests, expectedFailures, label)
    assert.equal(run.status, expectedFailures ? 1 : 0, label)
    if (expectedFailures) assert.ok(failed.every(name => name.includes('a completed fresh directory never suppresses the next identity read')))
    results.push({ label, status: run.status, passed: data.numPassedTests, failed })
  }
  writeFileSync(join(root, 'scratch/auth-freshness-review-mutations.json'), JSON.stringify(results, null, 2))
  console.log(JSON.stringify(results, null, 2))
} finally { rmSync(copy, { recursive: true, force: true }) }
