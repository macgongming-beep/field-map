import { afterEach,expect,test,vi } from 'vitest'
import { assignmentRevisionEnabled } from './assignmentRevision'
import { groupServiceEnabled,canArrangeService,canEditServiceSchedule } from '../features/groupService/model'
import { teamServiceEnabled } from './teamService'
import type { CalendarEvent } from '../types'
afterEach(()=>vi.unstubAllEnvs())
test('production defaults off; assignment rollout is independent of group display and demo tools',()=>{
  vi.stubEnv('VITE_DEMO_MODE','false');vi.stubEnv('VITE_ASSIGNMENT_REVISION_ENABLED',undefined)
  vi.stubEnv('VITE_GROUP_SERVICE_ENABLED','true');vi.stubEnv('VITE_TEAM_SERVICE_ENABLED','false')
  vi.stubEnv('VITE_SUPABASE_URL','https://qdxemvdorasoryfysuoq.supabase.co')
  expect(assignmentRevisionEnabled()).toBe(false);expect(groupServiceEnabled()).toBe(false)
  vi.stubEnv('VITE_ASSIGNMENT_REVISION_ENABLED','true')
  expect(assignmentRevisionEnabled()).toBe(true);expect(groupServiceEnabled()).toBe(true);expect(teamServiceEnabled()).toBe(true)
  vi.stubEnv('VITE_GROUP_SERVICE_ENABLED','false')
  expect(groupServiceEnabled()).toBe(false);expect(assignmentRevisionEnabled()).toBe(true)
  const event={leaders:['Somebody else']} as CalendarEvent
  expect(canArrangeService('leader',event,'Me')).toBe(true)
  expect(canEditServiceSchedule('leader',event,'Me')).toBe(false)
  expect(canEditServiceSchedule('admin',event,'Me')).toBe(true)
})
test('explicit revision off wins even on demo; unknown projects never inherit demo authorization',()=>{
  vi.stubEnv('VITE_DEMO_MODE','true');vi.stubEnv('VITE_GROUP_SERVICE_ENABLED','true')
  vi.stubEnv('VITE_ASSIGNMENT_REVISION_ENABLED','false')
  vi.stubEnv('VITE_SUPABASE_URL','https://itjlykpjmlcvanqpmkmc.supabase.co')
  expect(assignmentRevisionEnabled()).toBe(false);expect(groupServiceEnabled()).toBe(false)
  vi.stubEnv('VITE_ASSIGNMENT_REVISION_ENABLED',undefined)
  expect(assignmentRevisionEnabled()).toBe(true)
  vi.stubEnv('VITE_SUPABASE_URL','https://unknown.supabase.co')
  expect(assignmentRevisionEnabled()).toBe(false);expect(groupServiceEnabled()).toBe(false)
})
