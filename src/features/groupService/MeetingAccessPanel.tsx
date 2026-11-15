import { useEffect, useState } from 'react'
import { getAuthToken } from '../../lib/authToken'
import { msg } from '../../lib/msg'
import { showToast } from '../../lib/toast'
import { readMeetingAccess } from './api'
import { groupServiceEnabled, type MeetingAccess } from './model'
import './groupService.css'

export function MeetingAccessPanel({eventId,version}: {eventId:number;version?:string}) {
  const [result,setResult]=useState<{id:number;version?:string;token:string|null;access:MeetingAccess|null}|null>(null)
  const [failed,setFailed]=useState(false)
  const [retry,setRetry]=useState(0)
  const token=getAuthToken()
  useEffect(()=>{
    if(!groupServiceEnabled())return
    let active=true
    void readMeetingAccess(eventId).then(access=>{
      if(!access)throw new Error('Meeting access unavailable')
      if(active)setResult({id:eventId,version,token,access})
    }).catch(()=>{if(active)setFailed(true)})
    return()=>{active=false}
  },[eventId,version,token,retry])
  if(!groupServiceEnabled())return null
  const access=result?.id===eventId&&result.version===version&&result.token===token?result.access:null
  const copy=async(value:string)=>{try{await navigator.clipboard.writeText(value);showToast(msg('복사했습니다'))}catch{showToast(msg('복사하지 못했습니다.'),'error')}}
  return <section className="gs-meeting"><h3>{msg('화상 모임')}</h3>{!access ? <button type="button" disabled={!failed} onClick={()=>{setFailed(false);setRetry(n=>n+1)}}>{msg(failed?'다시 시도':'불러오는 중...')}</button>:<>
    {!access.joinUrl&&!access.meetingNumber&&!access.passcode&&<p>{msg('접속 정보 미등록')}</p>}
    {access.joinUrl && /^https:\/\/\S+$/.test(access.joinUrl) && <a href={access.joinUrl} target="_blank" rel="noopener noreferrer">{msg('화상 모임 참여')} ↗</a>}
    {(['meetingNumber','passcode'] as const).filter(k=>access[k]).map(k=><div key={k}><span>{msg(k==='meetingNumber'?'회의 번호':'비밀번호')}: {access[k]}</span><button type="button" title={msg('복사')} aria-label={msg(k==='meetingNumber'?'회의 번호 복사':'비밀번호 복사')} onClick={()=>void copy(access[k])}>⧉</button></div>)}
  </>}</section>
}
