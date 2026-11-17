import '@testing-library/jest-dom/vitest'
import {afterEach,beforeEach,expect,test,vi} from 'vitest'
import {fireEvent,render,screen,waitFor} from '@testing-library/react'
import type {ComponentProps} from 'react'
import type {CalendarEvent} from '../../types'
import type {TeamBuildScreen} from './TeamBuildScreen'
import type {ZoneAssignScreen} from './ZoneAssignScreen'
import {AssignmentEditor} from './AssignmentEditor'
import {testCard} from '../../test/territoryFixture'
const mocks=vi.hoisted(()=>({read:vi.fn()}))
vi.mock('../../hooks/calendarEventRefresh',()=>({fetchUpdatedCalendarEvent:mocks.read}))
vi.mock('./TeamBuildScreen',()=>({TeamBuildScreen:(p:ComponentProps<typeof TeamBuildScreen>)=><button onClick={()=>p.onOpenTeamZones(p.teams[0].id)}>zones</button>}))
vi.mock('./ZoneAssignScreen',()=>({ZoneAssignScreen:(p:ComponentProps<typeof ZoneAssignScreen>)=><>
  <button onClick={async()=>{for(const userName of ['A','B'])await p.onAssignRestaurantToUser?.({eventId:71,userName,buildingId:2,assignedBy:'A'})}}>add two</button>
  <button onClick={p.onBack}>teams</button>
</>}))
beforeEach(()=>{
  localStorage.clear();vi.stubEnv('VITE_DEMO_MODE','true');vi.stubEnv('VITE_GROUP_SERVICE_ENABLED','true')
  vi.stubEnv('VITE_SUPABASE_URL','https://itjlykpjmlcvanqpmkmc.supabase.co')
})
afterEach(()=>vi.unstubAllEnvs())
test.each([true,false])('personal writes advance only successful versions before sharing (success=%s)',async success=>{
  const event={id:71,date:'2026-11-18',time:'14:30',applicants:['A','B'],assigned:[],guests:[],assignmentRevision:'4',assignmentStatus:'shared',assignmentSharedAt:null,assignmentTeamInformal:{},cardAssignments:[{userName:'A',teamKey:'pair',assignedCardIds:[1],cardScope:'전체'},{userName:'B',teamKey:'pair',assignedCardIds:[1],cardScope:'전체'}]} as unknown as CalendarEvent
  mocks.read.mockResolvedValue(event)
  const personal=vi.fn().mockResolvedValue(success),share=vi.fn()
  render(<AssignmentEditor event={event} cards={[testCard(1,'card')]} allCards={[testCard(1,'card')]} buildings={[]} cardBoundaries={[]} currentVisitor="A" canEdit onClose={vi.fn()} onShare={share} onAssignRestaurantToUser={personal}/> )
  fireEvent.click(await screen.findByRole('button',{name:'zones'}))
  fireEvent.click(screen.getByRole('button',{name:'add two'}))
  await waitFor(()=>expect(personal).toHaveBeenCalledTimes(2))
  expect(personal.mock.calls.map(c=>c[0].expectedRevision)).toEqual(success?['4','5']:['4','4'])
  fireEvent.click(screen.getByRole('button',{name:'teams'}))
  fireEvent.click(screen.getByRole('button',{name:'배정 공유',exact:true}))
  await waitFor(()=>expect(share).toHaveBeenCalledWith(71,expect.any(Array),expect.objectContaining({expectedRevision:success?'6':'4'})))
})
