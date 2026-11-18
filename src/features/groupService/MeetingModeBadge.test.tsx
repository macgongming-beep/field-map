import {afterEach,expect,test,vi} from 'vitest'
import {cleanup,render,screen} from '@testing-library/react'
import {ServiceEventList} from './ServiceEventList'
import type {CalendarEvent} from '../../types'
const base={id:1,date:'2026-11-25',time:'13:00',endTime:'15:00',title:'传道',leader:'Leader',serviceKind:'congregation',hasMeeting:false,place:'Hall'} as CalendarEvent
afterEach(cleanup)
test.each([['in_person','现场'],['virtual','线上'],['none',null],[undefined,null]] as const)('meeting %s is beside the title only', (mode,label)=>{
  const {container}=render(<ServiceEventList events={[{...base,meetingMode:mode}]} language="ko" onOpen={vi.fn()}/>)
  const badge=container.querySelector('.gs-meeting-badge')
  if(label){expect(badge?.textContent).toBe(label);expect(badge?.parentElement?.textContent).toBe(`传道${label}`)}
  else expect(badge).toBeNull()
  expect(screen.getByText(mode==='virtual'?'Leader':'Leader · Hall')).toBeTruthy()
})
test('legacy meeting flag is preserved, but explicit none takes precedence',()=>{
  const {container,rerender}=render(<ServiceEventList events={[{...base,hasMeeting:true}]} language="ko" onOpen={vi.fn()}/>)
  expect(container.querySelector('.gs-meeting-badge')?.textContent).toBe('现场')
  rerender(<ServiceEventList events={[{...base,hasMeeting:true,meetingMode:'none'}]} language="ko" onOpen={vi.fn()}/>)
  expect(container.querySelector('.gs-meeting-badge')).toBeNull()
})
test('mixed group meeting modes do not mislabel a combined schedule',()=>{
  const events=[{...base,serviceKind:'group',groupServiceScope:true,targetGroups:['dongtan'],meetingMode:'in_person'},
    {...base,id:2,serviceKind:'group',groupServiceScope:true,targetGroups:['singal'],meetingMode:'virtual'}] as CalendarEvent[]
  const {container,rerender}=render(<ServiceEventList events={events} language="ko" onOpen={vi.fn()}/>)
  expect(container.querySelector('.gs-meeting-badge')).toBeNull()
  rerender(<ServiceEventList events={events.map(e=>({...e,meetingMode:'virtual'}))} language="ko" onOpen={vi.fn()}/>)
  expect(container.querySelector('.gs-meeting-badge')?.textContent).toBe('线上')
})
