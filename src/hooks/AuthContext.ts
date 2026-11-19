import { createContext, useContext } from 'react'
import type { useAuth } from './useAuth'

export type SharedAuth = ReturnType<typeof useAuth>

// App owns session restoration and directory reads; consumers must not start another owner.
export const AuthContext = createContext<SharedAuth | null>(null)

export function useSharedAuth(): SharedAuth {
  const auth = useContext(AuthContext)
  if (!auth) throw new Error('useSharedAuth requires an AuthContext provider')
  return auth
}
