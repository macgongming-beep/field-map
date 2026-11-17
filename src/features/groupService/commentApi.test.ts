import {beforeEach,expect,test,vi} from 'vitest'
const mocks=vi.hoisted(()=>({from:vi.fn(),rpc:vi.fn(),token:vi.fn(),result:{data:[] as unknown,error:null as unknown}}))
vi.mock('../../lib/supabase',()=>({supabase:{from:mocks.from,rpc:mocks.rpc}}))
vi.mock('../../lib/authToken',()=>({getAuthToken:mocks.token}))
import {isCommentSessionError,readCommentPage,readCommentRows,writeEventComment} from './commentApi'
let query:Record<string,ReturnType<typeof vi.fn>>
beforeEach(()=>{
  vi.clearAllMocks();mocks.token.mockReturnValue('session');mocks.result={data:[],error:null}
  query=Object.fromEntries(['select','eq','is','order','limit','lt','in','abortSignal','insert','update','single'].map(name=>[name,vi.fn(()=>query)]))
  query.then=vi.fn(resolve=>Promise.resolve(mocks.result).then(resolve));mocks.from.mockReturnValue(query);mocks.rpc.mockReturnValue(query)
})
test('pages are exact-event projections with a 20 row ID cursor, never total count or wildcard',async()=>{
  await readCommentPage(5,123)
  expect(mocks.rpc).toHaveBeenCalledWith('read_group_event_comments',{p_event_id:5,p_before_id:123,p_ids:null})
  expect(mocks.from).not.toHaveBeenCalled()
})
test('empty batches make no request; oversized batches and missing sessions fail closed',async()=>{
  expect(await readCommentRows(1,[])).toEqual([]);expect(mocks.from).not.toHaveBeenCalled()
  await expect(readCommentRows(1,Array(21).fill(1))).rejects.toThrow('batch')
  mocks.token.mockReturnValue(null)
  await expect(readCommentPage(1)).rejects.toMatchObject({code:'42501',message:'COMMENT_SESSION_REQUIRED'})
  await expect(writeEventComment(1,{content:'a'})).rejects.toThrow('session')
  expect(mocks.from).not.toHaveBeenCalled()
})
test('changed rows are bounded and replies after account changes are discarded',async()=>{
  mocks.token.mockReturnValueOnce('old').mockReturnValue('new')
  await expect(readCommentRows(7,[1,2])).rejects.toMatchObject({code:'42501',message:'COMMENT_SESSION_REQUIRED'})
  expect(mocks.rpc).toHaveBeenCalledWith('read_group_event_comments',{p_event_id:7,p_before_id:null,p_ids:[1,2]})
})
test('permission/schema/network errors are not mistaken for session expiration or empty comments',async()=>{
  for(const error of [{code:'42501',message:'COMMENT_SESSION_REQUIRED'},{code:'42501',message:'permission denied'}, {code:'PGRST202',message:'not installed'}]){
    mocks.result.error=error
    await expect(readCommentPage(1)).rejects.toEqual(error)
    expect(isCommentSessionError(error)).toBe(error.message==='COMMENT_SESSION_REQUIRED')
  }
})
test('editing scopes both ID and parent; zero affected rows are not success',async()=>{
  mocks.result.data=null as unknown as unknown[]
  await expect(writeEventComment(7,{id:3,content:'changed'})).rejects.toThrow('no rows')
  expect(query.eq.mock.calls).toEqual([['id',3],['target_type','calendar_event'],['target_id',7]])
  expect(query.single).toHaveBeenCalledOnce()
})
