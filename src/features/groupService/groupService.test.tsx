import { afterEach,beforeEach,expect,test,vi } from 'vitest'
import { cleanup,fireEvent,render,screen,waitFor } from '@testing-library/react'
import { ServiceEventEditor } from './ServiceEventEditor'
import { ServiceEventList } from './ServiceEventList'
import { MeetingAccessPanel } from './MeetingAccessPanel'
import { eventBlocks,groupServiceEnabled } from './model'
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
test('feature cannot activate on production or outside demo, explicit false disables it',()=>{
  expect(groupServiceEnabled()).toBe(true)
  expect(willNotifyOnEventChange({endTime:'16:00'},{endTime:'16:30'})).toBe(true)
  expect(willNotifyOnEventChange({allowApplications:true},{allowApplications:false})).toBe(true)
  vi.stubEnv('VITE_SUPABASE_URL','https://qdxemvdorasoryfysuoq.supabase.co');expect(groupServiceEnabled()).toBe(false)
  vi.stubEnv('VITE_SUPABASE_URL','https://itjlykpjmlcvanqpmkmc.supabase.co');vi.stubEnv('VITE_DEMO_MODE','false');expect(groupServiceEnabled()).toBe(false)
  vi.stubEnv('VITE_DEMO_MODE','true');vi.stubEnv('VITE_GROUP_SERVICE_ENABLED','false');expect(groupServiceEnabled()).toBe(false)
})
test('groups visually by day and canonical targets without dropping ungrouped or other events',()=>{
  const events=[make(1),make(2,'17:00',['singal','dongtan']),make(3,'14:30',['cheoin']),{...make(4),serviceKind:undefined},{...make(5),date:'2026-11-26'}]
  expect(eventBlocks(events).map(b=>b.map(e=>e.id))).toEqual([[1,2],[3],[4],[5]])
  expect(eventBlocks(events,'处仁')[0].map(e=>e.id)).toEqual([3])
  const open=vi.fn();render(<ServiceEventList events={events} language="ko" onOpen={open}/>);fireEvent.click(screen.getAllByRole('button')[1]);expect(open).toHaveBeenCalledWith(2)
})
test('creates two distinct time slots with explicit primary and immutable original events',async()=>{
  const submit=vi.fn(async()=>true)
  render(<ServiceEventEditor language="ko" date="2026-11-25" events={[]} users={users} onClose={vi.fn()} onSubmit={submit}/>)
  fireEvent.click(screen.getByRole('button',{name:'집단봉사'}));fireEvent.click(screen.getByLabelText('동탄'))
  fireEvent.change(screen.getByLabelText('제목'),{target:{value:'Group service'}})
  fireEvent.change(screen.getByLabelText('주 인도자'),{target:{value:'2'}})
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
test('changing primary removes the old primary while preserving other co-leaders',async()=>{
  const a={...make(1),leader:'Leader, Co-leader',leaders:['Leader','Co-leader']},submit=vi.fn(async()=>true)
  render(<ServiceEventEditor language="ko" date={a.date} event={a} events={[a]} users={[...users,{id:4,name:'Replacement',role:'leader'}]} onClose={vi.fn()} onSubmit={submit}/>)
  fireEvent.change(screen.getByLabelText('주 인도자'),{target:{value:'4'}})
  fireEvent.click(screen.getByRole('button',{name:'저장'}))
  await waitFor(()=>expect(submit).toHaveBeenCalledOnce())
  expect(submit.mock.calls[0][0].servicePlan.rows[0].payload.leader_name).toBe('Co-leader, Replacement')
})
test('Chinese labels and names render without replacing persisted codes',()=>{
  setCurrentLang('zh');render(<ServiceEventEditor language="zh" date="2026-11-25" events={[]} users={users} onClose={vi.fn()} onSubmit={vi.fn()}/>)
  fireEvent.click(screen.getByRole('button',{name:'小组传道'}));expect(screen.getByLabelText('东滩')).toBeTruthy();expect(screen.getByLabelText('主要主持人')).toBeTruthy()
})
test('weekly templates keep separate time series and do not preassign rotating leaders',async()=>{
  const submit=vi.fn(async()=>true)
  render(<ServiceEventEditor language="ko" date="2026-11-25" events={[]} users={users} onClose={vi.fn()} onSubmit={submit}/>)
  fireEvent.click(screen.getByRole('button',{name:'집단봉사'}));fireEvent.click(screen.getByLabelText('동탄'))
  fireEvent.change(screen.getByLabelText('제목'),{target:{value:'Weekly'}})
  fireEvent.change(screen.getByLabelText('주 인도자'),{target:{value:'2'}})
  fireEvent.change(screen.getByLabelText('반복 종료일 (선택)'),{target:{value:'2026-12-02'}})
  fireEvent.click(screen.getByRole('button',{name:'저장'}))
  await waitFor(()=>expect(submit).toHaveBeenCalledOnce())
  const rows=submit.mock.calls[0][0].servicePlan.rows
  expect(rows).toHaveLength(4)
  expect(rows.every(r=>r.payload.primary_leader_user_id===null&&r.payload.leader_name==='')).toBe(true)
  expect(rows[0].payload.series_id).toBe(rows[2].payload.series_id)
  expect(rows[0].payload.series_id).not.toBe(rows[1].payload.series_id)
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
