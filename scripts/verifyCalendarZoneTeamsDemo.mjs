import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { parseEnv } from 'node:util'
import { randomBytes } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

const mode = process.argv[2]
assert.ok(['setup', 'initial', 'changed', 'cancelled', 'cleanup'].includes(mode))
assert.ok(process.argv.includes('--confirm-demo'))
const origin = 'https://itjlykpjmlcvanqpmkmc.supabase.co'
const env = parseEnv(readFileSync(process.env.DEMO_ENV_FILE, 'utf8'))
assert.equal(env.VITE_SUPABASE_URL, origin, 'Demo host required')
const unwrap = ({ data, error }) => { assert.equal(error, null, JSON.stringify(error)); return data }
const auth = { persistSession: false, autoRefreshToken: false }
const actor = unwrap(await createClient(origin, env.VITE_SUPABASE_ANON_KEY, { auth }).rpc('auth_login', {
  p_login_id: env.TEST_LOGIN_ID, p_pin: env.TEST_LOGIN_PIN,
}))[0]
assert.ok(actor.token && ['admin', 'developer'].includes(actor.role))
const db = createClient(origin, env.VITE_SUPABASE_ANON_KEY, { auth, global: { headers: { 'x-session-token': actor.token } } })
const file = '/tmp/field-map-calendar-zone-teams.json'
const reportFile = 'scratch/calendar-zone-teams-demo-results.json'
let fixture
const persist = () => writeFileSync(file, JSON.stringify(fixture, null, 2), { mode: 0o600 })
const rows = async (table, columns, eventId) => unwrap(await db.from(table).select(columns).eq('event_id', eventId).order('id'))
async function snapshot() {
  return {
    event: unwrap(await db.from('calendar_events').select('id,title,assignment_status,assignment_shared_at,assignment_team_scopes,assignment_team_informal').eq('id', fixture.eventId).single()),
    participants: await rows('event_participants', 'id,user_name,role', fixture.eventId),
    assignments: await rows('event_card_assignments', 'id,user_name,team_key,assigned_card_id', fixture.eventId),
    cards: await rows('event_card_assignment_cards', 'id,user_name,card_id', fixture.eventId),
    restaurants: await rows('event_restaurant_assignments', 'id,user_name,building_id,unit_id', fixture.eventId),
  }
}
function semanticTeam(s, name) {
  return {
    participants: s.participants.filter(r => r.user_name === name).map(({ id, ...r }) => r),
    assignments: s.assignments.filter(r => r.user_name === name).map(({ id, ...r }) => r),
    cards: s.cards.filter(r => r.user_name === name).map(r => r.card_id).sort((a, b) => a - b),
    restaurants: s.restaurants.filter(r => r.user_name === name).map(({ id, ...r }) => r),
  }
}
async function outsideAssignments() {
  const query = db.from('event_card_assignment_cards').select('id,event_id,user_name,card_id').order('id').limit(1000)
  if (fixture?.eventId) query.neq('event_id', fixture.eventId)
  const result = unwrap(await query)
  assert.ok(result.length < 1000, 'Fixture verifier needs pagination before testing a larger database')
  return result
}
if (mode === 'setup') {
  assert.ok(!existsSync(file), 'Clean the previous fixture first')
  const users = unwrap(await db.from('app_users').select('name,role').in('name', ['데모 관리자', '데모 봉사자']))
  assert.ok(users.some(u => u.name === '데모 관리자' && u.role === 'admin'))
  assert.ok(users.some(u => u.name === '데모 봉사자' && u.role === 'user'))
  assert.equal(unwrap(await db.from('cards').select('id').in('id', [28, 29, 30])).length, 3)
  const restaurant = unwrap(await db.from('units').select('id,building_id,number,is_restaurant').eq('id', 163).single())
  assert.equal(restaurant.building_id, 75); assert.equal(restaurant.is_restaurant, true)
  fixture = { origin, tag: `zone-teams-${randomBytes(5).toString('hex')}`,
    a: '데모 관리자', b: '데모 봉사자', oldCard: 28, newCard: 30, otherCard: 29, restaurant,
    outside: await outsideAssignments(), stages: {} }
  const date = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' })
  const event = unwrap(await db.from('calendar_events').insert({ event_date: date, time: '10:00', end_time: '11:00',
    title: fixture.tag, place: 'Disposable demo team verification', leader_name: fixture.a,
    has_meeting: false, allow_applications: true }).select('id').single())
  fixture.eventId = event.id; persist()
  unwrap(await db.from('event_participants').insert([
    { event_id: event.id, user_name: fixture.a, role: '신청' },
    { event_id: event.id, user_name: fixture.b, role: '신청' },
  ]))
  const assigned = unwrap(await db.rpc('assign_team_service_bulk_tx', { p_token: actor.token, p_event_id: event.id,
    p_assignments: [
      { userName: fixture.a, teamKey: 'team-a', cardIds: [28], cardScope: '전체', informalAssetIds: [] },
      { userName: fixture.b, teamKey: 'team-b', cardIds: [29], cardScope: '전체', informalAssetIds: [] },
    ], p_status: 'shared', p_expected_shared_at: null }))
  assert.equal(assigned.ok, true)
  unwrap(await db.from('event_restaurant_assignments').insert({ event_id: event.id, user_name: fixture.b,
    building_id: 75, unit_id: 163, assigned_by: actor.name }))
  fixture.initial = await snapshot(); persist()
  console.log(JSON.stringify({ eventId: event.id, title: fixture.tag, initial: fixture.initial }))
} else {
  fixture = JSON.parse(readFileSync(file, 'utf8'))
  assert.equal(fixture.origin, origin); assert.match(fixture.tag, /^zone-teams-[a-f0-9]{10}$/)
  const current = await snapshot()
  assert.equal(current.event.title, fixture.tag)
  assert.deepEqual(await outsideAssignments(), fixture.outside, 'Unrelated assignments changed')
  if (mode === 'cleanup') {
    // Assignment deletion preserves sessions. Remove only fixture-linked sessions
    // before deleting the event so they cannot become unlinked active sessions.
    const sessions = unwrap(await db.from('service_sessions').select('id,user_name').eq('calendar_event_id', fixture.eventId))
    assert.ok(sessions.every(s => [fixture.a, fixture.b].includes(s.user_name)))
    if (sessions.length) {
      const ids = sessions.map(s => s.id)
      assert.equal(unwrap(await db.from('visit_histories').select('id').in('service_session_id', ids)).length, 0)
      unwrap(await db.from('service_sessions').delete().eq('calendar_event_id', fixture.eventId))
      assert.equal(unwrap(await db.from('service_sessions').select('id').in('id', ids)).length, 0)
    }
    unwrap(await db.from('calendar_events').delete().eq('id', fixture.eventId).eq('title', fixture.tag))
    assert.equal(unwrap(await db.from('calendar_events').select('id').eq('id', fixture.eventId)).length, 0)
    for (const table of ['event_participants', 'event_card_assignments', 'event_card_assignment_cards', 'event_restaurant_assignments']) {
      assert.equal((await rows(table, 'id', fixture.eventId)).length, 0)
    }
    assert.deepEqual(await outsideAssignments(), fixture.outside)
    writeFileSync(reportFile, JSON.stringify({ origin, eventId: fixture.eventId, stages: fixture.stages,
      cleaned: true, removedFixtureSessions: sessions.length, unrelatedAssignmentsPreserved: true }, null, 2))
    unlinkSync(file)
    console.log(JSON.stringify({ cleaned: true, removedFixtureSessions: sessions.length, unrelatedAssignmentsPreserved: true }))
  } else {
    assert.deepEqual(semanticTeam(current, fixture.b), semanticTeam(fixture.initial, fixture.b), 'Other team data changed')
    const a = semanticTeam(current, fixture.a)
    if (mode === 'cancelled') {
      assert.deepEqual(a, { participants: [], assignments: [], cards: [], restaurants: [] })
      assert.equal(current.participants.length, 1)
      assert.equal(current.event.assignment_team_scopes['team-a'], undefined)
      assert.equal(current.event.assignment_team_informal['team-a'], undefined)
    } else {
      assert.deepEqual(a.cards, [mode === 'initial' ? fixture.oldCard : fixture.newCard])
      assert.deepEqual(a.assignments, [{ user_name: fixture.a, team_key: 'team-a',
        assigned_card_id: mode === 'initial' ? fixture.oldCard : fixture.newCard }])
      assert.equal(a.participants.length, 1); assert.equal(current.participants.length, 2)
    }
    assert.equal(current.event.assignment_team_scopes['team-b'], '전체')
    assert.deepEqual(current.event.assignment_team_informal['team-b'], [])
    fixture.stages[mode] = { at: new Date().toISOString(), ...current, otherTeamPreserved: true, unrelatedAssignmentsPreserved: true }
    persist()
    console.log(JSON.stringify(fixture.stages[mode]))
  }
}
