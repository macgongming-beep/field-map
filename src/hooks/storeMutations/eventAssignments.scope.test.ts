import { expect, test, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }))
vi.mock('./shared', () => ({ supabase: mocks, showToast: vi.fn(), reportMutationError: vi.fn(), getCurrentVisitor: () => 'A', ensureAffectedRows: vi.fn() }))
vi.mock('../../lib/authToken', () => ({ getAuthToken: () => 'test-token' }))
import { makeEventAssignmentMutations } from './eventAssignments'

test('범위 저장 RPC가 없으면 옛 직접 저장으로 폴백하지 않고 초안을 유지하도록 거부한다', async () => {
  mocks.from.mockClear()
  mocks.rpc.mockResolvedValue({ error: { message: 'Could not find the function' } })
  const fetchAll = vi.fn()
  await expect(makeEventAssignmentMutations({ fetchAll }).assignCardsToEventParticipantsBulk(1,
    [{ userName: 'A', cardIds: [3], teamKey: 'team', cardScope: '상가' }],
  )).rejects.toMatchObject({ message: 'Could not find the function' })
  expect(mocks.rpc).toHaveBeenCalledWith('assign_scoped_cards_bulk_tx', expect.objectContaining({
    p_assignments: [{ userName: 'A', cardIds: [3], teamKey: 'team', cardScope: '상가' }],
  }))
  expect(mocks.from).not.toHaveBeenCalled()
  expect(fetchAll).not.toHaveBeenCalled()
})

test('데모는 비공식 팀 목록을 새 RPC로 보내며 비어 있는 전체 배정도 새 RPC로 해제한다', async () => {
  vi.stubEnv('VITE_DEMO_MODE','true')
  try {
    mocks.rpc.mockResolvedValue({data:{ok:true},error:null})
    const mutation = makeEventAssignmentMutations({fetchAll:vi.fn()})
    await mutation.assignCardsToEventParticipantsBulk(1,[{userName:'A',teamKey:'t1',cardIds:[],informalAssetIds:[9]}])
    expect(mocks.rpc).toHaveBeenLastCalledWith('assign_team_service_bulk_tx',expect.objectContaining({p_assignments:[{userName:'A',teamKey:'t1',cardIds:[],cardScope:'전체',informalAssetIds:[9]}]}))
    await mutation.assignCardsToEventParticipantsBulk(1,[])
    expect(mocks.rpc).toHaveBeenLastCalledWith('assign_team_service_bulk_tx',expect.objectContaining({p_assignments:[]}))
  } finally {vi.unstubAllEnvs()}
})
