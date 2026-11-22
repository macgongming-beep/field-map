import { createContext } from 'react'

export const RouteReadContext = createContext<{ ready: boolean; error: boolean; retry: () => void } | null>(null)

// Territory data (cards, building names, histories) for consumers inside a route that
// may render before it. Only the mobile calendar month view does so today.
export const TerritoryReadContext = createContext<{ ready: boolean; error: boolean; retry: () => void } | null>(null)

/** Routes whose screen renders before territory data; their detail consumers use TerritoryReadGate. */
export function routeSkipsTerritory(isDesktop: boolean, pathname: string) {
  return !isDesktop && pathname === '/calendar'
}
