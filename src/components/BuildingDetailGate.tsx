import { useContext, useEffect, useState, type ReactNode } from 'react'
import { BuildingDetailContext, type BuildingDetailReader } from '../hooks/buildingDemand'
import { msg } from '../lib/msg'

export function BuildingDetailGate({ buildingId, children }: { buildingId: number; children: ReactNode }) {
  const reader = useContext(BuildingDetailContext)
  const ready = !reader || reader.ready(buildingId)
  const [failure, setFailure] = useState<{ id: number; reader: BuildingDetailReader; attempt: number } | null>(null)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (ready || !reader) return
    let active = true
    void reader.ensure(buildingId).catch(() => { if (active) setFailure({ id: buildingId, reader, attempt }) })
    return () => { active = false }
  }, [reader, buildingId, ready, attempt])
  if (ready) return children
  return failure?.id === buildingId && failure.reader === reader && failure.attempt === attempt
    ? <div role="alert">{msg('자료를 불러오지 못했습니다.')}<button type="button" onClick={() => setAttempt(value => value + 1)}>{msg('다시 시도')}</button></div>
    : <div role="status">{msg('불러오는 중...')}</div>
}
