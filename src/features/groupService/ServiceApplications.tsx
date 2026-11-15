import { useState } from 'react'
import type { CalendarEvent } from '../../types'
import { msg } from '../../lib/msg'
import './groupService.css'

export function ServiceApplicationButtons({event,currentVisitor,onApply,onCancel}: {
  event: CalendarEvent; currentVisitor: string;
  onApply?: (activity?: 'service'|'return_visit')=>unknown;
  onCancel?: ()=>unknown;
}) {
  const [busy,setBusy]=useState(false)
  const applied=event.applicants.includes(currentVisitor)
  const returning=event.returnVisitApplicants?.includes(currentVisitor)
  const run=async (action:()=>unknown)=>{if(busy)return;setBusy(true);try{await action()}finally{setBusy(false)}}
  return <div className="gs-application-actions" aria-label={msg('봉사 신청')}>
    {applied ? <>
      <span className="gs-application-status">{msg(returning?'재방·연구 신청 완료':'봉사 신청 완료')}</span>
      <button type="button" disabled={busy||!onCancel} onClick={()=>void run(()=>onCancel?.())}>{msg('신청 취소')}</button>
    </> : <>
      <button className="gs-apply-service" type="button" disabled={busy||!onApply||!event.allowApplications} onClick={()=>void run(()=>onApply?.('service'))}>{msg('봉사 신청')}</button>
      <button type="button" disabled={busy||!onApply||!event.allowApplications} onClick={()=>void run(()=>onApply?.('return_visit'))}>{msg('재방·연구 신청')}</button>
    </>}
  </div>
}

export function ReturnVisitApplicants({event,onRemove}: {event:CalendarEvent;onRemove?:(name:string)=>unknown}) {
  const names=event.applicants.filter(n=>event.returnVisitApplicants?.includes(n))
  return <div className="gs-return-applicants">
    <h4>{msg('재방·연구')} <span>{names.length}</span></h4>
    <div className="gs-participant-list">{names.map(name=><span className="gs-participant" key={name}>
      <span className="gs-participant-avatar" aria-hidden>{name.slice(0,1)}</span><span>{name}</span>
      {onRemove&&<button type="button" aria-label={msg('{name} 참가자 제외',{name})} onClick={()=>void onRemove(name)}>×</button>}
    </span>)}</div>
  </div>
}
