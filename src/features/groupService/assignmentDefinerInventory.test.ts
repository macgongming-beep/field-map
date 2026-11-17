// @vitest-environment node
import {expect,test} from 'vitest'
import {assignmentDefiners,assertAssignmentInventory} from '../../../scripts/assignmentDefinerInventory.mjs'
const baseline=()=>Object.entries(assignmentDefiners).map(([signature,[callable]])=>({signature,anon_execute:callable,authenticated_execute:callable}))
test('every catalog entry has a documented protection and exact grants',()=>{
  expect(assertAssignmentInventory(baseline())).toHaveLength(13)
})
test('new assignment management function requires explicit review',()=>{
  expect(()=>assertAssignmentInventory([...baseline(),{signature:'public.new_cleanup(uuid)',anon_execute:true,authenticated_execute:true}])).toThrow('inventory changed')
})
test('reopening a private maintenance core fails the audit',()=>{
  const rows=baseline();rows.find(r=>r.signature.startsWith('private.merge_')).anon_execute=true
  expect(()=>assertAssignmentInventory(rows)).toThrow('private.merge_')
})
test('production stage inventory excludes demo reset and only compatibility permits old team saves',()=>{
  const rows=baseline().filter(r=>r.signature!=='public.reset_demo_environment_tx(uuid)')
  expect(assertAssignmentInventory(rows,{environment:'production',phase:'strict'})).toHaveLength(12)
  const team=rows.find(r=>r.signature.startsWith('public.assign_team_service_bulk_tx'))!
  team.anon_execute=true;team.authenticated_execute=true
  expect(assertAssignmentInventory(rows,{environment:'production',phase:'compatibility'})).toHaveLength(12)
  expect(()=>assertAssignmentInventory(rows,{environment:'production',phase:'strict'})).toThrow()
  expect(()=>assertAssignmentInventory(baseline(),{environment:'production',phase:'strict'})).toThrow('inventory changed')
})
