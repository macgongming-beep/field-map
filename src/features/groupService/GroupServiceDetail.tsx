import {useEffect,useId,useRef,useState,type ReactNode} from 'react'
import type {CalendarEvent} from '../../types'
import {t,type AppLanguage} from '../../i18n'
import {msg} from '../../lib/msg'
import {readGroupServiceContext,type GroupServiceContext} from './api'
import {groupLabel,groupSlotEvents,serviceGroupOptions,territoryApplicants} from './model'
import {ServiceApplicationButtons,ReturnVisitApplicants} from './ServiceApplications'
import {MeetingAccessPanel} from './MeetingAccessPanel'
import {GROUP_PARTICIPANTS_CHANGED} from './participantChanges'
import {ParticipantAddContent} from '../../components/calendar/ParticipantAddContent'
import type {EventParticipantUser} from '../../utils/eventParticipantUsers'
import {confirmDialog} from '../../lib/confirm'
import './groupService.css'
import {GroupEventComments} from './GroupEventComments'
import type {MentionUser} from '../../components/CommentSection'
import type {Role} from '../../types'

type Props={event:CalendarEvent;events:CalendarEvent[];language:AppLanguage;currentVisitor:string;
  globalSettings?:Record<string,string>;
  currentUserId?:number|null;role?:Role;mentionUsers?:MentionUser[];commentEntry?:{eventId:number;commentId:number;requestKey?:string};
  mobile?:boolean;onClose?:()=>void;onApply?:(id:number,activity?:'service'|'return_visit')=>unknown;
  onAssignment?:(id:number)=>void;onEdit?:(id:number)=>void;onDelete?:(id:number)=>void;
  participantUsers?:EventParticipantUser[];
  onAddParticipant?:(id:number,name:string,role:'신청'|'게스트')=>boolean|void|Promise<boolean|void>;
  onRemoveParticipant?:(id:number,name:string)=>unknown;
  renderAssignments?:(event:CalendarEvent)=>ReactNode}

export function GroupServiceDetail({event,events,language,currentVisitor,currentUserId,role,mentionUsers,commentEntry,mobile,onClose,onApply,onAssignment,onEdit,onDelete,renderAssignments,participantUsers=[],onAddParticipant,onRemoveParticipant,globalSettings={}}:Props){
  const [response,setResponse]=useState<{key:string;scope:string;data:GroupServiceContext|null;failed:boolean}|null>(null)
  const [selected,setSelected]=useState<number|null>(null)
  const selectionScope=useRef<string|null>(null)
  const [retry,setRetry]=useState(0)
  const [addingGroup,setAddingGroup]=useState<number|null>(null)
  const [removingGroup,setRemovingGroup]=useState<number|null>(null)
  const [handledCommentEntry,setHandledCommentEntry]=useState<Props['commentEntry']>(undefined)
  const [commentDrafts,setCommentDrafts]=useState<{owner:number|null|undefined;values:Record<number,string>}>({owner:currentUserId,values:{}})
  if(commentDrafts.owner!==currentUserId)setCommentDrafts({owner:currentUserId,values:{}})
  const scope=`${event.id}:${currentUserId}`
  const siblings=groupSlotEvents(event,events)
  const membershipKey=siblings.map(e=>`${e.id}:${e.editVersion}:${e.applicants.join(',')}:${e.assigned.join(',')}:${e.returnVisitApplicants?.join(',')}`).join('|')
  const requestKey=`${event.id}:${membershipKey}:${retry}`
  const siblingIds=siblings.map(e=>e.id).join(',')
  useEffect(()=>{
    const ids=new Set(siblingIds.split(',').map(Number))
    const changed=(signal:Event)=>{
      const changedIds=(signal as CustomEvent<number[]|null>).detail
      if(changedIds===null||changedIds.some(id=>ids.has(id)))setRetry(n=>n+1)
    }
    const visible=()=>{if(document.visibilityState==='visible')setRetry(n=>n+1)}
    window.addEventListener(GROUP_PARTICIPANTS_CHANGED,changed)
    document.addEventListener('visibilitychange',visible)
    return()=>{window.removeEventListener(GROUP_PARTICIPANTS_CHANGED,changed);document.removeEventListener('visibilitychange',visible)}
  },[siblingIds])
  // Keep the mounted comment feed during same-event count refreshes, but not account/event changes.
  const context=response?.scope===scope?response.data:null
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
      setResponse({key:requestKey,scope,data:value,failed:false})
      const keepSelection=selectionScope.current===scope
      selectionScope.current=scope
      setSelected(previous=>keepSelection&&value.events.some(e=>e.id===previous)?previous:
        value.events.find(e=>e.groupCode===value.ownGroup)?.id ?? event.id)
    }).catch(()=>{if(active)setResponse({key:requestKey,scope,data:null,failed:true})})
    return()=>{active=false}
  },[event.id,requestKey,scope])
  if(commentEntry&&commentEntry!==handledCommentEntry&&context?.events.some(e=>e.id===commentEntry.eventId)){
    setHandledCommentEntry(commentEntry);setSelected(commentEntry.eventId)
  }
  const selectedMeta=context?.events.find(e=>e.id===selected)
  const current=siblings.find(e=>e.id===selected)
  const savedTitle=(current??event).title
  const title=savedTitle.trim()?savedTitle:msg('집단 봉사')
  const chineseTitle=/\p{Script=Han}/u.test(title)&&!/\p{Script=Hangul}/u.test(title)
  const hasMeetingInformation=Boolean(current&&(current.leader?.trim()||current.place?.trim()||current.memo?.trim()||current.meetingMode==='virtual'||current.meetingMode==='in_person'))
  const ownTeam=current?.cardAssignments.find(a=>a.userName===currentVisitor)?.teamKey
  const visibleAssignments=current?.cardAssignments.filter(a=>selectedMeta?.canManage || a.userName===currentVisitor || (ownTeam&&a.teamKey===ownTeam)) ?? []
  const groups=serviceGroupOptions(globalSettings,language)
  // Existing schedules remain visible even if their group is retired or settings are stale.
  const tabGroups=[...groups,...(context?.events??[]).filter(e=>!groups.some(g=>g.code===e.groupCode)).map(e=>({code:e.groupCode,name:e.groupCode,active:false}))]
    .sort((a,b)=>Number(b.code===context?.ownGroup)-Number(a.code===context?.ownGroup))
  const names=current?territoryApplicants(current):[]
  const scheduleActions=current&&selectedMeta?.canEdit&&(onEdit||onDelete)
    ?<GroupScheduleActions key={current.id} language={language} onEdit={onEdit?()=>onEdit(current.id):undefined} onDelete={onDelete?()=>onDelete(current.id):undefined}/>:null
  const remove=async(name:string)=>{
    if(current&&selectedMeta?.canManage&&await confirmDialog({message:msg('{name}님을 이 일정에서 제외할까요?',{name}),danger:true,confirmLabel:msg('제외')}))await onRemoveParticipant?.(current.id,name)
  }
  const dateLabel=new Intl.DateTimeFormat(language==='zh'?'zh-CN':language==='en'?'en-US':'ko-KR',{month:'long',day:'numeric',weekday:'short'}).format(new Date(`${event.date}T12:00:00`))
  return <section className={`gs-tab-detail${mobile?' gs-tab-mobile':''}`} aria-label={msg('집단 봉사')}>
    {(mobile||onClose)&&<header>{onClose&&<button type="button" aria-label={msg('뒤로')} onClick={onClose}>‹</button>}<div><strong>{msg('일정')}</strong><span>{dateLabel}</span></div>{scheduleActions}</header>}
    <div className="gs-tab-body">
      <div className="gs-tab-title"><div><span>{event.time}{event.endTime?`–${event.endTime}`:''}</span><h2 lang={chineseTitle?'zh-Hans':undefined}>{title}</h2></div><div className="gs-title-tools">{context&&<span>{msg('신청 {n}건',{n:context.events.reduce((n,e)=>n+e.count,0)})}</span>}{!mobile&&!onClose&&scheduleActions}</div></div>
      {!context&&!failed&&<p role="status">{msg('불러오는 중...')}</p>}
      {failed&&<div role="alert"><p>{msg('신청자를 불러오지 못했습니다.')}</p><button type="button" onClick={()=>setRetry(n=>n+1)}>{msg('다시 시도')}</button></div>}
      {context&&<>
        <div className="gs-group-tabs" role="tablist" aria-label={msg('집단')}>
          {tabGroups.map(g=>{const item=context.events.find(e=>e.groupCode===g.code);return item&&<button type="button" role="tab" id={`gs-tab-${item.id}`} aria-controls={`gs-panel-${event.id}`} aria-selected={selected===item.id} tabIndex={selected===item.id?0:-1} key={g.code} onClick={()=>setSelected(item.id)} onKeyDown={e=>{
            if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return
            e.preventDefault()
            const buttons=Array.from(e.currentTarget.parentElement!.querySelectorAll<HTMLButtonElement>('[role=tab]'))
            const i=buttons.indexOf(e.currentTarget)
            const next=e.key==='Home'?0:e.key==='End'?buttons.length-1:(i+(e.key==='ArrowRight'?1:-1)+buttons.length)%buttons.length
            buttons[next].click();buttons[next].focus()
          }}>{g.name} <span>{item.count}</span></button>})}
        </div>
        {current&&selectedMeta&&<div role="tabpanel" id={`gs-panel-${event.id}`} aria-labelledby={`gs-tab-${current.id}`}>
          <ServiceApplicationButtons key={`apply-${current.id}`} event={current} currentVisitor={currentVisitor}
            onApply={onApply?activity=>onApply(current.id,activity):undefined} onCancel={onApply?()=>onApply(current.id):undefined}/>
          <div className="gs-roster-heading"><h3>{groupLabel([selectedMeta.groupCode],language,globalSettings.user_groups,globalSettings.service_group_directory)} · {msg('신청자')} {selectedMeta.count}</h3>
            {selectedMeta.canManage&&<div className="gs-roster-tools">
              {onAddParticipant&&<button type="button" aria-label={t(language,'calendar.addSelf')} title={t(language,'calendar.addSelf')} aria-expanded={addingGroup===current.id} onClick={()=>setAddingGroup(addingGroup===current.id?null:current.id)}>+</button>}
              {onRemoveParticipant&&<button type="button" aria-label={t(language,'calendar.removeShort')} title={t(language,'calendar.removeShort')} aria-pressed={removingGroup===current.id} onClick={()=>setRemovingGroup(removingGroup===current.id?null:current.id)}>−</button>}
            </div>}
          </div>
          {selectedMeta.canManage&&addingGroup===current.id&&onAddParticipant&&<ParticipantAddContent users={participantUsers} existingNames={current.applicants} onAdd={(name,role)=>onAddParticipant(current.id,name,role)} onAdded={()=>setAddingGroup(null)}/>}
          {selectedMeta.canRead?<>
            <h4 className="gs-applicant-heading">{msg('봉사')} <span>{names.length}</span></h4>
            <div className="gs-participant-list">{names.map(name=><span className="gs-participant" key={name}><span className="gs-participant-avatar" aria-hidden>{name.slice(0,1)}</span>{name}{selectedMeta.canManage&&removingGroup===current.id&&<button type="button" aria-label={msg('{name} 참가자 제외',{name})} onClick={()=>void remove(name)}>×</button>}</span>)}</div>
            <ReturnVisitApplicants event={current} onRemove={selectedMeta.canManage&&removingGroup===current.id?remove:undefined}/>
          </>:<p className="gs-private-roster">{msg('신청자 명단은 해당 집단에서 확인할 수 있습니다.')}</p>}
          {selectedMeta.canManage&&onAssignment&&<button className="gs-assignment-open" type="button" onClick={()=>onAssignment(current.id)}>{msg('팀 구성 · 구역 배정')} <span aria-hidden>›</span></button>}
          {current.assignmentStatus==='shared'&&visibleAssignments.length>0&&renderAssignments&&<section className="gs-assignment-results" aria-label={msg('배정 결과')} key={`assignments-${current.id}`}><h3>{msg('배정 결과')}</h3>{renderAssignments({...current,cardAssignments:visibleAssignments})}</section>}
          {hasMeetingInformation&&<details open className="gs-group-information" key={`info-${current.id}`}><summary>{msg('모임 정보')}</summary>
            {current.meetingMode==='in_person'&&<h4>{msg('现场')}</h4>}
            {current.leader&&<p>{msg('인도자')} · {current.leader}</p>}{current.place&&<p>{current.place}</p>}
            {current.meetingMode==='virtual'&&<MeetingAccessPanel eventId={current.id} version={current.editVersion}/>}
            {current.memo&&<p className="gs-group-memo">{current.memo}</p>}
          </details>}
          <GroupEventComments key={`${current.id}:${currentUserId}:${commentEntry?.requestKey??commentEntry?.commentId??''}`} eventId={current.id} language={language} currentVisitor={currentVisitor}
            draft={commentDrafts.values[current.id]} onDraftChange={value=>setCommentDrafts(old=>({owner:currentUserId,values:{...(old.owner===currentUserId?old.values:{}),[current.id]:value}}))}
            currentUserId={currentUserId} role={role} users={mentionUsers} focusCommentId={commentEntry?.eventId===current.id?commentEntry.commentId:undefined}/>
        </div>}
      </>}
    </div>
  </section>
}

function GroupScheduleActions({language,onEdit,onDelete}:{language:AppLanguage;onEdit?:()=>void;onDelete?:()=>void}){
  const [open,setOpen]=useState(false)
  const root=useRef<HTMLDivElement>(null)
  const trigger=useRef<HTMLButtonElement>(null)
  const id=useId()
  useEffect(()=>{
    if(!open)return
    root.current?.querySelector<HTMLButtonElement>('[role=menuitem]')?.focus()
    const outside=(event:PointerEvent)=>{if(!root.current?.contains(event.target as Node))setOpen(false)}
    document.addEventListener('pointerdown',outside)
    return()=>document.removeEventListener('pointerdown',outside)
  },[open])
  return <div className="gs-schedule-actions" ref={root} onBlur={e=>{if(e.relatedTarget&&!e.currentTarget.contains(e.relatedTarget))setOpen(false)}} onKeyDown={e=>{
    if(e.key==='Escape'){e.stopPropagation();setOpen(false);trigger.current?.focus()}
    if(open&&['ArrowDown','ArrowUp','Home','End'].includes(e.key)){
      e.preventDefault()
      const items=Array.from(root.current?.querySelectorAll<HTMLButtonElement>('[role=menuitem]')??[])
      const index=items.indexOf(document.activeElement as HTMLButtonElement)
      items[e.key==='Home'?0:e.key==='End'?items.length-1:(index+(e.key==='ArrowUp'?-1:1)+items.length)%items.length]?.focus()
    }
  }}>
    <button ref={trigger} type="button" className="gs-schedule-trigger" aria-label={t(language,'map.more')} title={t(language,'map.more')} aria-haspopup="menu" aria-expanded={open} aria-controls={open?id:undefined} onClick={()=>setOpen(value=>!value)}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg>
    </button>
    {open&&<div id={id} className="gs-schedule-menu" role="menu" aria-label={t(language,'map.more')}>
      {onEdit&&<button type="button" role="menuitem" onClick={()=>{setOpen(false);onEdit()}}>{msg('일정 수정')}</button>}
      {onDelete&&<button type="button" role="menuitem" className="danger" onClick={()=>{setOpen(false);onDelete()}}>{msg('일정 삭제')}</button>}
    </div>}
  </div>
}
