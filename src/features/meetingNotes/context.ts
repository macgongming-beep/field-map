import { createContext, useContext } from 'react'
import type { MeetingCollection, MeetingNoteMeta } from './model'

export type MeetingHomeData = { collections: MeetingCollection[]; notes: MeetingNoteMeta[] }
export const MeetingContext = createContext<{
  userId: number; canManage: boolean; data: MeetingHomeData; refresh: () => void
} | null>(null)
export const useMeetingHome = () => useContext(MeetingContext)
