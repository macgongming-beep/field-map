// @vitest-environment node
import { PGlite } from '@electric-sql/pglite'
import { expect, test } from 'vitest'
import { rolloutFixture } from '../../../scripts/fixtures/groupRolloutFixture.mjs'
import { prerequisiteAuditSql } from '../../../scripts/groupServicePrerequisites.mjs'
import { buildGroupRolloutBundle } from '../../../scripts/groupServiceRolloutBundle.mjs'

test.each([
  'drop function public.merge_duplicate_buildings_tx(uuid,integer,jsonb,integer[])',
  'alter table comments disable trigger on_comment_insert',
  'alter table calendar_events drop column assignment_team_scopes cascade',
])('missing prerequisite stops before installing any group schema: %s', async damage => {
  const db = new PGlite()
  try {
    await db.exec(rolloutFixture(false))
    const before = (await db.query<{prerequisites:{checks:Record<string,boolean>;functions:unknown[]}}>(prerequisiteAuditSql)).rows[0].prerequisites
    expect(Object.values(before.checks).every(Boolean)).toBe(true)
    expect(before.functions).toHaveLength(21)
    await db.exec(damage)
    await expect(db.exec(buildGroupRolloutBundle().prepare)).rejects.toThrow('prerequisites missing')
    expect((await db.query("select to_regclass('public.service_groups') groups, to_regclass('private.group_service_release_manifest') manifest")).rows).toEqual([{groups:null,manifest:null}])
  } finally { await db.close() }
})
