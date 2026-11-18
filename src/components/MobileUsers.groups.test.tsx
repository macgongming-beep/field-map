import {afterEach,beforeEach,expect,test,vi} from 'vitest'
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react'
import {MemoryRouter} from 'react-router-dom'
import {MobileUsers} from './MobileUsers'
const mocks=vi.hoisted(()=>({manage:vi.fn(),legacyRename:vi.fn(),toast:vi.fn(),fetch:vi.fn(),directory:{revision:'1',groups:[{code:'fixed',name:'原名',active:true}]}}))
vi.mock('../hooks/useAuth',()=>({useAuth:()=>({user:{id:1,role:'admin'},allUsers:[],fetchAllUsers:mocks.fetch,renameUserGroup:mocks.legacyRename})}))
vi.mock('../lib/supabase',()=>({supabase:{from:()=>({select:()=>({in:async()=>({data:[{key:'service_group_directory',value:JSON.stringify(mocks.directory)}],error:null})})})}}))
vi.mock('../features/groupService/api',()=>({manageServiceGroup:mocks.manage}))
vi.mock('../lib/toast',()=>({showToast:mocks.toast}))
vi.mock('../lib/confirm',()=>({confirmDialog:async()=>true}))
beforeEach(()=>{vi.clearAllMocks();mocks.directory={revision:'1',groups:[{code:'fixed',name:'原名',active:true}]}})
afterEach(cleanup)
async function open(){render(<MemoryRouter><MobileUsers isEmbedded/></MemoryRouter>);await screen.findByRole('option',{name:'原名 (0)'});fireEvent.click(screen.getByLabelText('사용자 관리 더보기'));fireEvent.click(screen.getByRole('button',{name:'집단 편집'}))}
test('renames an empty group atomically by code, never calls the old membership-only rename',async()=>{
  mocks.manage.mockResolvedValue({revision:'2',groups:[{code:'fixed',name:'新名',active:true}]})
  await open();fireEvent.click(screen.getByRole('button',{name:'原名 이름 변경'}))
  fireEvent.change(screen.getByRole('textbox',{name:'原名 이름 변경'}),{target:{value:'新名'}})
  fireEvent.click(screen.getByRole('button',{name:'저장',exact:true}))
  await screen.findByRole('button',{name:'新名 이름 변경'})
  expect(mocks.manage).toHaveBeenCalledWith('rename','fixed','新名','1')
  expect(mocks.legacyRename).not.toHaveBeenCalled()
})
test('failed addition keeps the typed name and does not pretend a new group exists',async()=>{
  mocks.manage.mockRejectedValue(Error('Conflict'))
  await open();fireEvent.change(screen.getByRole('textbox',{name:'새 집단 이름'}),{target:{value:'第五组'}})
  fireEvent.click(screen.getByRole('button',{name:'추가',exact:true}))
  await waitFor(()=>expect(mocks.toast).toHaveBeenCalledWith('Conflict','error'))
  expect(screen.getByRole('textbox',{name:'새 집단 이름'})).toHaveProperty('value','第五组')
  expect(screen.queryByRole('button',{name:'第五组 이름 변경'})).toBeNull()
})
