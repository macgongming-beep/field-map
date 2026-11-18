import {sameMeetingAccess,type ServicePayload,type ServiceRow} from './model'

export type SeriesEditTarget=ServiceRow&{rootId:number;id:number;version:string}
const fields=['time','end_time','title','place','leader_name','memo','meeting_map_url','allow_applications',
  'service_kind','target_groups','primary_leader_user_id','meeting_mode','access','group_service_scope'] as const
const dayNumber=(day:string)=>Date.parse(`${day}T12:00:00Z`)/86400000

// Apply only changed fields; keep each later date's separately arranged leaders and access.
export function expandSeriesEdit(seeds:ServiceRow[],targets:SeriesEditTarget[]):ServiceRow[]{
  const roots=seeds.filter(s=>s.id!=null)
  if(!roots.length||targets.length>200||new Set(targets.map(t=>t.id)).size!==targets.length)throw Error('Invalid series targets')
  for(const root of roots){
    const before=targets.find(t=>t.id===root.id&&t.rootId===root.id)
    if(!before||before.version!==root.version)throw Error('Event changed')
  }
  if(targets.some(t=>!roots.some(r=>r.id===t.rootId)))throw Error('Invalid series root')
  const rows:ServiceRow[]=targets.map(target=>{
    const root=roots.find(r=>r.id===target.rootId)!
    const before=targets.find(t=>t.id===root.id)!.payload
    if(target.id===root.id)return root
    const patch:Partial<ServicePayload>={}
    for(const key of fields)if(!(key==='access'?sameMeetingAccess(before.access,root.payload.access):key==='target_groups'
      ?JSON.stringify([...before.target_groups].sort())===JSON.stringify([...root.payload.target_groups].sort())
      :before[key]===root.payload[key])){
      Object.assign(patch,{[key]:root.payload[key]})
    }
    if('leader_name' in patch||'primary_leader_user_id' in patch){
      patch.leader_name=root.payload.leader_name;patch.primary_leader_user_id=root.payload.primary_leader_user_id
    }
    const delta=dayNumber(root.payload.event_date)-dayNumber(before.event_date)
    const event_date=new Date((dayNumber(target.payload.event_date)+delta)*86400000).toISOString().slice(0,10)
    return {id:target.id,version:target.version,payload:{...target.payload,...patch,event_date}}
  })
  // Move later dates first when shifting forward, avoiding collisions with the next occurrence.
  const delta=dayNumber(roots[0].payload.event_date)-dayNumber(targets.find(t=>t.id===roots[0].id)!.payload.event_date)
  if(delta!==0)rows.sort((a,b)=>a.payload.event_date.localeCompare(b.payload.event_date)*(delta>0?-1:1))
  for(const addition of seeds.filter(s=>s.id==null)){
    const root=roots.find(r=>r.payload.event_date===addition.payload.event_date&&r.payload.time===addition.payload.time&&r.payload.end_time===addition.payload.end_time)
    if(!root)throw Error('New group has no source slot')
    const dates=targets.filter(t=>t.rootId===root.id)
    const series=dates.length>1?crypto.randomUUID():undefined
    for(const target of dates){
      const source=rows.find(r=>r.id===target.id)!
      rows.push({payload:{...addition.payload,event_date:source.payload.event_date,
        ...(series?{series_id:series}:{})}})
    }
  }
  if(rows.length>200)throw Error('Too many events')
  return rows
}
