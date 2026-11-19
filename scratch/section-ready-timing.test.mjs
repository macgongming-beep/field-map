import assert from 'node:assert/strict'
import { test } from 'node:test'
import { advanceReadyTiming } from './section-ready-timing.mjs'

const fresh = () => ({ started: 0, ready: null, firstReady: null, readySince: null, wasReady: false, readinessLosses: 0 })
test('a content flash followed by loading does not freeze readiness at the flash', () => {
  const state = fresh()
  advanceReadyTiming(state, true, 13)
  advanceReadyTiming(state, false, 30)
  advanceReadyTiming(state, false, 550)
  assert.equal(state.ready, null)
  advanceReadyTiming(state, true, 630)
  advanceReadyTiming(state, true, 829)
  assert.equal(state.ready, null)
  advanceReadyTiming(state, true, 830)
  assert.equal(state.ready, 630)
  assert.equal(state.firstReady, 13)
  assert.equal(state.readinessLosses, 1)
})
test('a previously stable screen loses readiness if loading returns later', () => {
  const state = fresh()
  advanceReadyTiming(state, true, 20)
  advanceReadyTiming(state, true, 220)
  assert.equal(state.ready, 20)
  advanceReadyTiming(state, false, 500)
  assert.equal(state.ready, null)
  advanceReadyTiming(state, true, 700)
  advanceReadyTiming(state, true, 900)
  assert.equal(state.ready, 700)
  assert.equal(state.readinessLosses, 1)
})
