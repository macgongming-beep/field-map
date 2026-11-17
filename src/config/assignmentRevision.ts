// Install the compatibility DB stage before opting in. Never fall back from a
// failed versioned write to an older, unguarded write.
export function assignmentRevisionEnabled() {
  const configured = import.meta.env.VITE_ASSIGNMENT_REVISION_ENABLED
  if (configured != null) return configured === 'true'
  return import.meta.env.VITE_DEMO_MODE === 'true'
    && import.meta.env.VITE_SUPABASE_URL === 'https://itjlykpjmlcvanqpmkmc.supabase.co'
}
