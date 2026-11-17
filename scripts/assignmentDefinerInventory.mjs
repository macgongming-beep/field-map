import assert from 'node:assert/strict'

// Catalog references are deliberately broader than writes. Dynamic wrappers are
// checked separately; this inventory is a review tripwire, not a SQL analyzer.
export const assignmentDefiners = {
  'private.cleanup_team_participant_removal()': [false, 'Participant-trigger cleanup with parent lock/version'],
  'private.guard_service_application_activity()': [false, 'Activity trigger; rejects assigned return visits'],
  'private.place_has_linked_data(text, bigint)': [false, 'Read-only place dependency check'],
  'private.place_impact_snapshot(text, bigint)': [false, 'Read-only place impact summary'],
  'private.purge_user_name_references_before_assignment_guard(uuid, text)': [false, 'Authorized maintenance wrapper only'],
  'private.rename_user_name_references(uuid, text, text)': [false, 'Nested authorized rename core'],
  'private.merge_duplicate_buildings_before_assignment_guard(uuid, integer, jsonb, integer[])': [false, 'Authorized maintenance wrapper only'],
  'private.track_assignment_revision()': [false, 'Assignment guard/revision trigger'],
  'public.assign_cards_bulk_tx_impl_20260907(uuid, integer, jsonb, text, text)': [false, 'Closed bulk core behind versioned save'],
  'public.assign_team_service_bulk_tx(uuid, integer, jsonb, text, text)': [false, 'Closed bulk core behind versioned save'],
  'public.can_read_group_assignment(integer, text)': [true, 'Read-only scoped assignment policy'],
  'public.mutate_personal_assignment_versioned_tx(uuid, integer, bigint, text, text, text, bigint, bigint, integer)': [true, 'Authorized parent lock, expected revision and eligible participant'],
  'public.reset_demo_environment_tx(uuid)': [true, 'Existing demo-only administrator reset; never invoked by audit'],
}

export const assignmentInventorySql = `select coalesce(json_agg(x),'[]') from (
 select n.nspname||'.'||p.proname||'('||oidvectortypes(p.proargtypes)||')' signature,
 has_function_privilege('anon',p.oid,'execute') anon_execute,
 has_function_privilege('authenticated',p.oid,'execute') authenticated_execute
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where p.prosecdef and n.nspname in ('public','private')
 and p.prosrc ~* 'event_(card_assignments|card_assignment_cards|informal_assignments|restaurant_assignments)'
 order by 1)x;`

export function assertAssignmentInventory(rows) {
  assert.deepEqual(rows.map(r=>r.signature).sort(),Object.keys(assignmentDefiners).sort(),
    'Assignment definer inventory changed: review every added/removed function and its guard before updating the inventory')
  for(const row of rows){
    const [callable,protection]=assignmentDefiners[row.signature]
    assert.ok(protection)
    assert.equal(row.anon_execute,callable,row.signature)
    assert.equal(row.authenticated_execute,callable,row.signature)
  }
  return rows.map(row=>({...row,protection:assignmentDefiners[row.signature][1]}))
}
