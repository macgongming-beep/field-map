import { cpSync, mkdtempSync, readFileSync, writeFileSync, symlinkSync, rmSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import assert from 'node:assert/strict'

const root = process.cwd()
const dir = mkdtempSync(join(root, 'scratch/route-gate-check-'))
for (const name of ['src', 'scripts', 'package.json', 'vitest.config.ts', 'tsconfig.json', 'tsconfig.app.json', 'tsconfig.node.json']) cpSync(join(root, name), join(dir, name), { recursive: true })
symlinkSync(join(root, 'node_modules'), join(dir, 'node_modules'), 'dir')
const cases = [
  ['partial-content', 'src/hooks/RouteReadGate.tsx', 'if (!state || state.ready)', 'if (true)'],
  ['shell-unmount', 'src/App.tsx', 'if (startup && needsBuildings)', 'if (needsBuildings)'],
  ['mobile-gate-missing', 'src/components/MobileHome.tsx', '<RouteReadGate>\n          <Routes>', '<>\n          <Routes>'],
]
const results = []
function run(label) {
  const result = spawnSync(join(root, 'node_modules/.bin/vitest'), ['run', 'src/App.calendarWindow.test.tsx', 'src/components/MobileHome.eventNavigation.test.tsx'], { cwd: dir, encoding: 'utf8' })
  writeFileSync(join(root, `scratch/route-gate-${label}.log`), result.stdout + result.stderr)
  results.push({ label, status: result.status })
  return result.status
}
try {
  assert.equal(run('baseline'), 0)
  for (const [label, file, from, to] of cases) {
    const path = resolve(dir, file), source = readFileSync(path, 'utf8')
    assert.equal(source.split(from).length, 2)
    let changed = source.replace(from, to)
    if (label === 'mobile-gate-missing') changed = changed.replace('</RouteReadGate>\n\n          {BottomNav}', '</>\n\n          {BottomNav}')
    writeFileSync(path, changed)
    try { assert.notEqual(run(label), 0) } finally { writeFileSync(path, source) }
  }
  assert.equal(run('restored'), 0)
  writeFileSync(join(root, 'scratch/route-gate-mutations.json'), JSON.stringify(results, null, 2))
  console.log(JSON.stringify(results))
} finally { rmSync(dir, { recursive: true, force: true }) }
