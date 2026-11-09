import { expect, test } from 'vitest'
import { createParticipantSignalReceipts, participantSignalDedupEnabled, type ParticipantSignal } from './participantSignalReceipts'

const stamp = { epoch: 1, version: 2, scope: 'full', user: 'A' }
const row = { id: 10, user_name: 'A', role: '신청' }
const insert: ParticipantSignal = { eventType: 'INSERT', new: { ...row, event_id: 1 } }
const deleted: ParticipantSignal = { eventType: 'DELETE', old: { id: 10 } }
test('only applied own INSERT and proven missing DELETE rows are covered', () => {
  const receipts = createParticipantSignalReceipts()
  expect(receipts.covers(insert, stamp, [1], 100)).toBe(false)
  receipts.applied(1, [row], stamp, 'INSERT', 100)
  expect(receipts.covers(insert, stamp, [1], 101)).toBe(true)
  expect(receipts.covers(deleted, stamp, [1], 101)).toBe(false)
  receipts.applied(1, [], stamp, 'DELETE', 102)
  expect(receipts.covers(deleted, stamp, [1], 103)).toBe(true)
  expect(receipts.covers(insert, stamp, [1], 103)).toBe(false)
  receipts.reset()
  receipts.applied(1, [], stamp, 'DELETE', 104)
  expect(receipts.covers(deleted, stamp, [1], 105)).toBe(false)
})
test.each([
  { ...insert, new: { ...insert.new, id: 11 } },
  { ...insert, new: { ...insert.new, user_name: 'B' } },
  { ...insert, new: { ...insert.new, event_id: 2 } },
  { ...insert, new: { ...insert.new, role: '입명' } },
  { ...insert, new: { id: 10 } },
  { ...insert, eventType: 'UPDATE' },
  { eventType: 'DELETE', old: { id: 11 } },
])('foreign, replaced, assigned or incomplete signal is never skipped: %j', signal => {
  const receipts = createParticipantSignalReceipts()
  receipts.applied(1, [row], stamp, 'INSERT', 100)
  expect(receipts.covers(signal, stamp, [1], 101)).toBe(false)
})
test('invalidations, identity, route, expiry, clock reversal and reset invalidate evidence', () => {
  const receipts = createParticipantSignalReceipts()
  receipts.applied(1, [row], stamp, 'INSERT', 100)
  for (const changed of [{ epoch: 2 }, { version: 3 }, { scope: 'other' }, { user: 'B' }]) {
    expect(receipts.covers(insert, { ...stamp, ...changed }, [1], 101)).toBe(false)
  }
  expect(receipts.covers(insert, stamp, [], 101)).toBe(false)
  expect(receipts.covers(insert, stamp, [1], 99)).toBe(false)
  expect(receipts.covers(insert, stamp, [1], 120100)).toBe(false)
  receipts.reset()
  expect(receipts.covers(insert, stamp, [1], 101)).toBe(false)
})
test('other-device reads cannot mint receipts; present or foreign rows cannot prove deletion', () => {
  const receipts = createParticipantSignalReceipts()
  receipts.applied(1, [row], stamp, undefined, 100)
  expect(receipts.covers(insert, stamp, [1], 101)).toBe(false)
  receipts.applied(1, [row], stamp, 'DELETE', 102)
  expect(receipts.covers(deleted, stamp, [1], 103)).toBe(false)
  receipts.applied(1, [], { ...stamp, user: 'B' }, 'DELETE', 104)
  expect(receipts.covers(deleted, { ...stamp, user: 'B' }, [1], 105)).toBe(false)
})
test.each([
  [undefined, undefined, true, true, false], ['true', 'false', true, true, true],
  [undefined, 'true', true, true, true], ['false', 'true', true, true, false],
  ['true', 'true', false, true, false], ['true', 'true', true, false, false],
] as const)('flag %s demo %s application %s navigation %s => %s', (flag, demo, application, navigation, expected) => {
  expect(participantSignalDedupEnabled(flag, demo, application, navigation)).toBe(expected)
})
