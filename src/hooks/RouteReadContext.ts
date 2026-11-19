import { createContext } from 'react'

export const RouteReadContext = createContext<{ ready: boolean; error: boolean; retry: () => void } | null>(null)
