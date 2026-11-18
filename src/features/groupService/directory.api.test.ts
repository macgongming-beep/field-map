import {afterEach,expect,test,vi} from 'vitest'
import {manageServiceGroup} from './api'
import {GROUP_DIRECTORY_CHANGED} from './directory'
const mocks=vi.hoisted(()=>({rpc:vi.fn(),token:vi.fn(()=> 'admin-session')}))
vi.mock('../../lib/supabase',()=>({supabase:{rpc:mocks.rpc}}))
vi.mock('../../lib/authToken',()=>({getAuthToken:mocks.token}))
const directory={revision:'2',groups:[{code:'fixed',name:'新名称',active:true}]}
afterEach(()=>{vi.restoreAllMocks();mocks.token.mockReset().mockReturnValue('admin-session')})
test('one management RPC publishes returned names locally without another settings read',async()=>{
  mocks.rpc.mockResolvedValue({data:JSON.stringify(directory),error:null})
  const dispatch=vi.spyOn(window,'dispatchEvent')
  expect(await manageServiceGroup('rename','fixed','新名称','1')).toEqual(directory)
  expect(mocks.rpc).toHaveBeenCalledWith('manage_service_group_tx',{p_token:'admin-session',p_action:'rename',p_code:'fixed',p_name:'新名称',p_expected_revision:'1'})
  expect(dispatch.mock.calls.map(([e])=>e.type)).toEqual([GROUP_DIRECTORY_CHANGED,'app-users-changed'])
  expect(JSON.parse((dispatch.mock.calls[0][0] as CustomEvent).detail)).toEqual(directory)
})
test('failed saves and a response for a previous session never publish local changes',async()=>{
  const dispatch=vi.spyOn(window,'dispatchEvent')
  mocks.rpc.mockResolvedValueOnce({data:null,error:{code:'PT409'}})
  await expect(manageServiceGroup('rename','fixed','新名称','1')).rejects.toThrow()
  mocks.rpc.mockResolvedValueOnce({data:JSON.stringify(directory),error:null})
  mocks.token.mockReturnValueOnce('old-session').mockReturnValue('new-session')
  await expect(manageServiceGroup('rename','fixed','新名称','1')).rejects.toThrow()
  expect(dispatch).not.toHaveBeenCalled()
})
