import {useEffect,useState,type ReactNode} from 'react'
import type {CalendarEvent} from '../../types'
import type {AppLanguage} from '../../i18n'
import {msg} from '../../lib/msg'
import {readGroupServiceContext,type GroupServiceContext} from './api'
import {groupSlotEvents,serviceGroups,territoryApplicants} from './model'
import {ServiceApplicationButtons,ReturnVisitApplicants} from './ServiceApplications'
import {MeetingAccessPanel} from './MeetingAccessPanel'
import './groupService.css'

type Props={event:CalendarEvent;events:CalendarEvent[];language:AppLanguage;currentVisitor:string;
  mobile?:boolean;onClose?:()=>void;onApply?:(id:number,activity?:'service'|'return_visit')=>unknown;
  onAssignment?:(id:number)=>void;onEdit?:(id:number)=>void;onDelete?:(id:number)=>void;
  renderAssignments?:(event:CalendarEvent)=>ReactNode}

export function GroupServiceDetail({event,events,language,currentVisitor,mobile,onClose,onApply,onAssignment,onEdit,onDelete,renderAssignments}:Props){
  const [response,setResponse]=useState<{key:string;data:GroupServiceContext|null;failed:boolean}|null>(null)
  const [selected,setSelected]=useState<number|null>(null)
  const [retry,setRetry]=useState(0)
  const siblings=groupSlotEvents(event,events)
  const membershipKey=siblings.map(e=>`${e.id}:${e.editVersion}:${e.applicants.join(',')}:${e.assigned.join(',')}:${e.returnVisitApplicants?.join(',')}`).join('|')
  const requestKey=`${event.id}:${membershipKey}:${retry}`
  const context=response?.key===requestKey?response.data:null
  const failed=response?.key===requestKey&&response.failed
  useEffect(()=>{
    if(!mobile)return
    const previous=document.documentElement.style.overflow
    document.documentElement.style.overflow='hidden'
    return()=>{document.documentElement.style.overflow=previous}
  },[mobile])
  useEffect(()=>{
    let active=true
    void readGroupServiceContext(event.id).then(value=>{
      if(!active)return
      setResponse({key:requestKey,data:value,failed:false})
      setSelected(previous=>value.events.some(e=>e.id===previous)?previous:
        value.events.find(e=>e.groupCode===value.ownGroup)?.id ?? event.id)
    }).catch(()=>{if(active)setResponse({key:requestKey,data:null,failed:true})})
    return()=>{active=false}
  },[event.id,requestKey])
  const selectedMeta=context?.events.find(e=>e.id===selected)
  const current=siblings.find(e=>e.id===selected)
  const visibleAssignments=current?.cardAssignments.filter(a=>selectedMeta?.canRead || a.userName===currentVisitor) ?? []
  const group=serviceGroups.find(g=>g.code===selectedMeta?.groupCode)
  const names=current?territoryApplicants(current):[]
  const dateLabel=new Intl.DateTimeFormat(language==='zh'?'zh-CN':language==='en'?'en-US':'ko-KR',{month:'long',day:'numeric',weekday:'short'}).format(new Date(`${event.date}T12:00:00`))
  return <section className={`gs-tab-detail${mobile?' gs-tab-mobile':''}`} aria-label={msg('집단 봉사')}>
    {(mobile||onClose)&&<header>{onClose&&<button type="button" aria-label={msg('뒤로')} onClick={onClose}>‹</button>}<div><strong>{msg('일정')}</strong><span>{dateLabel}</span></div></header>}
    <div className="gs-tab-body">
      <div className="gs-tab-title"><div><span>{event.time}{event.endTime?`–${event.endTime}`:''}</span><h2>{msg('집단 봉사')}</h2></div>{context&&<span>{msg('신청자')} {context.events.reduce((n,e)=>n+e.count,0)}</span>}</div>
      {!context&&!failed&&<p role="status">{msg('불러오는 중...')}</p>}
      {failed&&<div role="alert"><p>{msg('신청자를 불러오지 못했습니다.')}</p><button type="button" onClick={()=>setRetry(n=>n+1)}>{msg('다시 시도')}</button></div>}
      {context&&<>
        <div className="gs-group-tabs" role="tablist" aria-label={msg('집단')}>
          {serviceGroups.map(g=>{const item=context.events.find(e=>e.groupCode===g.code);return item&&<button type="button" role="tab" id={`gs-tab-${item.id}`} aria-controls={`gs-panel-${event.id}`} aria-selected={selected===item.id} tabIndex={selected===item.id?0:-1} key={g.code} onClick={()=>setSelected(item.id)} onKeyDown={e=>{
            if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return
            e.preventDefault()
            const buttons=Array.from(e.currentTarget.parentElement!.querySelectorAll<HTMLButtonElement>('[role=tab]'))
            const i=buttons.indexOf(e.currentTarget)
            const next=e.key==='Home'?0:e.key==='End'?buttons.length-1:(i+(e.key==='ArrowRight'?1:-1)+buttons.length)%buttons.length
            buttons[next].click();buttons[next].focus()
          }}>{g[language]} <span>{item.count}</span></button>})}
        </div>
        {current&&selectedMeta&&<div role="tabpanel" id={`gs-panel-${event.id}`} aria-labelledby={`gs-tab-${current.id}`}>
          <ServiceApplicationButtons key={`apply-${current.id}`} event={current} currentVisitor={currentVisitor}
            onApply={onApply?activity=>onApply(current.id,activity):undefined} onCancel={onApply?()=>onApply(current.id):undefined}/>
          <div className="gs-roster-heading"><h3>{group?.[language]} · {msg('신청자')} {selectedMeta.count}</h3>
            {selectedMeta.canManage&&<div className="gs-roster-tools">
              {onEdit&&<button type="button" title={msg('일정 수정')} aria-label={msg('일정 수정')} onClick={()=>onEdit(current.id)}>✎</button>}
              {onDelete&&<button type="button" title={msg('일정 삭제')} aria-label={msg('일정 삭제')} onClick={()=>onDelete(current.id)}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/></svg></button>}
            </div>}
          </div>
          {selectedMeta.canRead?<>
            <h4 className="gs-applicant-heading">{msg('봉사')} <span>{names.length}</span></h4>
            <div className="gs-participant-list">{names.map(name=><span className="gs-participant" key={name}><span className="gs-participant-avatar" aria-hidden>{name.slice(0,1)}</span>{name}</span>)}</div>
            <ReturnVisitApplicants event={current}/>
          </>:<p className="gs-private-roster">{msg('신청자 명단은 해당 집단에서 확인할 수 있습니다.')}</p>}
          {selectedMeta.canManage&&onAssignment&&<button className="gs-assignment-open" type="button" onClick={()=>onAssignment(current.id)}>{msg('팀 구성 · 구역 배정')} <span aria-hidden>›</span></button>}
          {current.assignmentStatus==='shared'&&visibleAssignments.length>0&&renderAssignments&&<details className="gs-group-information" key={`assignments-${current.id}`}><summary>{msg('배정 결과')}</summary>{renderAssignments({...current,cardAssignments:visibleAssignments})}</details>}
          <details className="gs-group-information" key={`info-${current.id}`}><summary>{msg('모임 정보')}</summary>
            {current.leader&&<p>{msg('인도자')} · {current.leader}</p>}{current.place&&<p>{current.place}</p>}
            {current.meetingMode==='virtual'&&<MeetingAccessPanel eventId={current.id} version={current.editVersion}/>}
            {current.memo&&<p className="gs-group-memo">{current.memo}</p>}
          </details>
        </div>}
      </>}
    </div>
  </section>
}
