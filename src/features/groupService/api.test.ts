import { beforeEach,expect,test,vi } from 'vitest'
import { confirmOverlappingApplication } from './api'

const mocks=vi.hoisted(()=>({rpc:vi.fn(),confirm:vi.fn()}))
vi.mock('../../lib/supabase',()=>({supabase:{rpc:mocks.rpc}}))
vi.mock('../../lib/authToken',()=>({getAuthToken:()=> 'session'}))
vi.mock('../../lib/confirm',()=>({confirmDialog:mocks.confirm}))
beforeEach(()=>vi.resetAllMocks())
test('overlap confirmation permits explicit additional application or returns cancellation',async()=>{
  mocks.rpc.mockResolvedValue({data:[{id:1,title:'Other group',time:'14:30',endTime:'16:30',unknown:false}],error:null})
  mocks.confirm.mockResolvedValueOnce(false).mockResolvedValueOnce(true)
  expect(await confirmOverlappingApplication(2)).toBe(false)
  expect(await confirmOverlappingApplication(2)).toBe(true)
  expect(mocks.rpc).toHaveBeenCalledWith('get_event_application_overlaps',{p_event_id:2})
  expect(mocks.confirm.mock.calls[0][0].message).toContain('Other group')
})
test('no overlap bypasses the prompt but server failure cannot bypass the check',async()=>{
  mocks.rpc.mockResolvedValueOnce({data:[],error:null}).mockResolvedValueOnce({data:null,error:{message:'offline'}})
  expect(await confirmOverlappingApplication(2)).toBe(true)
  await expect(confirmOverlappingApplication(2)).rejects.toThrow()
  expect(mocks.confirm).not.toHaveBeenCalled()
})
