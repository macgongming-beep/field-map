import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { CalendarEvent } from '../../types'
import { t, type AppLanguage } from '../../i18n'
import { addMinutesToTime, resolveTimePresets, TIME_PRESET_SETTING_KEY } from '../../lib/timePresets'
import type { EventParticipantUser } from '../../utils/eventParticipantUsers'
import type { CalendarEventInput } from '../../hooks/storeMutations/calendar'
import { getOverlayRoot } from '../../lib/overlayRoot'
import { pushBackHandler } from '../../lib/backStack'
import { confirmDialog } from '../../lib/confirm'
import { msg } from '../../lib/msg'
import { readMeetingAccess } from './api'
import { serviceEventChanged } from './notify'
import { emptyAccess, sameServiceDay, serviceGroups, type GroupCode, type MeetingAccess, type ServicePayload, type ServiceRow } from './model'
import './groupService.css'

type Props = {
  language: AppLanguage; date: string; event?: CalendarEvent | null; events: CalendarEvent[];
  users: EventParticipantUser[]; onClose: () => void;
  globalSettings?: Record<string,string>;
  onSubmit: (input: CalendarEventInput & { date: string }) => unknown | Promise<unknown>;
}
export function ServiceEventEditor({ language,date,event,events,users,onClose,onSubmit,globalSettings={} }: Props) {
  // Freeze the edit snapshot: background refresh must not silently advance versions.
  const [snapshot] = useState(() => event ?? null)
  const [companions] = useState(() => event ? events.filter(e => e.id!==event.id && sameServiceDay(event,e)) : [])
  const [selected, setSelected] = useState<number[]>([])
  const [kind,setKind] = useState<'group'|'congregation'>(event?.serviceKind ?? 'congregation')
  const [groups,setGroups] = useState<GroupCode[]>(event?.targetGroups ?? [])
  const [day,setDay] = useState(event?.date ?? date)
  const [repeatEnd,setRepeatEnd] = useState('')
  const [title,setTitle] = useState(event?.title ?? '')
  const [place,setPlace] = useState(event?.place ?? '')
  const [mapLink,setMapLink] = useState(event?.mapLink ?? '')
  const [memo,setMemo] = useState(event?.memo ?? '')
  const [leaders,setLeaders] = useState(event?.leaders ?? [])
  const [leadersEdited,setLeadersEdited] = useState(false)
  const [mode,setMode] = useState<'none'|'in_person'|'virtual'>(event?.meetingMode ?? (event?.hasMeeting ? 'in_person' : 'none'))
  const [access,setAccess] = useState<MeetingAccess>(emptyAccess)
  const [accessLoading,setAccessLoading] = useState(event?.meetingMode==='virtual')
  const [accessError,setAccessError] = useState(false)
  const [allow,setAllow] = useState(event?.allowApplications ?? true)
  const [slots,setSlots] = useState(() => [{ time:event?.time ?? '14:30',end:event?.endTime ?? '16:30' }])
  const [companionTimes,setCompanionTimes] = useState(() => Object.fromEntries(companions.map(e => [e.id,{time:e.time,end:e.endTime ?? ''}])))
  const [busy,setBusy] = useState(false)
  const [error,setError] = useState('')
  const requestRef = useRef<{ body: string; id: string } | null>(null)
  const originalAccess = useRef<MeetingAccess>(emptyAccess)
  const seriesRef = useRef([crypto.randomUUID(),crypto.randomUUID()])
  const dialogRef = useRef<HTMLElement>(null)
  const available = users.filter(u => u.isActive!==false && (!u.approvalStatus || u.approvalStatus==='approved') && ['leader','admin','developer'].includes(u.role ?? ''))
  const firstMatches=available.filter(u=>u.name===leaders[0])
  const primary=snapshot&&!leadersEdited ? snapshot.primaryLeaderUserId??null : firstMatches.length===1?firstMatches[0].id??null:null
  const timePresets=resolveTimePresets(globalSettings[TIME_PRESET_SETTING_KEY])
  useEffect(() => pushBackHandler(() => { if (!busy) onClose(); return true }),[busy,onClose])
  useEffect(() => {
    const previous=document.activeElement as HTMLElement|null
    const overflow=document.documentElement.style.overflow
    document.documentElement.style.overflow='hidden'
    dialogRef.current?.focus()
    return ()=>{document.documentElement.style.overflow=overflow;previous?.focus()}
  },[])
  useEffect(() => {
    if (!snapshot || snapshot.meetingMode!=='virtual') return
    let active=true
    void readMeetingAccess(snapshot.id).then(result => {
      if (!active) return
      if (!result || result.version!==snapshot.editVersion) throw new Error('stale')
      originalAccess.current={joinUrl:result.joinUrl ?? '',meetingNumber:result.meetingNumber ?? '',passcode:result.passcode ?? ''}
      setAccess(originalAccess.current)
    }).catch(() => { if (active) { setAccessError(true); setError(msg('화상 모임 정보를 불러오지 못했습니다.')) } })
      .finally(() => { if (active) setAccessLoading(false) })
    return () => { active=false }
  },[snapshot])
  const changeKind = (next: 'group'|'congregation') => {
    setKind(next)
    if (next==='congregation') { setGroups([]); setSelected([]) }
  }
  const save = async () => {
    if (busy || accessLoading || accessError) return
    setError('')
    if (!title.trim() || (!repeatEnd && ((!snapshot&&!primary)||(leadersEdited&&leaders.length>0&&!primary))) || (kind==='group' && (groups.length<1 || groups.length>2))) {
      setError(msg('제목, 대상 집단, 인도자를 확인해 주세요.')); return
    }
    const allTimes = [...slots,...selected.map(id=>companionTimes[id])]
    if (allTimes.some(s => !s.time || !s.end || s.time>=s.end)) { setError(msg('종료 시간은 시작 시간 이후로 정해 주세요.')); return }
    if (mode==='virtual' && access.joinUrl && !/^https:\/\/\S+$/.test(access.joinUrl)) {
      setError(msg('화상 모임 링크 또는 회의 번호를 확인해 주세요.')); return
    }
    const dates=[day]
    if (!snapshot && repeatEnd) {
      if (repeatEnd<day) { setError(msg('반복 종료일을 시작일 이후로 정해 주세요.')); return }
      const next=new Date(`${day}T12:00:00Z`)
      while(true) { next.setUTCDate(next.getUTCDate()+7); const d=next.toISOString().slice(0,10); if(d>repeatEnd) break; dates.push(d); if(dates.length*slots.length>200) { setError(msg('한 번에 200개 이하의 일정을 등록해 주세요.')); return } }
    }
    const base: ServicePayload = {event_date:day,time:slots[0].time,end_time:slots[0].end,title:title.trim(),place,meeting_map_url:mapLink,leader_name:leaders.join(', '),memo,allow_applications:allow,
      service_kind:kind,target_groups:kind==='group'?groups:[],primary_leader_user_id:primary,meeting_mode:mode,access:mode==='virtual'?access:emptyAccess}
    let rows: ServiceRow[]
    if (snapshot) {
      rows=[{id:snapshot.id,version:snapshot.editVersion,payload:base},...companions.filter(e=>selected.includes(e.id)).map(e=>({id:e.id,version:e.editVersion,payload:{...base,time:companionTimes[e.id].time,end_time:companionTimes[e.id].end}}))]
    } else {
      rows=dates.flatMap(d=>slots.map((s,i)=>({payload:{...base,event_date:d,time:s.time,end_time:s.end,...(repeatEnd?{series_id:seriesRef.current[i],leader_name:'',primary_leader_user_id:null}:{})}})))
    }
    setBusy(true)
    const today=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Seoul'})
    const needsNotice=!!snapshot && rows.some(row=>{
      const before=row.id===snapshot.id?snapshot:companions.find(e=>e.id===row.id)
      const accessChanged=row.id===snapshot.id
        ? JSON.stringify(originalAccess.current)!==JSON.stringify(row.payload.access)
        : mode==='virtual' || before?.meetingMode==='virtual'
      return before && row.payload.event_date>=today && (serviceEventChanged(before,row.payload)||accessChanged)
    })
    const notify=needsNotice ? await confirmDialog({message:msg('관련 신청자와 인도자에게 변경 알림을 보낼까요?'),confirmLabel:msg('알림 보내기'),cancelLabel:msg('알림 없이 저장')}) : false
    // Preserve the idempotency key after an uncertain network response.
    const body=JSON.stringify(rows)
    if (requestRef.current?.body!==body) requestRef.current={body,id:crypto.randomUUID()}
    try {
      const result=await onSubmit({date:day,time:base.time,endTime:base.end_time,title:base.title,place,leader:base.leader_name,memo,hasMeeting:mode!=='none',allowApplications:allow,
        servicePlan:{rows,requestId:requestRef.current.id,notify}})
      if (result!==false) onClose()
    } catch { setError(msg('일정을 저장하지 못했습니다.')) } finally { setBusy(false) }
  }
  const timeInputs = (s:{time:string;end:string},update:(s:{time:string;end:string})=>void,key:string) => <div key={key}>
    <label>{msg('자주 쓰는 시간')}<select value={timePresets.findIndex(p=>p.time===s.time&&addMinutesToTime(p.time,p.durationMinutes)===s.end)} onChange={e=>{
      const preset=timePresets[Number(e.target.value)]
      if(!preset)return
      update({time:preset.time,end:addMinutesToTime(preset.time,preset.durationMinutes)})
      if(!title.trim()||timePresets.some(p=>p.title===title))setTitle(preset.title)
    }}><option value={-1}>{msg('직접 입력')}</option>{timePresets.map((p,i)=><option key={i} value={i}>{p.label} · {p.time}–{addMinutesToTime(p.time,p.durationMinutes)}</option>)}</select></label>
    <div className="gs-times">
    <label>{msg('시작 시간')}<input type="time" value={s.time} onChange={e=>update({...s,time:e.target.value})} required /></label>
    <label>{msg('종료 시간')}<input type="time" value={s.end} onChange={e=>update({...s,end:e.target.value})} required /></label>
    </div></div>
  const content=<div className="gs-backdrop"><section ref={dialogRef} tabIndex={-1} className="gs-editor" role="dialog" aria-modal="true" aria-label={msg(snapshot?'일정 수정':'일정 추가')} onKeyDown={e=>{
    if(e.key==='Escape'&&!busy){e.stopPropagation();onClose()}
    if(e.key==='Tab'){
      const controls=Array.from(e.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),summary')).filter(el=>el.getClientRects().length)
      const first=controls[0],last=controls.at(-1)
      if(e.shiftKey&&(document.activeElement===first||document.activeElement===e.currentTarget)){e.preventDefault();last?.focus()}
      else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus()}
    }
  }}>
    <div className="gs-sheet-handle" aria-hidden/>
    <header><div><h2>{msg(snapshot?'일정 수정':'일정 추가')}</h2><span className="gs-editor-date">{day.replaceAll('-','.')}</span></div><button type="button" disabled={busy} onClick={onClose} aria-label={msg('닫기')}>×</button></header>
    <form onSubmit={e=>{e.preventDefault();void save()}}><fieldset disabled={busy}>
      <div className="gs-segment" role="group" aria-label={msg('봉사 구분')}>{(['congregation','group'] as const).map(k=><button type="button" key={k} aria-pressed={kind===k} onClick={()=>changeKind(k)}>{msg(k==='group'?'집단봉사':'회중봉사')}</button>)}</div>
      {kind==='group' && <fieldset className="gs-groups"><legend>{msg('대상 집단')}</legend>{serviceGroups.map(g=><label key={g.code}><input type="checkbox" aria-label={g[language]} checked={groups.includes(g.code)} disabled={groups.length>=2&&!groups.includes(g.code)} onChange={()=>setGroups(prev=>prev.includes(g.code)?prev.filter(c=>c!==g.code):[...prev,g.code])} /><span className="gs-choice-mark" aria-hidden>{groups.includes(g.code)?'✓':'+'}</span>{g[language]}</label>)}</fieldset>}
      <label>{msg('날짜')}<input type="date" value={day} onChange={e=>setDay(e.target.value)} required /></label>
      <label>{msg('제목')}<input value={title} maxLength={200} onChange={e=>setTitle(e.target.value)} required /></label>
      {slots.map((s,i)=><div key={i} className="gs-slot">
        {!snapshot && <div className="gs-slot-head"><span>{msg('시간대 {n}',{n:i+1})}</span>{slots.length>1&&<button type="button" title={msg('시간대 삭제')} aria-label={msg('시간대 {n} 삭제',{n:i+1})} onClick={()=>setSlots(prev=>prev.filter((_,j)=>i!==j))}>×</button>}</div>}
        {timeInputs(s,v=>setSlots(prev=>prev.map((x,j)=>i===j?v:x)),String(i))}
      </div>)}
      {!snapshot && <button className="gs-slot-add" type="button" title={msg('시간대 추가')} aria-label={msg('시간대 추가')} disabled={slots.length>=200} onClick={()=>{
        const time=addMinutesToTime(slots.at(-1)!.end,30)
        if(seriesRef.current.length<=slots.length)seriesRef.current.push(crypto.randomUUID())
        setSlots(prev=>[...prev,{time,end:addMinutesToTime(time,120)}])
      }}>+</button>}
      {snapshot && kind==='group' && companions.map(e=><div key={e.id}><label className="gs-check"><input type="checkbox" checked={selected.includes(e.id)} onChange={()=>setSelected(prev=>prev.includes(e.id)?prev.filter(id=>id!==e.id):[...prev,e.id])}/>{msg('함께 수정')} · {e.time}–{e.endTime} · {e.title}</label>{selected.includes(e.id) && timeInputs(companionTimes[e.id],v=>setCompanionTimes(prev=>({...prev,[e.id]:v})),`c${e.id}`)}</div>)}
      {!snapshot && <label>{msg('반복 종료일 (선택)')}<input type="date" min={day} value={repeatEnd} onChange={e=>{setRepeatEnd(e.target.value);setLeadersEdited(true);setLeaders([])}} /></label>}
      {!repeatEnd && <fieldset className="gs-conductors"><legend>{t(language,'calendar.leader')}</legend>
        {leaders.length>0&&<p className="gs-selected-leaders">{leaders.join(' · ')}</p>}
        <div className="gs-leaders">{Array.from(new Set([...available.map(u=>u.name),...leaders])).map(name=><label className="gs-check" key={name}><input type="checkbox" checked={leaders.includes(name)} onChange={()=>{
          setLeadersEdited(true)
          setLeaders(prev=>prev.includes(name)?prev.filter(n=>n!==name):[...prev,name])
        }}/>{name}</label>)}</div>
      </fieldset>}
      <label>{msg('봉사 모임')}<select value={mode} onChange={e=>setMode(e.target.value as typeof mode)}><option value="none">{msg('없음')}</option><option value="in_person">{msg('현장 모임')}</option><option value="virtual">{msg('화상 모임')}</option></select></label>
      <label>{msg('봉사 장소')}<input value={place} onChange={e=>setPlace(e.target.value)} /></label>
      <label>{msg('지도 링크')}<input type="url" value={mapLink} onChange={e=>setMapLink(e.target.value)} /></label>
      {mode==='virtual' && <fieldset className="gs-access" disabled={accessLoading || accessError}><legend>{msg('화상 모임')}</legend>{accessLoading?<p role="status">{msg('불러오는 중...')}</p>:null}
        <label>{msg('참여 링크 (선택)')}<input type="url" value={access.joinUrl} onChange={e=>setAccess({...access,joinUrl:e.target.value})} maxLength={2048}/></label>
        <label>{msg('회의 번호 (선택)')}<input value={access.meetingNumber} onChange={e=>setAccess({...access,meetingNumber:e.target.value})} maxLength={100}/></label>
        <label>{msg('비밀번호 (선택)')}<input value={access.passcode} autoComplete="off" onChange={e=>setAccess({...access,passcode:e.target.value})} maxLength={100}/></label>
      </fieldset>}
      <label>{msg('메모')}<textarea value={memo} onChange={e=>setMemo(e.target.value)} rows={3}/></label>
      <label className="gs-check"><input type="checkbox" checked={allow} onChange={e=>setAllow(e.target.checked)}/>{msg('봉사 신청 받기')}</label>
    </fieldset>{error && <p role="alert" className="gs-error">{error}</p>}
      <footer><button type="button" disabled={busy} onClick={onClose}>{msg('취소')}</button><button type="submit" disabled={busy||accessLoading||accessError}>{msg(busy?'저장 중...':'저장')}</button></footer>
    </form></section></div>
  return getOverlayRoot() ? createPortal(content,getOverlayRoot()!) : content
}
