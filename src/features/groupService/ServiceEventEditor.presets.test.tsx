import {afterEach,beforeEach,expect,test,vi} from 'vitest'
import {cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react'
import {ServiceEventEditor} from './ServiceEventEditor'
import {setCurrentLang} from '../../i18n'
import {TIME_PRESET_SETTING_KEY,TIME_PRESET_STORAGE_KEY} from '../../lib/timePresets'

const presets=[{label:'오후',time:'14:30',durationMinutes:120,title:'봉사'},{label:'저녁',time:'17:00',durationMinutes:120,title:'봉사'}]
const props={language:'ko' as const,date:'2026-11-25',events:[],users:[{id:2,name:'Leader',role:'leader',isActive:true,approvalStatus:'approved' as const}],onClose:vi.fn(),onSubmit:vi.fn(),globalSettings:{[TIME_PRESET_SETTING_KEY]:JSON.stringify(presets)}}
const panel=()=>within(document.querySelector('.gs-preset-settings') as HTMLElement)
beforeEach(()=>{setCurrentLang('ko');localStorage.removeItem(TIME_PRESET_STORAGE_KEY);vi.clearAllMocks()})
afterEach(()=>{cleanup();localStorage.removeItem(TIME_PRESET_STORAGE_KEY)})

test('edits, adds and deletes presets locally, then saves once without changing schedule fields',async()=>{
  const save=vi.fn(async()=>true)
  render(<ServiceEventEditor {...props} onUpsertGlobalSetting={save}/>)
  fireEvent.change(screen.getByLabelText('제목'),{target:{value:'My event'}})
  fireEvent.click(screen.getByRole('button',{name:'시간 설정'}))
  fireEvent.change(panel().getAllByLabelText('레이블')[0],{target:{value:'오후 수정'}})
  fireEvent.change(panel().getAllByLabelText('시작 시간')[0],{target:{value:'15:00'}})
  fireEvent.change(panel().getAllByLabelText('길이 (분)')[0],{target:{value:'90'}})
  fireEvent.click(panel().getByRole('button',{name:'추가',exact:true}))
  expect(panel().getAllByLabelText('레이블')).toHaveLength(3)
  fireEvent.click(panel().getAllByRole('button',{name:'삭제'})[1])
  expect(panel().getAllByLabelText('레이블')).toHaveLength(2)
  expect(save).not.toHaveBeenCalled()
  expect(localStorage.getItem(TIME_PRESET_STORAGE_KEY)).toBeNull()
  expect(screen.queryByRole('button',{name:'저장',exact:true})).toBeNull()
  fireEvent.click(screen.getByRole('button',{name:'시간 설정 저장'}))
  await waitFor(()=>expect(document.querySelector('.gs-preset-settings')).toBeNull())
  expect(save).toHaveBeenCalledOnce()
  const written=JSON.parse(save.mock.calls[0][1])
  expect(save.mock.calls[0][0]).toBe(TIME_PRESET_SETTING_KEY)
  expect(written[0]).toEqual({...presets[0],label:'오후 수정',time:'15:00',durationMinutes:90})
  expect(written.map((p:{label:string})=>p.label)).not.toContain('저녁')
  expect(JSON.parse(localStorage.getItem(TIME_PRESET_STORAGE_KEY)!)).toEqual(written)
  expect(screen.getByRole('option',{name:'오후 수정 · 15:00–16:30'})).toBeTruthy()
  expect(screen.getByLabelText('시작 시간')).toHaveProperty('value','14:30')
  expect(screen.getByLabelText('종료 시간')).toHaveProperty('value','16:30')
  expect(screen.getByLabelText('제목')).toHaveProperty('value','My event')
  expect(props.onSubmit).not.toHaveBeenCalled()
})

test.each(['false','throw'])('failed %s save keeps the draft and cache unchanged, and permits retry',async failure=>{
  const save=vi.fn().mockImplementationOnce(async()=>{if(failure==='throw')throw Error('offline');return false}).mockResolvedValue(true)
  render(<ServiceEventEditor {...props} onUpsertGlobalSetting={save}/>)
  fireEvent.click(screen.getByRole('button',{name:'시간 설정'}))
  fireEvent.change(panel().getAllByLabelText('레이블')[0],{target:{value:'Retry'}})
  fireEvent.click(screen.getByRole('button',{name:'시간 설정 저장'}))
  await screen.findByRole('alert')
  expect(panel().getAllByLabelText('레이블')[0]).toHaveProperty('value','Retry')
  expect(localStorage.getItem(TIME_PRESET_STORAGE_KEY)).toBeNull()
  expect(screen.queryByRole('option',{name:/Retry/})).toBeNull()
  fireEvent.click(screen.getByRole('button',{name:'시간 설정 저장'}))
  await waitFor(()=>expect(document.querySelector('.gs-preset-settings')).toBeNull())
  expect(save).toHaveBeenCalledTimes(2)
})

test('cancel discards draft; one to five presets and invalid times cannot be saved',async()=>{
  const save=vi.fn(async()=>true)
  render(<ServiceEventEditor {...props} onUpsertGlobalSetting={save}/>)
  fireEvent.click(screen.getByRole('button',{name:'시간 설정'}))
  fireEvent.click(panel().getAllByRole('button',{name:'삭제'})[1])
  expect(panel().getByRole('button',{name:'삭제'})).toHaveProperty('disabled',true)
  for(let i=0;i<4;i++)fireEvent.click(panel().getByRole('button',{name:'추가',exact:true}))
  expect(panel().getByRole('button',{name:'추가',exact:true})).toHaveProperty('disabled',true)
  fireEvent.change(panel().getAllByLabelText('시작 시간')[0],{target:{value:''}})
  fireEvent.click(screen.getByRole('button',{name:'시간 설정 저장'}))
  expect(screen.getByRole('alert')).toBeTruthy()
  expect(save).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button',{name:'취소',exact:true}))
  fireEvent.click(screen.getByRole('button',{name:'시간 설정'}))
  expect(panel().getAllByLabelText('레이블')).toHaveLength(2)
  expect(panel().getAllByLabelText('시작 시간')[0]).toHaveProperty('value','14:30')
})

test('pending preset save locks controls and prevents duplicate saves',async()=>{
  let finish!:(value:boolean)=>void
  const save=vi.fn(()=>new Promise<boolean>(r=>{finish=r}))
  render(<ServiceEventEditor {...props} onUpsertGlobalSetting={save}/>)
  fireEvent.click(screen.getByRole('button',{name:'시간 설정'}))
  const button=screen.getByRole('button',{name:'시간 설정 저장'})
  fireEvent.click(button);fireEvent.click(button)
  expect(save).toHaveBeenCalledOnce()
  expect(screen.getByRole('button',{name:'닫기'})).toHaveProperty('disabled',true)
  finish(true)
  await waitFor(()=>expect(document.querySelector('.gs-preset-settings')).toBeNull())
})
