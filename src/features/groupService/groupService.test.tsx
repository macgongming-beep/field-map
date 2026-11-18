import { afterEach,beforeEach,expect,test,vi } from 'vitest'
import { cleanup,fireEvent,render,screen,waitFor } from '@testing-library/react'
import { ServiceEventEditor } from './ServiceEventEditor'
import { ServiceEventList } from './ServiceEventList'
import { MeetingAccessPanel } from './MeetingAccessPanel'
import { eventBlocks,groupLabel,groupServiceEnabled } from './model'
import { willNotifyOnEventChange } from '../../utils/eventNotify'
import type { CalendarEvent } from '../../types'
import { setCurrentLang } from '../../i18n'

const mocks=vi.hoisted(()=>({read:vi.fn(),token:vi.fn(()=> 'session'),confirm:vi.fn(async()=>true)}))
vi.mock('./api',()=>({readMeetingAccess:mocks.read}))
vi.mock('../../lib/authToken',()=>({getAuthToken:mocks.token}))
vi.mock('../../lib/confirm',()=>({confirmDialog:mocks.confirm}))
const make=(id:number,time='14:30',groups=['dongtan','singal']):CalendarEvent=>({id,date:'2026-11-25',time,endTime:time==='14:30'?'16:30':'19:00',title:'Service',leader:'Leader',leaders:['Leader'],serviceKind:'group',targetGroups:groups,meetingMode:'none',editVersion:'1',primaryLeaderUserId:2,place:'',memo:'',allowApplications:true,hasMeeting:false,applicants:[],assigned:[],guests:[],cardAssignments:[],card:'',type:'주택'} as CalendarEvent)
const users=[{id:2,name:'Leader',role:'leader',isActive:true,approvalStatus:'approved' as const},{id:3,name:'Member',role:'user',isActive:true,approvalStatus:'approved' as const}]
beforeEach(()=>{vi.stubEnv('VITE_DEMO_MODE','true');vi.stubEnv('VITE_GROUP_SERVICE_ENABLED','true');vi.stubEnv('VITE_SUPABASE_URL','https://itjlykpjmlcvanqpmkmc.supabase.co');setCurrentLang('ko');mocks.read.mockReset();mocks.token.mockReturnValue('session')})
afterEach(()=>{cleanup();vi.unstubAllEnvs();setCurrentLang('ko')})
test('feature requires revision opt-in outside demo, explicit false disables it',()=>{
  expect(groupServiceEnabled()).toBe(true)
  expect(willNotifyOnEventChange({endTime:'16:00'},{endTime:'16:30'})).toBe(true)
  expect(willNotifyOnEventChange({allowApplications:true},{allowApplications:false})).toBe(true)
  vi.stubEnv('VITE_SUPABASE_URL','https://qdxemvdorasoryfysuoq.supabase.co');expect(groupServiceEnabled()).toBe(false)
  vi.stubEnv('VITE_ASSIGNMENT_REVISION_ENABLED','true');expect(groupServiceEnabled()).toBe(true)
  vi.stubEnv('VITE_ASSIGNMENT_REVISION_ENABLED',undefined)
  vi.stubEnv('VITE_SUPABASE_URL','https://itjlykpjmlcvanqpmkmc.supabase.co');vi.stubEnv('VITE_DEMO_MODE','false');expect(groupServiceEnabled()).toBe(false)
  vi.stubEnv('VITE_DEMO_MODE','true');vi.stubEnv('VITE_GROUP_SERVICE_ENABLED','false');expect(groupServiceEnabled()).toBe(false)
})
test('groups visually by day and canonical targets without dropping ungrouped or other events',()=>{
  const events=[make(1),make(2,'17:00',['singal','dongtan']),make(3,'14:30',['cheoin']),{...make(4),serviceKind:undefined},{...make(5),date:'2026-11-26'}]
  expect(eventBlocks(events).map(b=>b.map(e=>e.id))).toEqual([[1,2],[3],[4],[5]])
  expect(eventBlocks(events,'处仁')[0].map(e=>e.id)).toEqual([3])
  const open=vi.fn(),parent=vi.fn();render(<div onClick={parent}><ServiceEventList events={events} language="ko" onOpen={open}/></div>);fireEvent.click(screen.getAllByRole('button')[1]);expect(open).toHaveBeenCalledWith(2);expect(parent).not.toHaveBeenCalled()
})
test('Chinese event titles have Chinese typography even in the Korean interface',()=>{
  render(<ServiceEventList language="ko" events={[
    {...make(1),title:'传道'}, {...make(2),title:'봉사 모임'},
  ]} onOpen={vi.fn()}/> )
  expect(screen.getByText('传道').getAttribute('lang')).toBe('zh-Hans')
  expect(screen.getByText('봉사 모임').getAttribute('lang')).toBeNull()
})
test('configured group names retain their language and order cannot reassign codes',()=>{
  const configured=JSON.stringify(['东柏','处仁','新葛','东滩'])
  for(const language of ['ko','zh','en'] as const){
    expect(groupLabel(['dongtan','singal','cheoin','dongbaek'],language,configured)).toBe('东滩 · 新葛 · 处仁 · 东柏')
  }
  expect(groupLabel(['dongtan'],'ko',JSON.stringify(['Unknown','东柏']))).toBe('동탄')
  expect(groupLabel(['dongtan'],'zh','invalid')).toBe('东滩')
})
test('configured Chinese group choices still save canonical group codes',async()=>{
  const submit=vi.fn(async()=>true)
  render(<ServiceEventEditor language="ko" date="2026-11-25" events={[]} users={users} onClose={vi.fn()} onSubmit={submit} globalSettings={{user_groups:JSON.stringify(['东柏','处仁','新葛','东滩'])}}/>)
  fireEvent.click(screen.getByRole('button',{name:'집단봉사'}))
  for(const name of ['新葛','处仁','东柏'])fireEvent.click(screen.getByLabelText(name))
  fireEvent.change(screen.getByLabelText('제목'),{target:{value:'小组传道'}})
  fireEvent.click(screen.getByLabelText('Leader'))
  fireEvent.click(screen.getByRole('button',{name:'저장'}))
  await waitFor(()=>expect(submit).toHaveBeenCalledOnce())
  expect(submit.mock.calls[0][0].servicePlan.rows[0].payload).toMatchObject({title:'小组传道',target_groups:['dongtan']})
})
test('five active groups produce five independent events and retired groups cannot be selected',async()=>{
  const submit=vi.fn(async()=>true)
  const groups=Array.from({length:6},(_,i)=>({code:`custom-${i}`,name:`小组${i}`,active:i<5}))
  render(<ServiceEventEditor language="ko" date="2026-11-25" events={[]} users={users} onClose={vi.fn()} onSubmit={submit} globalSettings={{service_group_directory:JSON.stringify({revision:'2',groups})}}/>)
  fireEvent.click(screen.getByRole('button',{name:'집단봉사'}))
  expect(screen.getByLabelText('小组4')).toBeTruthy()
  expect(screen.queryByLabelText('小组5')).toBeNull()
  fireEvent.change(screen.getByLabelText('제목'),{target:{value:'小组传道'}})
  fireEvent.click(screen.getByRole('button',{name:'저장'}))
  await waitFor(()=>expect(submit).toHaveBeenCalledOnce())
  expect(submit.mock.calls[0][0].servicePlan.rows.map(r=>r.payload.target_groups)).toEqual(groups.slice(0,5).map(g=>[g.code]))
})
test.each([false,true])('editing adds a new independent group without replacing existing targets (second slot: %s)',async(secondSlot)=>{
  const a={...make(1,'14:30',['dongtan']),groupServiceScope:true}
  const evening={...make(2,'17:00',['dongtan']),groupServiceScope:true}
  const other={...make(3,'14:30',['singal']),groupServiceScope:true}
  const groups=[{code:'dongtan',name:'东滩',active:true},{code:'singal',name:'新葛',active:true},{code:'new-code',name:'新增小组',active:true}]
  const submit=vi.fn(async()=>true),close=vi.fn()
  const props={language:'ko' as const,date:a.date,event:a,events:[a,evening,other],users,onClose:close,onSubmit:submit,globalSettings:{service_group_directory:JSON.stringify({revision:'2',groups})}}
  const {rerender}=render(<ServiceEventEditor {...props}/>)
  expect((screen.getByLabelText('东滩') as HTMLInputElement).disabled).toBe(true)
  expect(screen.queryByLabelText('新葛')).toBeNull()
  expect((screen.getByLabelText('新增小组') as HTMLInputElement).disabled).toBe(false)
  fireEvent.click(screen.getByLabelText('新增小组'))
  if(secondSlot)fireEvent.click(screen.getByLabelText(/함께 수정/))
  rerender(<ServiceEventEditor {...props} event={{...a,editVersion:'8'}} events={[{...a,editVersion:'8'},evening,other]}/>)
  fireEvent.click(screen.getByRole('button',{name:'저장'}))
  await waitFor(()=>expect(submit).toHaveBeenCalledOnce())
  const rows=submit.mock.calls[0][0].servicePlan.rows
  expect(rows.filter(r=>r.id).map(r=>[r.id,r.version,r.payload.target_groups])).toEqual(secondSlot?[[1,'1',['dongtan']],[2,'1',['dongtan']]]:[[1,'1',['dongtan']]])
  expect(rows.filter(r=>!r.id).map(r=>[r.payload.event_date,r.payload.time,r.payload.end_time,r.payload.target_groups])).toEqual(
    secondSlot?[[a.date,'14:30','16:30',['new-code']],[a.date,'17:00','19:00',['new-code']]]:[[a.date,'14:30','16:30',['new-code']]])
  expect(rows.some(r=>r.id===other.id)).toBe(false)
  expect(rows.filter(r=>!r.id).every(r=>!r.payload.series_id&&r.payload.group_service_scope)).toBe(true)
})
test.each(['19:00','18:00'])('adding a group preserves its existing companion event (end: %s)',async(endTime)=>{
  const a={...make(1,'14:30',['dongtan']),groupServiceScope:true}
  const b={...make(2,'17:00',['dongtan']),groupServiceScope:true}
  const existing={...make(3,'17:00',['new-code']),groupServiceScope:true,endTime,title:'Keep this title'}
  const groups=[{code:'dongtan',name:'东滩',active:true},{code:'new-code',name:'新增小组',active:true}]
  const submit=vi.fn(async()=>true)
  render(<ServiceEventEditor language="ko" date={a.date} event={a} events={[a,b,existing]} users={users} onClose={vi.fn()} onSubmit={submit} globalSettings={{service_group_directory:JSON.stringify({revision:'2',groups})}}/>)
  fireEvent.click(screen.getByLabelText('新增小组'));fireEvent.click(screen.getByLabelText(/함께 수정/))
  fireEvent.click(screen.getByRole('button',{name:'저장'}))
  if(endTime==='18:00'){
    expect((await screen.findByRole('alert')).textContent).toContain('종료 시간이 다른 일정')
    expect(submit).not.toHaveBeenCalled()
  }else{
    await waitFor(()=>expect(submit).toHaveBeenCalledOnce())
    expect(submit.mock.calls[0][0].servicePlan.rows.map(r=>[r.id,r.payload.time,r.payload.target_groups])).toEqual([[1,'14:30',['dongtan']],[2,'17:00',['dongtan']],[undefined,'14:30',['new-code']]])
  }
})
test('failed group extension keeps the selection and reuses the request ID without adding another group',async()=>{
  const a={...make(1,'14:30',['dongtan']),groupServiceScope:true},submit=vi.fn(async()=>false),close=vi.fn()
  render(<ServiceEventEditor language="ko" date={a.date} event={a} events={[a]} users={users} onClose={close} onSubmit={submit}/>)
  fireEvent.click(screen.getByLabelText('신갈'))
  fireEvent.click(screen.getByRole('button',{name:'저장'}));await waitFor(()=>expect(submit).toHaveBeenCalledTimes(1))
  await waitFor(()=>expect((screen.getByRole('button',{name:'저장'}) as HTMLButtonElement).disabled).toBe(false))
  expect((screen.getByLabelText('신갈') as HTMLInputElement).checked).toBe(true)
  fireEvent.click(screen.getByRole('button',{name:'저장'}));await waitFor(()=>expect(submit).toHaveBeenCalledTimes(2))
  expect(submit.mock.calls[0][0].servicePlan).toEqual(submit.mock.calls[1][0].servicePlan)
  expect(submit.mock.calls[0][0].servicePlan.rows).toHaveLength(2)
  expect(close).not.toHaveBeenCalled()
})
test('adds a second independent time slot only when requested',async()=>{
  const submit=vi.fn(async()=>true)
  render(<ServiceEventEditor language="ko" date="2026-11-25" events={[]} users={users} onClose={vi.fn()} onSubmit={submit}/>)
  fireEvent.click(screen.getByRole('button',{name:'집단봉사'}));for(const name of ['신갈','처인','동백'])fireEvent.click(screen.getByLabelText(name))
  fireEvent.change(screen.getByLabelText('제목'),{target:{value:'Group service'}})
  expect(screen.getAllByLabelText('시작 시간')).toHaveLength(1)
  fireEvent.click(screen.getByRole('button',{name:'시간대 추가'}))
  fireEvent.click(screen.getByLabelText('Leader'))
  fireEvent.click(screen.getByRole('button',{name:'저장'}))
  await waitFor(()=>expect(submit).toHaveBeenCalledOnce())
  const plan=submit.mock.calls[0][0].servicePlan
  expect(plan.rows.map(r=>[r.payload.time,r.payload.end_time,r.payload.primary_leader_user_id])).toEqual([['14:30','16:30',2],['17:00','19:00',2]])
  expect(plan.rows.every(r=>r.payload.leader_name==='Leader')).toBe(true)
})
test('editing submits exact selected IDs and opening versions, never advances on background refresh',async()=>{
  const a=make(1),b=make(2,'17:00'),submit=vi.fn(async()=>true),close=vi.fn()
  const {rerender}=render(<ServiceEventEditor language="ko" date={a.date} event={a} events={[a,b]} users={users} onClose={close} onSubmit={submit}/>)
  fireEvent.click(screen.getByLabelText(/함께 수정/))
  rerender(<ServiceEventEditor language="ko" date={a.date} event={{...a,editVersion:'2'}} events={[{...a,editVersion:'2'},b]} users={users} onClose={close} onSubmit={submit}/>)
  fireEvent.click(screen.getByRole('button',{name:'저장'}));await waitFor(()=>expect(submit).toHaveBeenCalledOnce())
  expect(submit.mock.calls[0][0].servicePlan.rows.map(r=>[r.id,r.version,r.payload.time])).toEqual([[1,'1','14:30'],[2,'1','17:00']])
  expect(a.editVersion).toBe('1')
})
test('failed save keeps form and uses same request ID on retry',async()=>{
  const a=make(1),submit=vi.fn(async()=>false),close=vi.fn()
  render(<ServiceEventEditor language="ko" date={a.date} event={a} events={[a]} users={users} onClose={close} onSubmit={submit}/>)
  fireEvent.click(screen.getByRole('button',{name:'저장'}));await waitFor(()=>expect(submit).toHaveBeenCalledTimes(1))
  await waitFor(()=>expect((screen.getByRole('button',{name:'저장'}) as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(screen.getByRole('button',{name:'저장'}));await waitFor(()=>expect(submit).toHaveBeenCalledTimes(2))
  expect(submit.mock.calls[0][0].servicePlan.requestId).toBe(submit.mock.calls[1][0].servicePlan.requestId);expect(close).not.toHaveBeenCalled()
})
test('selection order determines primary without separate primary or co-leader controls',async()=>{
  const a=make(1),submit=vi.fn(async()=>true)
  render(<ServiceEventEditor language="ko" date={a.date} event={a} events={[a]} users={[...users,{id:4,name:'Replacement',role:'leader'}]} onClose={vi.fn()} onSubmit={submit}/>)
  expect(screen.queryByLabelText('주 인도자')).toBeNull()
  expect(screen.queryByText('공동 인도자')).toBeNull()
  fireEvent.click(screen.getByLabelText('Replacement'))
  fireEvent.click(screen.getByLabelText('Leader'))
  fireEvent.click(screen.getByLabelText('Leader'))
  fireEvent.click(screen.getByRole('button',{name:'저장'}))
  await waitFor(()=>expect(submit).toHaveBeenCalledOnce())
  expect(submit.mock.calls[0][0].servicePlan.rows[0].payload.leader_name).toBe('Replacement, Leader')
  expect(submit.mock.calls[0][0].servicePlan.rows[0].payload.primary_leader_user_id).toBe(4)
})
test('Chinese labels and names render without replacing persisted codes',()=>{
  setCurrentLang('zh');render(<ServiceEventEditor language="zh" date="2026-11-25" events={[]} users={users} onClose={vi.fn()} onSubmit={vi.fn()}/>)
  fireEvent.click(screen.getByRole('button',{name:'小组传道'}));expect(screen.getByLabelText('东滩')).toBeTruthy();expect(screen.getByLabelText('Leader')).toBeTruthy();expect(screen.queryByText('主要主持人')).toBeNull()
})
test('weekly templates keep separate time series and do not preassign rotating leaders',async()=>{
  const submit=vi.fn(async()=>true)
  render(<ServiceEventEditor language="ko" date="2026-11-25" events={[]} users={users} onClose={vi.fn()} onSubmit={submit}/>)
  fireEvent.click(screen.getByRole('button',{name:'집단봉사'}));for(const name of ['신갈','처인','동백'])fireEvent.click(screen.getByLabelText(name))
  fireEvent.change(screen.getByLabelText('제목'),{target:{value:'Weekly'}})
  fireEvent.click(screen.getByRole('button',{name:'시간대 추가'}))
  fireEvent.click(screen.getByLabelText('Leader'))
  fireEvent.change(screen.getByLabelText('반복 종료일 (선택)'),{target:{value:'2026-12-02'}})
  fireEvent.click(screen.getByRole('button',{name:'저장'}))
  await waitFor(()=>expect(submit).toHaveBeenCalledOnce())
  const rows=submit.mock.calls[0][0].servicePlan.rows
  expect(rows).toHaveLength(4)
  expect(rows.every(r=>r.payload.primary_leader_user_id===null&&r.payload.leader_name==='')).toBe(true)
  expect(rows[0].payload.series_id).toBe(rows[2].payload.series_id)
  expect(rows[0].payload.series_id).not.toBe(rows[1].payload.series_id)
})
test('single slot uses saved shared presets and accepts completely empty virtual access',async()=>{
  const submit=vi.fn(async()=>true)
  render(<ServiceEventEditor language="ko" date="2026-11-25" events={[]} users={users} onClose={vi.fn()} onSubmit={submit} globalSettings={{calendar_time_presets:JSON.stringify([{label:'오후',time:'14:30',durationMinutes:90,title:'Saved title'}])}}/>)
  fireEvent.click(screen.getByRole('button',{name:'집단봉사'}));for(const name of ['신갈','처인','동백'])fireEvent.click(screen.getByLabelText(name))
  fireEvent.click(screen.getByRole('button',{name:'시간대 추가'}))
  fireEvent.click(screen.getByRole('button',{name:'시간대 1 삭제'}))
  fireEvent.change(screen.getByLabelText('자주 쓰는 시간'),{target:{value:'0'}})
  fireEvent.click(screen.getByLabelText('Leader'))
  fireEvent.change(screen.getByLabelText('봉사 모임'),{target:{value:'virtual'}})
  fireEvent.click(screen.getByRole('button',{name:'저장'}))
  await waitFor(()=>expect(submit).toHaveBeenCalledOnce())
  expect(submit.mock.calls[0][0].servicePlan.rows).toHaveLength(1)
  expect(submit.mock.calls[0][0].servicePlan.rows[0].payload).toMatchObject({time:'14:30',end_time:'16:00',title:'Saved title',access:{joinUrl:'',meetingNumber:'',passcode:''}})
})
test('meeting join action shares the compact heading and retains its accessible name',async()=>{
  mocks.read.mockResolvedValue({joinUrl:'https://example.com',meetingNumber:'123',passcode:'secret',version:'1'})
  render(<MeetingAccessPanel eventId={1} version="1"/>)
  const link=await screen.findByRole('link',{name:'화상 모임 참여'})
  expect(link.textContent).toBe('참여 ↗')
  expect(link.closest('.gs-meeting-heading')?.querySelector('h3')?.textContent).toBe('화상 모임')
  expect(link.getAttribute('href')).toBe('https://example.com')
  expect(screen.getByRole('button',{name:'비밀번호 복사'})).toBeTruthy()
})
test('empty meeting details render an intentional empty state, not a loading error',async()=>{
  mocks.read.mockResolvedValue({joinUrl:'',meetingNumber:'',passcode:'',version:'1'})
  render(<MeetingAccessPanel eventId={1} version="1"/>)
  await waitFor(()=>expect(screen.getByText('접속 정보 미등록')).toBeTruthy())
  expect(screen.queryByRole('link')).toBeNull()
})
test('meeting access cannot render a previous event or previous account response',async()=>{
  const pending:((value:unknown)=>void)[]=[]
  mocks.read.mockImplementation(()=>new Promise(r=>{pending.push(r)}))
  const {rerender}=render(<MeetingAccessPanel eventId={1} version="1"/>);
  rerender(<MeetingAccessPanel eventId={2} version="1"/>);
  pending[0]({joinUrl:'https://example.com',meetingNumber:'old',passcode:'old-secret'})
  await waitFor(()=>expect(screen.queryByText('비밀번호: old-secret')).toBeNull())
  pending[1]({joinUrl:'https://example.com',meetingNumber:'123',passcode:'secret'})
  await waitFor(()=>expect(screen.getByText('비밀번호: secret')).toBeTruthy())
  mocks.token.mockReturnValue('different');rerender(<MeetingAccessPanel eventId={2} version="1"/>);
  expect(screen.queryByText('비밀번호: secret')).toBeNull()
})
