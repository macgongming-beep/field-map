import assert from 'node:assert/strict'
import { mkdtempSync, cpSync, symlinkSync, readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = process.cwd(), directory = mkdtempSync(join(tmpdir(), 'group-review-mutations-'))
const results = []
const followup = 'supabase/migrations/20261120_1700_territory_group_review.sql'
try {
  for (const path of ['src', 'package.json', 'vitest.config.ts', 'tsconfig.json', 'tsconfig.app.json', 'tsconfig.node.json']) cpSync(path, join(directory, path), { recursive: true })
  mkdirSync(join(directory, 'scripts')); cpSync('scripts/testEnvGuard.js', join(directory, 'scripts/testEnvGuard.js'))
  mkdirSync(join(directory, 'supabase/migrations'), { recursive: true })
  for (const path of ['supabase/migrations/20261120_1600_territory_group_assignments.sql', followup]) cpSync(path, join(directory, path))
  symlinkSync(join(root, 'node_modules'), join(directory, 'node_modules'), 'dir')
  const run = () => spawnSync(process.execPath, [join(root, 'node_modules/vitest/vitest.mjs'), 'run', 'src/features/groupTerritory', 'src/components/MobileMap.chineseFilter.test.tsx', 'src/components/MobileHome.eventNavigation.test.tsx', '--reporter=json'], { cwd: directory, encoding: 'utf8', timeout: 120000, maxBuffer: 16 * 1024 * 1024 })
  const baseline = run(); assert.equal(baseline.status, 0, baseline.stdout + baseline.stderr)
  for (const [name, file, before, after] of [
    ['delete does not invalidate stale add', followup, "if tg_op in ('DELETE','UPDATE') then", "if tg_op='UPDATE' then"],
    ['batch limit missing', followup, "'cardinality(p_card_ids) not between 1 and 1000'", "'cardinality(p_card_ids) not between 1 and 2000'"],
    ['direct revision guard missing', followup, "elsif new.group_assignment_revision is distinct from old.group_assignment_revision then", 'elsif false then'],
    ['mobile search loses group', 'src/components/MobileMap.tsx', "'scope', 'cardIds', 'groupCode'", "'scope', 'cardIds'"],
    ['search hides other groups', 'src/components/MobileMap.tsx', 'cards: sourceCards,\n    buildings: sourceBuildings,\n    informalAssets,', 'cards,\n    buildings,\n    informalAssets,'],
    ['restoring group keeps incompatible search selection', 'src/components/MobileMap.tsx', 'if (!groupMap.active || selectedCardId == null || cards.some(card => card.id === selectedCardId)) return', 'if (true) return'],
    ['zone forgets chosen group', 'src/components/admin/AdminMobileZone.tsx', "else next.set('groupCode', value)", "else next.delete('groupCode')"],
    ['zone own group replaced by legacy ownership', 'src/components/admin/AdminMobileZone.tsx', 'if (useGroups) return cards.filter(card => groupOwnsCard(card, groupCode))', 'if (false) return cards.filter(card => groupOwnsCard(card, groupCode))'],
    ['home own group replaced by legacy owner', 'src/components/MobileHome.tsx', 'groupTerritory.enabled ? groupOwnsCard(c, groupTerritory.ownCode) : c.assignedLeader === currentVisitor', 'c.assignedLeader === currentVisitor'],
    ['PC buildings ignore group', 'src/components/DesktopTerritory.tsx', 'sourceBuildings.filter(building => groupCardIds.has(building.cardId))', 'sourceBuildings'],
    ['assignment map exception missing', 'src/features/groupTerritory/useGroupMapScope.tsx', " && !params.has('assignmentMap')", ''],
    ['address pin exception missing', 'src/features/groupTerritory/useGroupMapScope.tsx', " && !params.has('addr')", ''],
  ]) {
    const path = join(directory, file), original = readFileSync(path, 'utf8')
    assert.equal(original.split(before).length, 2, `mutation must have exactly one target: ${name}`)
    writeFileSync(path, original.replace(before, after))
    const result = run(); writeFileSync(path, original)
    assert.equal(result.status, 1, `${name}: ${result.stderr}`)
    const report = JSON.parse(result.stdout); assert.ok(report.numFailedTests > 0, name)
    results.push({ name, failedTests: report.numFailedTests })
  }
} finally { rmSync(directory, { recursive: true, force: true }) }
writeFileSync('scratch/group-territory-review-mutations.json', JSON.stringify(results, null, 2))
console.log(JSON.stringify(results))
