import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const section = process.env.PAIR_SECTION ?? 'cold'
assert.ok(['cold', 'assignment'].includes(section))
for (let repeat = 1; repeat <= 3; repeat++) {
  for (const [phase, port] of [['baseline', 4181], ['current', 4182]]) {
    const label = `sections-matched-${section}-${repeat}-${phase}`
    const result = spawnSync(process.execPath, ['scratch/audit-section-loading.mjs'], {
      env: { ...process.env, PREVIEW_URL: `http://127.0.0.1:${port}`, CASES: section === 'cold' ? 'user:390' : 'administrator:390', ONLY_COLD: String(section === 'cold'), COLD_CALENDAR: String(section === 'cold'), ONLY_SECTIONS: section === 'cold' ? '' : 'assignment', ONLY_EDITOR: 'false', SUBSETTINGS: 'false', LABEL: label, ENGINE: 'webkit', REST_DELAY: '120' },
      stdio: 'inherit',
    })
    assert.equal(result.status, 0, `${label} process failed`)
    const report = JSON.parse(readFileSync(`scratch/${label}.json`, 'utf8'))
    assert.deepEqual(report.failures, [], `${label} browser failures`)
    assert.equal(report.results.filter(row => row.name === (section === 'cold' ? 'home-cold' : 'assignment-first')).length, 1)
  }
}
