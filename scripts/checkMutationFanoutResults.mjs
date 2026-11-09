import { readFileSync } from 'node:fs'
import { strict as assert } from 'node:assert'

const paths = process.argv.slice(2)
assert.ok(paths.length, 'Provide measurement JSON paths')
let snapshots = 0, requests = 0, reads = 0
for (const path of paths) {
  const run = JSON.parse(readFileSync(path, 'utf8'))
  assert.equal(run.origin, 'https://itjlykpjmlcvanqpmkmc.supabase.co')
  assert.ok(run.results.length > 0)
  for (const result of run.results) {
    assert.equal(result.measured.length, 3)
    for (const device of result.measured) {
      ++snapshots
      assert.equal(device.errors.length, 0)
      assert.equal(device.snapshot.loading, false)
      assert.equal(device.snapshot.error, null)
      const saved = result.action === 'save' || result.action === 'external-save' || result.action === 'overlap-save'
      assert.equal(device.snapshot.status, saved ? '부재' : '미방문')
      assert.equal(device.snapshot.recordIds.length, saved ? 1 : 0)
      assert.deepEqual(device.snapshot.recordIds, result.measured[0].snapshot.recordIds)
      assert.equal(device.snapshot.applicant, result.action === 'join')
      assert.equal(device.snapshot.buildingName, result.measured[0].snapshot.buildingName)
      assert.equal(device.snapshot.buildingName.endsWith('-edited'), result.action === 'edit' || result.action === 'overlap-save')
      assert.ok(device.signals.length, 'No real realtime signal observed')
      for (const sample of device.samples) {
        ++requests
        assert.ok(sample.status < 400)
        if (!sample.read) continue
        ++reads
        assert.ok(['buildings', 'units', 'visit_histories', 'calendar_events', 'territory_change_signals'].includes(sample.endpoint))
        if (sample.endpoint === 'territory_change_signals') assert.ok(sample.query.building_id)
        if (sample.endpoint === 'buildings') assert.ok(sample.query.id)
        if (sample.endpoint === 'units') assert.ok(sample.query.building_id)
        if (sample.endpoint === 'visit_histories') assert.ok(sample.query.unit_id || sample.query['units.building_id'])
        if (sample.endpoint === 'calendar_events') {
          assert.ok(sample.query.id)
          assert.ok(!sample.query.select.includes('*'))
        }
      }
    }
  }
}
console.log(JSON.stringify({ snapshots, requests, reads, allSnapshotsAgree: true, unscopedReads: 0 }))
