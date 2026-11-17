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
