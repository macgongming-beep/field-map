import {useCallback,useEffect,useRef,useState} from 'react'
import {COMMENT_PAGE_SIZE,readCommentPage,readCommentRows,watchEventComments,type EventComment} from './commentApi'

export function mergeComments(previous:EventComment[],incoming:EventComment[],replaceIds:number[]=[]){
  const map=new Map(previous.filter(r=>!replaceIds.includes(r.id)).map(r=>[r.id,r]))
  for(const row of incoming){if(row.deleted_at)map.delete(row.id);else map.set(row.id,row)}
  return [...map.values()].sort((a,b)=>a.id-b.id)
}

export function useEventComments(eventId:number,enabled:boolean,focusId?:number){
  const [rows,setRows]=useState<EventComment[]>([]),[loading,setLoading]=useState(false),[error,setError]=useState(false),[hasMore,setHasMore]=useState(false)
  const rowsRef=useRef(rows);rowsRef.current=rows
  const cursor=useRef<number|undefined>(undefined),busy=useRef(false),generation=useRef(0)
  const requestAbort=useRef<AbortController|undefined>(undefined)
  const refreshRef=useRef<()=>void>(()=>{}),changes=useRef(new Map<number,number>()),sequence=useRef(0)
  const [retry,setRetry]=useState(0)
  const accept=useCallback((row:EventComment)=>{
    if(row.target_id!==eventId||row.target_type!=='calendar_event')return
    changes.current.set(row.id,++sequence.current)
    setRows(old=>mergeComments(old,[row]))
  },[eventId])

  useEffect(()=>{
    if(!enabled)return
    let stop:undefined|(()=>void),abort:AbortController|undefined,timer:ReturnType<typeof setTimeout>|undefined
    let active=false,started=false,connectionFailed=false
    const pending=new Set<number>()
    const sync=async(epoch:number)=>{
      if(busy.current)return
      busy.current=true;setLoading(true)
      const version=sequence.current
      try{
        const latest=await readCommentPage(eventId,undefined,abort?.signal)
        if(!active||epoch!==generation.current)return
        const known=rowsRef.current.map(r=>r.id).filter(id=>!latest.some(r=>r.id===id))
        const restored:EventComment[]=[]
        for(let i=0;i<known.length;i+=COMMENT_PAGE_SIZE)restored.push(...await readCommentRows(eventId,known.slice(i,i+COMMENT_PAGE_SIZE),abort?.signal))
        if(focusId&&!latest.some(r=>r.id===focusId)&&!known.includes(focusId))restored.push(...await readCommentRows(eventId,[focusId],abort?.signal))
        if(!active||epoch!==generation.current)return
        // Reconnect may have skipped more than one page; reopen the cursor at the latest page.
        cursor.current=latest.at(-1)?.id;setHasMore(latest.length===COMMENT_PAGE_SIZE)
        setRows(old=>{
          const touched=[...changes.current].filter(([,v])=>v>version).map(([id])=>id)
          return mergeComments(mergeComments([],latest.concat(restored)),old.filter(r=>touched.includes(r.id)),touched)
        });setError(connectionFailed)
      }catch{if(active&&epoch===generation.current)setError(true)}
      finally{if(epoch===generation.current){busy.current=false;setLoading(false)}}
    }
    const flush=async(epoch:number)=>{
      const ids=[...pending]
      pending.clear()
      try{
        for(let i=0;i<ids.length;i+=COMMENT_PAGE_SIZE){
          const version=sequence.current,batch=ids.slice(i,i+COMMENT_PAGE_SIZE),fresh=await readCommentRows(eventId,batch,abort?.signal)
          if(!active||epoch!==generation.current)return
          const untouched=batch.filter(id=>(changes.current.get(id)??0)<=version)
          for(const id of untouched)changes.current.set(id,++sequence.current)
          setRows(old=>mergeComments(old,fresh.filter(r=>untouched.includes(r.id)),untouched))
        }
      }catch{if(active)setError(true)}
    }
    const close=()=>{active=false;generation.current++;busy.current=false;stop?.();stop=undefined;abort?.abort();clearTimeout(timer);pending.clear()}
    const open=()=>{
      if(document.visibilityState==='hidden'||active)return
      active=true;started=false;abort=new AbortController();requestAbort.current=abort;const epoch=++generation.current
      setLoading(true)
      stop=watchEventComments(eventId,id=>{pending.add(id);clearTimeout(timer);timer=setTimeout(()=>void flush(epoch),180)},()=>{
        if(active&&epoch===generation.current){started=true;connectionFailed=false;void sync(epoch)}
      },()=>{if(active){connectionFailed=true;setError(true);if(!started){started=true;void sync(epoch)}}})
      refreshRef.current=()=>{void sync(epoch)}
    }
    const visibility=()=>{if(document.visibilityState==='hidden')close();else open()}
    open();document.addEventListener('visibilitychange',visibility)
    return()=>{close();document.removeEventListener('visibilitychange',visibility);refreshRef.current=()=>{}}
  },[eventId,enabled,focusId,retry])

  const more=async()=>{
    if(!enabled||busy.current||!hasMore||cursor.current===undefined||document.visibilityState==='hidden')return
    const epoch=generation.current,version=sequence.current;busy.current=true;setLoading(true)
    try{
      const page=await readCommentPage(eventId,cursor.current,requestAbort.current?.signal)
      if(epoch!==generation.current)return
      cursor.current=page.at(-1)?.id??cursor.current;setHasMore(page.length===COMMENT_PAGE_SIZE)
      setRows(old=>mergeComments(old,page.filter(r=>(changes.current.get(r.id)??0)<=version)));setError(false)
    }catch{if(epoch===generation.current)setError(true)}
    finally{if(epoch===generation.current){busy.current=false;setLoading(false)}}
  }
  return {rows,loading,error,hasMore,more,accept,refresh:()=>refreshRef.current(),retry:()=>setRetry(n=>n+1)}
}
