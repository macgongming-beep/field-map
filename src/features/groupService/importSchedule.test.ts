import { expect,test } from 'vitest'
import { previewServiceSchedule } from '../../../scripts/serviceScheduleInput.mjs'
const users=[{id:1,name:'Leader',role:'leader',is_active:true,approval_status:'approved'}]
const header='날짜,구분,집단,인도자,시작,종료,제목\n'
test('daily group rows expand into independent times with one exact primary leader',()=>{
  const result=previewServiceSchedule(header+'2026-11-25,집단,동탄+신갈,Leader,,,Test',users)
  expect(result.errors).toEqual([]);expect(result.rows.map(r=>r.payload.time)).toEqual(['14:30','17:00'])
  expect(result.rows.every(r=>r.payload.primary_leader_user_id===1)).toBe(true)
})
test('unknown aliases, inactive users, incomplete times, duplicate slots and invalid dates fail preview',()=>{
  for(const row of ['2026-11-25,집단,동탄,Alias,,,Test','2026-11-25,회중,,Leader,17:00,,Test','2026-02-30,집단,동탄,Leader,,,Test'])expect(previewServiceSchedule(header+row,users).errors.length).toBeGreaterThan(0)
  expect(previewServiceSchedule(header+'2026-11-25,집단,동탄,Leader,,,Test',users.map(u=>({...u,is_active:false}))).errors.length).toBeGreaterThan(0)
  expect(previewServiceSchedule(header+Array(2).fill('2026-11-25,집단,동탄,Leader,,,Test').join('\n'),users).errors.length).toBeGreaterThan(0)
})
