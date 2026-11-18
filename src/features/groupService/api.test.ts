import { beforeEach,expect,test,vi } from 'vitest'
import { confirmOverlappingApplication,readServiceSeriesTargets } from './api'

const mocks=vi.hoisted(()=>({rpc:vi.fn(),confirm:vi.fn(),token:vi.fn(()=> 'session')}))
vi.mock('../../lib/supabase',()=>({supabase:{rpc:mocks.rpc}}))
vi.mock('../../lib/authToken',()=>({getAuthToken:mocks.token}))
vi.mock('../../lib/confirm',()=>({confirmDialog:mocks.confirm}))
beforeEach(()=>{vi.resetAllMocks();mocks.token.mockReturnValue('session')})
test('series reads use exact roots and reject missing, malformed, stale or cross-session responses',async()=>{
  const roots=[{id:1,version:'3'}],rows=[{rootId:1,id:1,version:'3',payload:{}}]
  mocks.rpc.mockResolvedValueOnce({data:rows,error:null})
  expect(await readServiceSeriesTargets(roots)).toEqual(rows)
  expect(mocks.rpc).toHaveBeenCalledWith('read_service_series_edit_targets',{p_token:'session',p_roots:roots})
  for(const response of [{data:[],error:null},{data:rows,error:{code:'PT409'}},{data:[{id:1}],error:null}]){
    mocks.rpc.mockResolvedValueOnce(response);await expect(readServiceSeriesTargets(roots)).rejects.toThrow()
  }
  mocks.rpc.mockImplementationOnce(async()=>{mocks.token.mockReturnValue('changed');return {data:rows,error:null}})
  await expect(readServiceSeriesTargets(roots)).rejects.toThrow()
})
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
