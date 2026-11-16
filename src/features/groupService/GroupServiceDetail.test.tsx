import {afterEach,beforeEach,expect,test,vi} from 'vitest'
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react'
import {GroupServiceDetail} from './GroupServiceDetail'
import {ServiceEventList} from './ServiceEventList'
import {ServiceEventEditor} from './ServiceEventEditor'
import type {CalendarEvent} from '../../types'
import {setCurrentLang} from '../../i18n'
import {visibleServiceEventCount} from './model'
const mocks=vi.hoisted(()=>({context:vi.fn()}))
vi.mock('./api',()=>({readGroupServiceContext:mocks.context,readMeetingAccess:vi.fn()}))
const events=['dongtan','singal','cheoin','dongbaek'].map((code,i)=>({id:i+1,date:'2026-11-18',time:'14:30',endTime:'16:30',groupServiceScope:true,serviceKind:'group',targetGroups:[code],title:'Group',leader:'',leaders:[],applicants:[`Member${i}`],assigned:[],returnVisitApplicants:i===0?['Return']:[],cardAssignments:[],allowApplications:true,place:'',memo:'',meetingMode:'none',editVersion:'1',guests:[],card:'',type:'주택',hasMeeting:false} as CalendarEvent))
beforeEach(()=>{setCurrentLang('ko');mocks.context.mockResolvedValue({ownGroup:'dongtan',events:events.map((e,i)=>({id:e.id,groupCode:e.targetGroups![0],count:1,canManage:i===0,canRead:i===0}))})})
afterEach(()=>{cleanup();vi.clearAllMocks();setCurrentLang('ko')})
test('one calendar entry opens home group and keeps legacy events separate',()=>{
  const open=vi.fn()
  const mixed=[...events,{...events[0],id:9,groupServiceScope:false}]
  expect(visibleServiceEventCount(mixed)).toBe(2)
  render(<ServiceEventList language="ko" events={mixed} groupName="新葛" onOpen={open} statusById={{1:'join'}}/>)
  expect(screen.getAllByRole('button')).toHaveLength(2)
  expect(screen.getByText('신청 완료')).toBeTruthy()
  fireEvent.click(screen.getAllByRole('button')[0]);expect(open).toHaveBeenCalledWith(2)
})
test('tab selection routes application to exact child and never exposes unauthorized roster or tools',async()=>{
  const apply=vi.fn(),assign=vi.fn(),edit=vi.fn()
  render(<GroupServiceDetail event={events[0]} events={events} language="ko" currentVisitor="User" onApply={apply} onAssignment={assign} onEdit={edit}/>)
  await screen.findByRole('tab',{name:'동탄 1'})
  expect(screen.getByText('Member0')).toBeTruthy()
  fireEvent.click(screen.getByRole('button',{name:'팀 구성 · 구역 배정'}));expect(assign).toHaveBeenCalledWith(1)
  fireEvent.click(screen.getByRole('tab',{name:'신갈 1'}))
  expect(screen.queryByText('Member0')).toBeNull();expect(screen.queryByText('Member1')).toBeNull()
  expect(screen.queryByRole('button',{name:'팀 구성 · 구역 배정'})).toBeNull()
  expect(screen.queryByRole('button',{name:'일정 수정'})).toBeNull()
  fireEvent.click(screen.getByRole('button',{name:'재방·연구 신청'}));expect(apply).toHaveBeenCalledWith(2,'return_visit')
  await waitFor(()=>expect((screen.getByRole('button',{name:'봉사 신청'}) as HTMLButtonElement).disabled).toBe(false))
})
test('failed context is closed to names and management, retry restores only allowed group',async()=>{
  mocks.context.mockRejectedValueOnce(Error('network'))
  render(<GroupServiceDetail event={events[0]} events={events} language="ko" currentVisitor="User" onAssignment={vi.fn()}/>)
  await screen.findByRole('alert');expect(screen.queryByText('Member0')).toBeNull()
  fireEvent.click(screen.getByRole('button',{name:'다시 시도'}));await screen.findByRole('tab',{name:'동탄 1'})
})
test('shared assignments open automatically but meeting info stays collapsed and foreign results stay hidden',async()=>{
  const assigned=events.map(e=>({...e,assignmentStatus:'draft' as const,cardAssignments:[{id:e.id,eventId:e.id,userName:e.applicants[0],assignedCardId:1,assignedBy:'Admin',assignedAt:'',memo:''}]}))
  const props={event:assigned[0],events:assigned,language:'ko' as const,currentVisitor:'User',renderAssignments:(e:CalendarEvent)=><div>{`Team ${e.id}`}</div>}
  const {rerender}=render(<GroupServiceDetail {...props}/> )
  await screen.findByRole('tab',{name:'동탄 1'})
  expect(screen.queryByText('배정 결과')).toBeNull()
  const shared=assigned.map(e=>({...e,assignmentStatus:'shared' as const}))
  rerender(<GroupServiceDetail {...props} event={shared[0]} events={shared}/> )
  const result=screen.getByText('배정 결과').closest('details')!
  expect(result.open).toBe(true)
  expect(screen.getByText('모임 정보').closest('details')!.open).toBe(false)
  fireEvent.click(screen.getByText('배정 결과'))
  expect(result.open).toBe(false)
  rerender(<GroupServiceDetail {...props} event={shared[0]} events={shared}/> )
  expect(result.open).toBe(false)
  fireEvent.click(screen.getByRole('tab',{name:'신갈 1'}))
  expect(screen.queryByText('배정 결과')).toBeNull()
  expect(screen.queryByText('Team 2')).toBeNull()
  fireEvent.click(screen.getByRole('tab',{name:'동탄 1'}))
  expect(screen.getByText('배정 결과').closest('details')!.open).toBe(true)
})
test('new group schedule expands four independent children per time with separate weekly series',async()=>{
  const submit=vi.fn(async()=>true)
  render(<ServiceEventEditor date="2026-11-18" events={[]} users={[]} language="ko" onClose={vi.fn()} onSubmit={submit}/>)
  fireEvent.click(screen.getByRole('button',{name:'집단봉사'}))
  fireEvent.change(screen.getByLabelText('제목'),{target:{value:'집단 봉사'}})
  fireEvent.change(screen.getByLabelText('반복 종료일 (선택)'),{target:{value:'2026-11-25'}})
  fireEvent.click(screen.getByRole('button',{name:'시간대 추가'}));fireEvent.click(screen.getByRole('button',{name:'저장'}))
  await waitFor(()=>expect(submit).toHaveBeenCalledOnce())
  const rows=submit.mock.calls[0][0].servicePlan.rows
  expect(rows).toHaveLength(16)
  expect(new Set(rows.map(r=>r.payload.series_id)).size).toBe(8)
  expect(rows.every(r=>r.payload.group_service_scope&&r.payload.target_groups.length===1)).toBe(true)
})
