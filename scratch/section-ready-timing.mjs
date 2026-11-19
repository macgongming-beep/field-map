export function advanceReadyTiming(state, ready, now, stableWindowMs = 200) {
  const elapsed = now - state.started
  if (ready) {
    state.firstReady ??= elapsed
    state.readySince ??= elapsed
    if (elapsed - state.readySince >= stableWindowMs) state.ready = state.readySince
  } else {
    if (state.wasReady) state.readinessLosses++
    state.readySince = null
    state.ready = null
  }
  state.wasReady = ready
}
