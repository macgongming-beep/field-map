import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { RecipientCardDetails } from '../lib/recipientCardPrefetch'
import type { CardSummary } from '../lib/cardSummaries'
import { fetchCardSummaries } from '../lib/cardSummaries'
import { getAuthToken } from '../lib/authToken'
import { toBuilding, toVisitHistory } from './storeTransforms'
import { fetchChangedBuildings } from './territorySync'
import { createTerritoryCheckpoint, TerritoryRealtimeContext } from './territoryRealtimeContext'
import { useTerritoryRealtime } from './useTerritoryRealtime'
import { mergeRecipientSnapshot, type RecipientSnapshot } from './recipientSnapshot'

function Subscribe({ ids }: { ids: number[] }) { useTerritoryRealtime(ids); return null }

/** Isolated demo reader: normal service screens remain responsible for all writes. */
export function RecipientPreviewLive({ details, cardIds, onSummaries, children }: {
  details: RecipientCardDetails
  cardIds: number[]
  onSummaries: (rows: CardSummary[]) => void
  children: (snapshot: RecipientSnapshot) => ReactNode
}) {
  const [snapshot, setSnapshot] = useState<RecipientSnapshot>(() => ({ buildings: details.buildings.map(toBuilding), histories: details.histories.map(toVisitHistory) }))
  const current = useRef(snapshot)
  const summaryCallback = useRef(onSummaries)
  useEffect(() => { summaryCallback.current = onSummaries }, [onSummaries])
  const scopeKey = [...cardIds].sort((a, b) => a - b).join(',')
  const context = useMemo(() => {
    const checkpoint = createTerritoryCheckpoint()
    checkpoint.baseline = details.baseline
    return { checkpoint }
  }, [details])
  const [sync, setSync] = useState<((ids: number[]) => Promise<void>) | null>(null)
  useEffect(() => {
    let active = true
    const token = getAuthToken()
    const allowed = scopeKey.split(',').filter(Boolean).map(Number)
    const check = () => { if (!active || !token || getAuthToken() !== token) throw new Error('Recipient live session changed') }
    const versions = new Map<number, number>()
    const synchronize = async (ids: number[]) => {
      check()
      const requested = new Map(ids.map((id) => { const version = (versions.get(id) ?? 0) + 1; versions.set(id, version); return [id, version] }))
      const changed = await fetchChangedBuildings(ids)
      check()
      const valid = ids.filter((id) => requested.get(id) === versions.get(id))
      if (!valid.length) return
      const affectedCards = [...new Set([...current.current.buildings, ...changed.buildings]
        .filter((b) => valid.includes(b.id) && allowed.includes(b.cardId)).map((b) => b.cardId))]
      const summaries = await fetchCardSummaries(affectedCards)
      check()
      const latest = valid.filter((id) => requested.get(id) === versions.get(id))
      current.current = mergeRecipientSnapshot(current.current, changed, latest, allowed)
      setSnapshot(current.current)
      // Do not commit a summary read that overlapped a newer building refresh.
      if (latest.length === valid.length) summaryCallback.current(summaries)
    }
    setSync(() => synchronize)
    return () => { active = false }
  }, [scopeKey])
  const value = useMemo(() => sync ? { ...context, sync } : null, [context, sync])
  const ids = useMemo(() => scopeKey.split(',').filter(Boolean).map(Number), [scopeKey])
  return <TerritoryRealtimeContext.Provider value={value}>
    <Subscribe ids={ids} />
    {children(snapshot)}
  </TerritoryRealtimeContext.Provider>
}
