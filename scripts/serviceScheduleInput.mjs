import { parseCsv } from '../src/utils/roundTripCsv.ts'

const groups=new Map([['동탄','dongtan'],['신갈','singal'],['처인','cheoin'],['동백','dongbaek'],['东滩','dongtan'],['新葛','singal'],['处仁','cheoin'],['东柏','dongbaek'],['dongtan','dongtan'],['singal','singal'],['cheoin','cheoin'],['dongbaek','dongbaek']])
export function previewServiceSchedule(csv,users,existing=[]) {
  const [headers,...input]=parseCsv(csv)
  const required=['날짜','구분','집단','인도자','시작','종료']
  if(!headers||required.some(k=>!headers.includes(k)))throw Error(`Required CSV headers: ${required.join(',')}`)
  if(new Set(headers).size!==headers.length)throw Error('Duplicate column headers')
  const errors=[],rows=[],seen=new Set()
  for(const [index,cells] of input.entries()) {
    const line=index+2,r=Object.fromEntries(headers.map((h,i)=>[h,cells[i]?.trim()??'']))
    const fail=message=>errors.push({line,message})
    if(cells.length!==headers.length){fail('열 개수가 머리글과 다릅니다');continue}
    if(!/^\d{4}-\d{2}-\d{2}$/.test(r.날짜)||!Number.isFinite(Date.parse(`${r.날짜}T12:00:00Z`))||new Date(`${r.날짜}T12:00:00Z`).toISOString().slice(0,10)!==r.날짜){fail('날짜를 YYYY-MM-DD로 확인해 주세요');continue}
    const kind=r.구분==='집단'?'group':r.구분==='회중'?'congregation':null
    if(!kind){fail('구분은 집단 또는 회중입니다');continue}
    const targets=r.집단?r.집단.split(/[+·]/).map(x=>groups.get(x.trim())):[]
    if(targets.some(x=>!x)||new Set(targets).size!==targets.length||(kind==='group'?(targets.length<1||targets.length>2):targets.length!==0)){fail('대상 집단을 확인해 주세요');continue}
    const matches=users.filter(u=>u.name===r.인도자)
    if(matches.length!==1){fail('인도자 이름이 계정과 정확히 일치하지 않거나 중복됩니다');continue}
    const user=matches[0]
    if(user.is_active===false||user.approval_status!=='approved'||!['leader','admin','developer'].includes(user.role)){fail('활성·승인된 인도자 계정이 아닙니다');continue}
    const slots=kind==='group'&&!r.시작&&!r.종료?[['14:30','16:30'],['17:00','19:00']]:[[r.시작,r.종료]]
    for(const [time,end]of slots) {
      if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(end)||time>=end){fail('시작·종료 시간을 확인해 주세요');continue}
      const key=[r.날짜,time,kind,[...targets].sort().join(',')].join('|')
      if(seen.has(key)||existing.some(e=>[e.event_date,e.time,e.service_kind,[...(e.target_groups??[])].sort().join(',')].join('|')===key)){fail('동일한 봉사 일정이 이미 있습니다');continue}
      seen.add(key)
      rows.push({payload:{event_date:r.날짜,time,end_time:end,title:r.제목||`${r.구분}봉사`,place:r.장소||'',leader_name:user.name,primary_leader_user_id:user.id,service_kind:kind,target_groups:targets.sort(),memo:r.메모||'',meeting_map_url:'',meeting_mode:'none',allow_applications:true,access:{joinUrl:'',meetingNumber:'',passcode:''}}})
    }
  }
  if(rows.length>200)errors.push({line:0,message:'한 번에 200개 이하로 나눠 주세요'})
  if(!rows.length&&!errors.length)errors.push({line:0,message:'등록할 일정이 없습니다'})
  return {errors,rows}
}
