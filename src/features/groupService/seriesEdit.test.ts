import {expect,test} from 'vitest'
import {expandSeriesEdit,type SeriesEditTarget} from './seriesEdit'
import {emptyAccess,type ServicePayload} from './model'
const payload:ServicePayload={event_date:'2026-11-25',time:'14:30',end_time:'16:30',title:'Before',place:'Place',leader_name:'A',memo:'',meeting_map_url:'',allow_applications:true,service_kind:'group',target_groups:['dongtan'],primary_leader_user_id:1,meeting_mode:'virtual',access:{...emptyAccess,passcode:'first'},group_service_scope:true}
const targets:SeriesEditTarget[]=[{rootId:1,id:1,version:'3',payload},{rootId:1,id:2,version:'7',payload:{...payload,event_date:'2026-12-02',leader_name:'B',primary_leader_user_id:2,memo:'Later note',access:{...emptyAccess,passcode:'later'}}}]
test('title edit preserves later date, assigned leader, notes, private access and exact versions',()=>{
  const result=expandSeriesEdit([{id:1,version:'3',payload:{...payload,title:'After'}}],targets)
  expect(result).toEqual([{id:1,version:'3',payload:{...payload,title:'After'}},{id:2,version:'7',payload:{...targets[1].payload,title:'After'}}])
  expect(targets[1].payload.title).toBe('Before')
})
test('date moves are relative and selected slots retain independent times',()=>{
  const evening={...payload,time:'17:00',end_time:'19:00'}
  const more=[...targets,{rootId:3,id:3,version:'1',payload:evening},{rootId:3,id:4,version:'2',payload:{...evening,event_date:'2026-12-02'}}]
  const rows=expandSeriesEdit([{id:1,version:'3',payload:{...payload,event_date:'2026-11-26',time:'15:00',end_time:'16:45'}},{id:3,version:'1',payload:{...evening,event_date:'2026-11-26'}}],more)
  expect(rows.map(r=>[r.id,r.payload.event_date,r.payload.time,r.payload.end_time])).toEqual([[2,'2026-12-03','15:00','16:45'],[4,'2026-12-03','17:00','19:00'],[1,'2026-11-26','15:00','16:45'],[3,'2026-11-26','17:00','19:00']])
})
test('adding groups creates independent series without moving existing participants',()=>{
  const rows=expandSeriesEdit([{id:1,version:'3',payload},{payload:{...payload,target_groups:['new']}}],targets)
  expect(rows.slice(0,2).map(r=>r.id)).toEqual([1,2])
  expect(rows.slice(2).map(r=>[r.id,r.payload.event_date,r.payload.target_groups])).toEqual([[undefined,'2026-11-25',['new']],[undefined,'2026-12-02',['new']]])
  expect(rows[2].payload.series_id).toBeTruthy()
  expect(rows[3].payload.series_id).toBe(rows[2].payload.series_id)
})
test('missing roots, overlapping IDs and changed root versions are rejected',()=>{
  expect(()=>expandSeriesEdit([{id:1,version:'0',payload}],targets)).toThrow('changed')
  expect(()=>expandSeriesEdit([{id:1,version:'3',payload}],targets.slice(1))).toThrow('changed')
  expect(()=>expandSeriesEdit([{id:1,version:'3',payload}],[...targets,targets[1]])).toThrow('Invalid')
})
test('explicit leader change keeps the primary ID and names consistent on later dates',()=>{
  const rows=expandSeriesEdit([{id:1,version:'3',payload:{...payload,leader_name:'A, C'}}],targets)
  expect(rows[1].payload).toMatchObject({leader_name:'A, C',primary_leader_user_id:1})
})
test('JSONB key order cannot turn unchanged access into a future credential overwrite',()=>{
  const server=[{...targets[0],payload:{...payload,access:{passcode:'first',meetingNumber:'',joinUrl:''}}},targets[1]]
  const rows=expandSeriesEdit([{id:1,version:'3',payload:{...payload,title:'After'}}],server)
  expect(rows[1].payload.access).toEqual(targets[1].payload.access)
})
