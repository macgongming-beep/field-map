import '@testing-library/jest-dom/vitest'
import { beforeEach, afterEach, expect, test, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { AssignmentEditor } from './AssignmentEditor'
import type { CalendarEvent, InformalAsset, EventInformalAssignment } from '../../types'
import { testCard } from '../../test/territoryFixture'

vi.mock('./TeamBuildScreen', () => ({ TeamBuildScreen: () => null }))
vi.mock('./ZoneAssignScreen', () => ({ ZoneAssignScreen: () => null }))
beforeEach(() => { localStorage.clear(); vi.stubEnv('VITE_DEMO_MODE','true') })
afterEach(() => vi.unstubAllEnvs())

const event = {
  id: 71, date: '2026-09-23', time: '15:00', applicants: ['A'], assigned: [], guests: [],
  assignmentStatus: 'shared', assignmentSharedAt: '2026-09-23T00:00:00Z',
  assignmentTeamInformal: { t1: [9,10] },
  cardAssignments: [{ userName: 'A', teamKey: 't1', assignedCardIds: [1], cardScope: '전체' }],
} as unknown as CalendarEvent
const assets = [
  { id:9, name:'보관된 카드', archived:true, parentId:null },
  { id:10, name:'유효한 카드', archived:false, parentId:null },
] as InformalAsset[]

function mount(e = event, informalAssets = assets, legacy: EventInformalAssignment[] = []) {
  const onShare=vi.fn().mockResolvedValue(undefined)
  render(<AssignmentEditor event={e} cards={[]} allCards={[testCard(1,'카드 1')]} buildings={[]} cardBoundaries={[]}
    currentVisitor="A" canEdit informalAssets={informalAssets} eventInformalAssignments={legacy}
    onClose={vi.fn()} onShare={onShare} />)
  return onShare
}

test('과거 개인 비공식 배정을 숨겨 지우지 않고 공유를 차단한다', () => {
  const onShare=mount({...event,assignmentTeamInformal:null},[],[{ id:1,eventId:71,userName:'A',assetId:9 } as EventInformalAssignment])
  expect(screen.getByRole('alert')).toHaveTextContent('개인 비공식 배정 1건')
  expect(screen.getByRole('button',{name:'배정 공유',exact:true})).toBeDisabled()
  fireEvent.click(screen.getByRole('button',{name:'배정 공유',exact:true}))
  expect(onShare).not.toHaveBeenCalled()
})

test('보관된 선택을 이름과 ID로 표시하고 명시적으로 해제한 뒤 나머지만 공유한다', async () => {
  const onShare=mount()
  expect(screen.getByRole('region',{name:'배정할 수 없는 선택'})).toHaveTextContent('보관된 카드 (ID: 9)')
  expect(screen.getByRole('button',{name:'배정 공유',exact:true})).toBeDisabled()
  fireEvent.click(screen.getByRole('button',{name:'팀 1 · 보관된 카드 선택 해제'}))
  expect(screen.queryByRole('region',{name:'배정할 수 없는 선택'})).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button',{name:'배정 공유',exact:true}))
  await waitFor(() => expect(onShare).toHaveBeenCalledWith(71,[expect.objectContaining({informalAssetIds:[10],cardIds:[1]})],expect.anything()))
})

test('삭제된 비공식 ID도 선택 해제할 수 있다', () => {
  mount(event,assets.filter((a)=>a.id!==9))
  expect(screen.getByRole('region',{name:'배정할 수 없는 선택'})).toHaveTextContent('#9 (ID: 9)')
  fireEvent.click(screen.getByRole('button',{name:'팀 1 · #9 선택 해제'}))
  expect(screen.getByRole('button',{name:'배정 공유',exact:true})).toBeEnabled()
})
