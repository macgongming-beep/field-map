import type { CalendarEvent } from '../../types'
import type { AppLanguage } from '../../i18n'
import { msg } from '../../lib/msg'
import { eventBlocks, groupLabel } from './model'
import './groupService.css'

export function ServiceEventList({events,language,onOpen,groupName,statusById}: {events:CalendarEvent[];language:AppLanguage;onOpen:(id:number)=>void;groupName?:string;statusById?:Record<number,'lead'|'join'|'avail'>}) {
  return <div className="gs-event-list">{eventBlocks(events,groupName).map(block=><section className="gs-event-block" data-service-kind={block[0].serviceKind} key={block[0].id}>
    {block[0].serviceKind==='group' && <h3>{groupLabel(block[0].targetGroups ?? [],language)}</h3>}
    {block.map(e=><button type="button" key={e.id} title={`${e.time} · ${e.title} · ${e.leader}`} onClick={click=>{click.stopPropagation();onOpen(e.id)}}>
      <span className="gs-event-time">{e.time}{e.endTime?`–${e.endTime}`:''}</span>
      <span className="gs-event-text"><strong>{e.title}</strong><span>{e.leader}{e.meetingMode==='virtual'?` · ${msg('화상 모임')}`:e.place?` · ${e.place}`:''}</span>{statusById?.[e.id]==='lead'?<span>{msg('인도')}</span>:statusById?.[e.id]==='join'?<span>{msg('신청 완료')}</span>:null}</span><span aria-hidden="true">›</span>
    </button>)}
  </section>)}</div>
}
