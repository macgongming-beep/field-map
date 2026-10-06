import { clearUserChatsCache } from './userChatsCache'
import { clearBoundaryDeviceCache } from './boundaryDeviceCache'

const AUTH_SESSION_KEY = 'auth_session'
const AUTH_TOKEN_KEY = 'auth_token'

export type StoredAuthSession = {
  raw: string
  persistent: boolean
}

export function getStoredAuthSession(): StoredAuthSession | null {
  const persistentSession = localStorage.getItem(AUTH_SESSION_KEY)
  if (persistentSession) {
    return { raw: persistentSession, persistent: true }
  }

  const browserSession = sessionStorage.getItem(AUTH_SESSION_KEY)
  if (browserSession) {
    return { raw: browserSession, persistent: false }
  }

  return null
}

export function getAuthToken(): string | null {
  return localStorage.getItem(AUTH_TOKEN_KEY) ?? sessionStorage.getItem(AUTH_TOKEN_KEY)
}

export function isPersistentAuthSession(): boolean {
  if (localStorage.getItem(AUTH_SESSION_KEY)) return true
  if (sessionStorage.getItem(AUTH_SESSION_KEY)) return false
  return true
}

export function setAuthSession(value: unknown, persistent: boolean) {
  const serialized = JSON.stringify(value)
  if (persistent) {
    localStorage.setItem(AUTH_SESSION_KEY, serialized)
    sessionStorage.removeItem(AUTH_SESSION_KEY)
  } else {
    sessionStorage.setItem(AUTH_SESSION_KEY, serialized)
    localStorage.removeItem(AUTH_SESSION_KEY)
  }
}

export function setAuthToken(token: string, persistent: boolean) {
  if (persistent) {
    localStorage.setItem(AUTH_TOKEN_KEY, token)
    sessionStorage.removeItem(AUTH_TOKEN_KEY)
  } else {
    sessionStorage.setItem(AUTH_TOKEN_KEY, token)
    localStorage.removeItem(AUTH_TOKEN_KEY)
  }
}

export function clearAuthStorage() {
  void clearBoundaryDeviceCache()
  clearUserChatsCache()
  localStorage.removeItem(AUTH_SESSION_KEY)
  localStorage.removeItem(AUTH_TOKEN_KEY)
  sessionStorage.removeItem(AUTH_SESSION_KEY)
  sessionStorage.removeItem(AUTH_TOKEN_KEY)
}
