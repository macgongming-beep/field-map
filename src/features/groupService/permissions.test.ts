import {afterEach,expect,test,vi} from 'vitest'
import {canArrangeService,canEditServiceSchedule,groupSlotEvents} from './model'
import type {CalendarEvent} from '../../types'
afterEach(()=>vi.unstubAllEnvs())
test('demo congregation and group allow every leader to arrange, only admins to edit',()=>{
  vi.stubEnv('VITE_DEMO_MODE','true');vi.stubEnv('VITE_SUPABASE_URL','https://itjlykpjmlcvanqpmkmc.supabase.co')
  for(const groupServiceScope of [true,false]){
    const e={leaders:['Named'],groupServiceScope} as CalendarEvent
    expect(canArrangeService('leader',e,'Other')).toBe(true)
    expect(canArrangeService('user',e,'Named')).toBe(false)
    expect(canEditServiceSchedule('leader',e,'Named')).toBe(false)
    expect(canEditServiceSchedule('admin',e,'Other')).toBe(true)
  }
  vi.stubEnv('VITE_DEMO_MODE','false')
  const e={leaders:['Named']} as CalendarEvent
  expect(canArrangeService('leader',e,'Other')).toBe(false)
  expect(canEditServiceSchedule('leader',e,'Named')).toBe(true)
})
test('missing end times have one group slot identity',()=>{
  const base={id:1,groupServiceScope:true,date:'2026-11-18',time:'14:30'} as CalendarEvent
  expect(groupSlotEvents(base,[base,{...base,id:2,endTime:''}])).toHaveLength(2)
})
