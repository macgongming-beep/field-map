import { createContext } from 'react'

export const CalendarReadContext = createContext<{
  month: string; full: boolean; ready: boolean; error: boolean
  select: (month: string, full: boolean) => void; retry: () => void
} | null>(null)
