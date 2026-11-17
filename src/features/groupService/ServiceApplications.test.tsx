import {afterEach,expect,test,vi} from 'vitest'
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react'
import {ServiceApplicationButtons,ReturnVisitApplicants} from './ServiceApplications'
import {territoryApplicants} from './model'
import {toCalendarEvent,type RawCalendarEvent} from '../../hooks/storeTransforms'
import {attendanceMeetings} from '../../utils/serviceAttendance'
import {setCurrentLang} from '../../i18n'
afterEach(()=>{cleanup();setCurrentLang('ko')})
const event=()=>toCalendarEvent({id:7,event_date:'2026-11-15',time:'14:30',title:'Service',allow_applications:true,has_meeting:true,
  event_participants:[{user_name:'A',role:'신청',service_activity:'service'},{user_name:'B',role:'신청',service_activity:'return_visit'}]} as RawCalendarEvent)
test('return visits remain in total counts and separate list but not assignment candidates',()=>{
  const e=event()
  expect(e.applicants).toEqual(['A','B'])
  expect(e.returnVisitApplicants).toEqual(['B'])
  expect(territoryApplicants(e)).toEqual(['A'])
  expect(attendanceMeetings([e],'2026-11',new Date('2026-11-16T12:00:00'))[0].count).toBe(2)
  render(<ReturnVisitApplicants event={e}/>)
  expect(screen.getByText('B',{selector:'.gs-participant > span:not([aria-hidden])'})).toBeTruthy();expect(screen.queryByText('A')).toBeNull()
})
test('two application buttons send exact activities and cancellation sends no new application',async()=>{
  const apply=vi.fn(),cancel=vi.fn(),e=event()
  const {rerender}=render(<ServiceApplicationButtons event={e} currentVisitor="C" onApply={apply} onCancel={cancel}/>)
  fireEvent.click(screen.getByRole('button',{name:'재방·연구 신청'}))
  await waitFor(()=>expect(apply).toHaveBeenCalledWith('return_visit'))
  fireEvent.click(screen.getByRole('button',{name:'봉사 신청',exact:true}))
  await waitFor(()=>expect(apply).toHaveBeenCalledWith('service'))
  rerender(<ServiceApplicationButtons event={e} currentVisitor="B" onApply={apply} onCancel={cancel}/>)
  expect(screen.queryByText('재방·연구 신청 완료')).toBeNull()
  expect(screen.getAllByRole('button')).toHaveLength(1)
  expect(screen.queryByRole('button',{name:'봉사 신청',exact:true})).toBeNull()
  fireEvent.click(screen.getByRole('button',{name:'재방·연구 신청 취소'}))
  await waitFor(()=>expect(cancel).toHaveBeenCalledOnce())
  expect(apply).toHaveBeenCalledTimes(2)
  rerender(<ServiceApplicationButtons event={e} currentVisitor="A" onApply={apply} onCancel={cancel}/>)
  expect(screen.getByRole('button',{name:'봉사 신청 취소'})).toBeTruthy()
  expect(screen.queryByText('봉사 신청 완료')).toBeNull()
})
test('pending request blocks double taps; Chinese activity is translated',async()=>{
  setCurrentLang('zh')
  let finish!:()=>void
  const apply=vi.fn(()=>new Promise<void>(resolve=>{finish=resolve}))
  render(<ServiceApplicationButtons event={event()} currentVisitor="C" onApply={apply}/>)
  const button=screen.getByRole('button',{name:'报名续访·圣经课程'})
  fireEvent.click(button);fireEvent.click(button)
  expect(apply).toHaveBeenCalledOnce();expect(button).toHaveProperty('disabled',true)
  finish();await waitFor(()=>expect(button).toHaveProperty('disabled',false))
})
