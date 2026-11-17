import {supabase} from '../../lib/supabase'
import {getAuthToken} from '../../lib/authToken'

export type EventComment={id:number;target_type:'calendar_event'|'notice';target_id:number;author_id:number|null;author_name:string;content:string;mention_ids:number[]|null;mention_names:string[]|null;created_at:string;deleted_at:string|null}
export const COMMENT_PAGE_SIZE=20
const columns='id,target_type,target_id,author_id,author_name,content,mention_ids,mention_names,created_at,deleted_at'
const sessionError=()=>({code:'42501',message:'COMMENT_SESSION_REQUIRED'})
export function isCommentSessionError(error:unknown){
  const e=error as {code?:string;message?:string}|null
  return e?.code==='42501'&&e.message==='COMMENT_SESSION_REQUIRED'
}
async function readComments(eventId:number,before:number|null,ids:number[]|null,signal?:AbortSignal):Promise<EventComment[]>{
  const token=getAuthToken();if(!token)throw sessionError()
  let q=supabase.rpc('read_group_event_comments',{p_event_id:eventId,p_before_id:before,p_ids:ids})
  if(signal)q=q.abortSignal(signal)
  const r=await q;if(r.error)throw r.error;if(token!==getAuthToken())throw sessionError();return r.data??[]
}

export async function readCommentPage(eventId:number,before?:number,signal?:AbortSignal):Promise<EventComment[]>{
  return readComments(eventId,before??null,null,signal)
}
export async function readCommentRows(eventId:number,ids:number[],signal?:AbortSignal):Promise<EventComment[]>{
  if(!ids.length)return []
  if(ids.length>COMMENT_PAGE_SIZE)throw Error('Comment batch exceeds page size')
  return readComments(eventId,null,ids,signal)
}
export async function writeEventComment(eventId:number,input:{id?:number;content?:string;deleted_at?:string;author_id?:number|null;author_name?:string;mention_ids?:number[];mention_names?:string[]}):Promise<EventComment>{
  const token=getAuthToken();if(!token)throw Error('Approved session required')
  const {id,...payload}=input
  const q=id===undefined?supabase.from('comments').insert({...payload,target_type:'calendar_event',target_id:eventId}):
    supabase.from('comments').update(payload).eq('id',id).eq('target_type','calendar_event').eq('target_id',eventId)
  const r=await q.select(columns).single()
  if(r.error||!r.data)throw r.error??Error('Comment write affected no rows')
  if(token!==getAuthToken())throw Error('Session changed')
  return r.data
}
export function watchEventComments(eventId:number,onChange:(id:number)=>void,onReady:()=>void,onError:()=>void){
  const channel=supabase.channel(`group-comments:${eventId}:${crypto.randomUUID()}`)
    .on('postgres_changes',{event:'*',schema:'public',table:'group_comment_signals',filter:`event_id=eq.${eventId}`},payload=>{
      const id=Number((payload.new as {comment_id?:number}).comment_id)
      if(Number.isSafeInteger(id)&&id>0)onChange(id)
    }).subscribe(status=>{if(status==='SUBSCRIBED')onReady();else if(status==='CHANNEL_ERROR'||status==='TIMED_OUT')onError()})
  return ()=>{void supabase.removeChannel(channel)}
}
