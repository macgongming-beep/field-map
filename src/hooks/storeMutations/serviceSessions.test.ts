import { afterEach, expect, test, vi } from 'vitest'
import { makeServiceSessionMutations } from './serviceSessions'
import type { ServiceSession } from '../../types'

const state = vi.hoisted(() => ({
  metadata: { id: 42, calendar_event_id: 7, primary_card_id: 9, time_slot: '오전' },
  error: null as Error | null, reads: vi.fn(), writes: vi.fn(), log: vi.fn(), report: vi.fn(),
  updateError: null as Error | null, updated: [{id:42}] as {id:number}[], tables: vi.fn(), readIds: vi.fn(), writeIds: vi.fn(), writeSelect: vi.fn(), toast: vi.fn(),
}))
vi.mock('./serviceLog', () => ({ logServiceAction: state.log }))
vi.mock('./shared', () => ({
  showToast: state.toast, reportMutationError: state.report,
  ensureAffectedRows: (rows: unknown[],message: string) => {if(rows?.length)return true;state.report(message,{code:'P0001'});return false},
  getLocalDateString: () => '2026-10-26', getCurrentVisitor: () => 'Me',
  supabase: { from: (table: string) => {
    state.tables(table)
    const q = {
      select: (columns: string) => { state.reads(columns); return q },
      eq: (column: string, value: unknown) => { state.readIds(column, value); return q },
      limit: () => q, is: () => q,
      then: (resolve: (result:unknown)=>unknown) => Promise.resolve({data:[],error:null}).then(resolve),
      single: async () => ({ data: state.metadata, error: state.error }),
      update: (payload: unknown) => { state.writes(payload); return { eq: (column: string, value: unknown) => {
        state.writeIds(column, value); return {select:async(columns:string)=>{state.writeSelect(columns);return {data:state.updated,error:state.updateError}}}
      }, in: () => ({select:async()=>({data:state.updated,error:state.updateError})}) } },
    }
    return q
  } },
}))
afterEach(() => { state.error = null; state.updateError = null; state.updated=[{id:42}];state.metadata.id = 42; vi.clearAllMocks() })

test('ending an older session outside the read window retains its event/card log metadata', async () => {
  const refresh = vi.fn()
  const mutations = makeServiceSessionMutations({ fetchAll: refresh, serviceSessions: [], buildings: [], narrowSessionRead: true })
  await mutations.endServiceSession(42)
  expect(state.reads).toHaveBeenCalledWith('id, calendar_event_id, primary_card_id, time_slot')
  expect(state.writes).toHaveBeenCalledTimes(1)
  expect(state.tables.mock.calls).toEqual([['service_sessions'], ['service_sessions']])
  expect(state.readIds.mock.calls).toEqual([['id', 42]])
  expect(state.writeIds.mock.calls).toEqual([['id', 42]])
  expect(state.log).toHaveBeenCalledWith({ sessionId: 42, eventId: 7, cardId: 9, action: 'session_ended', details: { time_slot: '오전' } })
  expect(refresh).toHaveBeenCalledTimes(1)
})

test.each(['error', 'wrong id'])('missing metadata %s does not end a session with misleading log details', async failure => {
  if (failure === 'error') state.error = new Error('offline')
  else state.metadata.id = 99
  const mutations = makeServiceSessionMutations({ fetchAll: vi.fn(), serviceSessions: [], buildings: [], narrowSessionRead: true })
  await mutations.endServiceSession(42)
  expect(state.writes).not.toHaveBeenCalled()
  expect(state.log).not.toHaveBeenCalled()
  expect(state.report).toHaveBeenCalledTimes(1)
})

test('disabled feature keeps the old missing-session behavior without another read', async () => {
  const mutations = makeServiceSessionMutations({ fetchAll: vi.fn(), serviceSessions: [], buildings: [] })
  await mutations.endServiceSession(42)
  expect(state.reads).not.toHaveBeenCalled()
  expect(state.writes).toHaveBeenCalledTimes(1)
})

test('cached metadata avoids another read and a failed update does not log or refresh', async () => {
  state.updateError = new Error('offline')
  const refresh = vi.fn()
  const session = { id: 42, calendarEventId: 7, primaryCardId: 9, timeSlot: '오전' } as ServiceSession
  await makeServiceSessionMutations({ fetchAll: refresh, serviceSessions: [session], buildings: [], narrowSessionRead: true }).endServiceSession(42)
  expect(state.reads).not.toHaveBeenCalled()
  expect(state.writeIds.mock.calls).toEqual([['id', 42]])
  expect(state.log).not.toHaveBeenCalled()
  expect(refresh).not.toHaveBeenCalled()
  expect(state.report).toHaveBeenCalledTimes(1)
})

test('RLS-filtered zero rows never report or log a completed session',async()=>{
  state.updated=[]
  const refresh=vi.fn()
  await makeServiceSessionMutations({fetchAll:refresh,serviceSessions:[],buildings:[]}).endServiceSession(42)
  expect(state.writeSelect).toHaveBeenCalledExactlyOnceWith('id')
  expect(state.report).toHaveBeenCalledOnce()
  expect(state.log).not.toHaveBeenCalled();expect(refresh).not.toHaveBeenCalled();expect(state.toast).not.toHaveBeenCalled()
})

test.each([{updated:[]},{updated:[{id:42}]}])('starting a session stops if previous sessions are only partly ended: %j',async ({updated})=>{
  state.updated=updated
  const sessions=[42,43].map(id=>({id,userName:'Me',serviceDate:'2026-10-26',status:'active',endedAt:null})) as ServiceSession[]
  const refresh=vi.fn()
  const result=await makeServiceSessionMutations({fetchAll:refresh,serviceSessions:sessions,buildings:[]}).startServiceSession({role:'user',timeSlot:'오후'})
  expect(result).toBeNull();expect(state.report).toHaveBeenCalledOnce();expect(state.log).not.toHaveBeenCalled();expect(refresh).not.toHaveBeenCalled()
})
