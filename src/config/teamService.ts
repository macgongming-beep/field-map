// Enable team assignments independently from demo-only login/reset tools.
export function teamServiceEnabled() {
  return import.meta.env.VITE_TEAM_SERVICE_ENABLED === 'true'
    || import.meta.env.VITE_DEMO_MODE === 'true'
}
