import { assignmentRevisionEnabled } from './assignmentRevision'

// Versioned saves use the team contract even before the group tabs are enabled.
export function teamServiceEnabled() {
  return assignmentRevisionEnabled() || import.meta.env.VITE_TEAM_SERVICE_ENABLED === 'true'
    || import.meta.env.VITE_DEMO_MODE === 'true'
}
