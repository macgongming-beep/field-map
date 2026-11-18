import {expect,test} from 'vitest'
import {parseGroupDirectory,directorySettings,mergeDirectorySettings} from './directory'
import {eventBlocks,groupLabel,serviceGroupOptions} from './model'
import type {CalendarEvent} from '../../types'
const directory={revision:'3',groups:[{code:'fixed-a',name:'改名后的组',active:true},{code:'fixed-b',name:'第五组',active:true},{code:'retired',name:'旧组',active:false}]}
test('authoritative directory supports arbitrary labels and IDs without inferring from position',()=>{
  const settings=directorySettings(directory)
  expect(serviceGroupOptions(settings,'ko')).toEqual(directory.groups)
  expect(groupLabel(['fixed-b','fixed-a'],'en',settings.user_groups,settings.service_group_directory)).toBe('第五组 · 改名后的组')
  const events=[{id:1,date:'2026-11-25',time:'14:30',serviceKind:'group',targetGroups:['fixed-a']},{id:2,date:'2026-11-25',time:'14:30',serviceKind:'group',targetGroups:['fixed-b']}] as CalendarEvent[]
  expect(eventBlocks(events,'第五组',settings.service_group_directory)[0][0].id).toBe(2)
  expect(serviceGroupOptions({service_group_directory:'bad'},'ko')).toEqual([])
  expect(parseGroupDirectory(JSON.stringify({...directory,groups:[directory.groups[0],directory.groups[0]]}))).toBeNull()
})
test('late settings read cannot restore an earlier name or resurrect an archived group',()=>{
  const current=directorySettings(directory)
  const stale=directorySettings({...directory,revision:'2',groups:[{code:'fixed-a',name:'Old name',active:true}]})
  expect(mergeDirectorySettings(current,{...stale,another_setting:'kept'})).toEqual({...current,another_setting:'kept'})
  expect(mergeDirectorySettings(current,{})).toEqual(current)
  const updated=directorySettings({...directory,revision:'4',groups:[]})
  expect(mergeDirectorySettings(current,updated)).toEqual(updated)
})
