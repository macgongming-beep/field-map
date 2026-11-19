import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const beforePath = process.argv[2] ?? 'scratch/sections-matched-stable-baseline.json'
const afterPath = process.argv[3] ?? 'scratch/sections-matched-stable-current.json'
const run = process.env.BENCH_RUN ?? 'sections-matched-nov20'
assert.match(run, /^[a-z0-9-]+$/i)
const read = file => JSON.parse(readFileSync(file, 'utf8'))
const before = read(beforePath), after = read(afterPath)
const baselineBuild = read(`scratch/${run}/baseline-metadata.json`)
const currentBuild = read(`scratch/${run}/current-metadata.json`)
assert.equal(baselineBuild.envHash, currentBuild.envHash, 'Build settings must match exactly')
for (const field of ['engine', 'delay', 'serviceWorkers', 'demoSupabase', 'stableWindowMs']) assert.equal(before[field], after[field])
const key = row => `${row.role}:${row.width}:${row.name}`
const afterByKey = new Map(after.results.map(row => [key(row), row]))
const metric = (before, after) => ({ before, after, delta: after - before, reductionPercent: before ? Math.round((before - after) / before * 1000) / 10 : null })
const rows = before.results.map(row => {
  const next = afterByKey.get(key(row))
  if (!next) return { key: key(row), missingAfter: true }
  if (row.unavailableInRole || next.unavailableInRole) return { key: key(row), unavailableBefore: !!row.unavailableInRole, unavailableAfter: !!next.unavailableInRole }
  return {
    key: key(row), role: row.role, width: row.width, name: row.name,
    ...Object.fromEntries(['readyMs', 'firstReadyMs', 'readinessLosses', 'dataReadyMs', 'loadingFrames', 'requests', 'bytes'].map(field => [field, metric(row[field], next[field])])),
  }
})
function readPairs(section, step) {
  const pairs = []
  for (let repeat = 1; repeat <= 3; repeat++) {
    const basePath = `scratch/sections-matched-${section}-${repeat}-baseline.json`
    const currentPath = `scratch/sections-matched-${section}-${repeat}-current.json`
    if (!existsSync(basePath) || !existsSync(currentPath)) continue
    const b = read(basePath), a = read(currentPath)
    assert.deepEqual(b.failures, [])
    assert.deepEqual(a.failures, [])
    const baseRow = b.results.find(row => row.name === step)
    const currentRow = a.results.find(row => row.name === step)
    pairs.push({ repeat, before: baseRow, after: currentRow })
  }
  return pairs
}
const coldPairs = readPairs('cold', 'home-cold')
const userCalendarPairs = readPairs('cold', 'calendar-first')
const assignmentPairs = readPairs('assignment', 'assignment-first')
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]
const medianMetrics = pairs => pairs.length ? Object.fromEntries(['readyMs', 'dataReadyMs', 'requests', 'bytes'].map(field => [field,
  metric(median(pairs.map(pair => pair.before[field])), median(pairs.map(pair => pair.after[field]))),
])) : null
const coldMedian = medianMetrics(coldPairs), assignmentMedian = medianMetrics(assignmentPairs)
const userCalendarMedian = medianMetrics(userCalendarPairs)
const report = {
  baseline: baselineBuild.baseline, envHash: baselineBuild.envHash,
  beforePath, afterPath, engine: before.engine, delayMs: before.delay, stableWindowMs: before.stableWindowMs,
  caveats: ['Decoded REST bodies, not billed egress.', 'Cold app reload in a fresh authenticated context; static browser cache is not forcibly disabled.', 'Single sequential browser process, service workers blocked, only demo backend network allowed.', 'Full-route sweeps are single samples. Three alternating pairs provide small-sample medians, not a guarantee that every route is faster; live backend latency varies.'],
  failures: { before: before.failures, after: after.failures },
  unmatchedAfter: after.results.filter(row => !before.results.some(item => key(item) === key(row))).map(key),
  rows, coldMedian, coldPairs, assignmentMedian, assignmentPairs, userCalendarMedian, userCalendarPairs,
}
const output = `scratch/${run}/comparison.json`
writeFileSync(output, JSON.stringify(report, null, 2))
const verification = read(`scratch/${run}/source-verification.json`)
const smokePath = `scratch/${run}/pending-navigation-smoke.json`
const smoke = existsSync(smokePath) ? read(smokePath) : null
const sample = row => ({
  requests: row.requests, bytes: row.bytes, stableReadyMs: row.readyMs,
  firstReadyMs: row.firstReadyMs, readinessLosses: row.readinessLosses, dataReadyMs: row.dataReadyMs,
})
const sanitized = {
  baselineCommit: baselineBuild.baseline, currentCommit: verification.commit, sourceHash: verification.sourceHash,
  envHash: baselineBuild.envHash, demoBackendOnly: true, demoMode: false,
  optIns: { VITE_ROUTE_LIGHTWEIGHT_ENABLED: true, VITE_RECIPIENT_DISCOVERY_REUSE_ENABLED: true },
  engine: before.engine, restDelayMs: before.delay, serviceWorkers: before.serviceWorkers, stableWindowMs: before.stableWindowMs,
  limitations: report.caveats,
  errors: { before: before.failures.length, after: after.failures.length },
  sections: before.results.map(row => {
    const next = afterByKey.get(key(row))
    return { role: row.role, width: row.width, step: row.name,
      before: row.unavailableInRole ? { unavailableInRole: true } : sample(row),
      after: !next ? { missing: true } : next.unavailableInRole ? { unavailableInRole: true } : sample(next),
      errors: {
        before: before.failures.filter(f => f.role === row.role && f.width === row.width).length,
        after: after.failures.filter(f => f.role === row.role && f.width === row.width).length,
      },
    }
  }),
  coldPairs: coldPairs.map(pair => ({ repeat: pair.repeat, role: 'user', width: 390, step: 'home-cold', before: sample(pair.before), after: sample(pair.after), errors: { before: 0, after: 0 } })),
  assignmentPairs: assignmentPairs.map(pair => ({ repeat: pair.repeat, role: 'administrator', width: 390, step: 'assignment-first', before: sample(pair.before), after: sample(pair.after), errors: { before: 0, after: 0 } })),
  userCalendarPairs: userCalendarPairs.map(pair => ({ repeat: pair.repeat, role: 'user', width: 390, step: 'calendar-first', before: sample(pair.before), after: sample(pair.after), errors: { before: 0, after: 0 } })),
  coldMedian, assignmentMedian, userCalendarMedian,
  navigationSmoke: smoke ? { errors: smoke.failures.length, heldRequests: smoke.heldCount, abortedReads: smoke.abortedReads, checks: smoke.snapshots } : null,
}
mkdirSync('docs/measurements', { recursive: true })
const sanitizedOutput = 'docs/measurements/2026-11-20-route-lightweight-matched.json'
writeFileSync(sanitizedOutput, JSON.stringify(sanitized, null, 2))
console.log(JSON.stringify({ output, sanitizedOutput, failures: report.failures, coldMedian, assignmentMedian, userCalendarMedian, measuredSections: rows.filter(row => row.readyMs).length }, null, 2))
