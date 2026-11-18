import type { CalendarEvent } from '../../types'
import type { AppLanguage } from '../../i18n'
import { msg } from '../../lib/msg'
import { eventBlocks, groupLabel, serviceGroupOptions, serviceGroups } from './model'
import './groupService.css'

export function ServiceEventList({events,language,onOpen,groupName,statusById,globalSettings={}}: {events:CalendarEvent[];language:AppLanguage;onOpen:(id:number)=>void;groupName?:string;statusById?:Record<number,'lead'|'join'|'avail'>;globalSettings?:Record<string,string>}) {
  const own=globalSettings.service_group_directory!=null
    ?serviceGroupOptions(globalSettings,language).find(g=>g.name===groupName||g.code===groupName)?.code
    :serviceGroups.find(g=>[g.code,g.ko,g.zh].some(n=>n===groupName))?.code
  return <div className="gs-event-list">{eventBlocks(events,groupName,globalSettings.service_group_directory).map(block=>{
    const scoped=block[0].groupServiceScope
    const rows=scoped?[block.find(e=>own&&e.targetGroups?.includes(own)) ?? block[0]]:block
    return <section className="gs-event-block" data-service-kind={block[0].serviceKind} data-group-scope={scoped || undefined} key={block[0].id}>
      {!scoped&&block[0].serviceKind==='group'&&<h3>{groupLabel(block[0].targetGroups ?? [],language,globalSettings.user_groups,globalSettings.service_group_directory)}</h3>}
      {rows.map(e=>{
        const statuses=(scoped?block:[e]).map(item=>statusById?.[item.id])
        const title=e.title.trim()?e.title:scoped?msg('집단 봉사'):e.title
        const chineseTitle=/\p{Script=Han}/u.test(title)&&!/\p{Script=Hangul}/u.test(title)
        return <button type="button" key={e.id} title={`${e.time}${e.endTime?`–${e.endTime}`:''} · ${title} · ${e.leader}`} onClick={click=>{click.stopPropagation();onOpen(e.id)}}>
          <span className="gs-event-time">{e.time}{e.endTime&&<span className="gs-event-end">–{e.endTime}</span>}</span>
          <span className="gs-event-text">
            <strong lang={chineseTitle?'zh-Hans':undefined}>{title}</strong>
            <span>{scoped?groupLabel(block.flatMap(b=>b.targetGroups ?? []),language,globalSettings.user_groups,globalSettings.service_group_directory):<>{e.leader}{e.meetingMode==='virtual'?` · ${msg('线上')}`:e.meetingMode==='in_person'?` · ${msg('现场')}${e.place?` · ${e.place}`:''}`:e.place?` · ${e.place}`:''}</>}</span>
            {statuses.includes('lead')?<span>{msg('인도')}</span>:statuses.includes('join')?<span>{msg('신청 완료')}</span>:null}
          </span><span aria-hidden="true">›</span>
        </button>
      })}
    </section>
  })}</div>
}
