import { useContext, useEffect, type ReactNode } from 'react'
import { FullBuildingContext } from '../hooks/buildingDemand'
import { msg } from '../lib/msg'

export function FullBuildingGate({ children }: { children: ReactNode }) {
  const reader = useContext(FullBuildingContext)
  const request = reader?.request
  useEffect(() => { request?.() }, [request])
  if (!reader || reader.ready) return children
  return reader.error
    ? <div role="alert">{msg('자료를 불러오지 못했습니다.')}<button type="button" onClick={() => { void reader.retry().catch(() => {}) }}>{msg('다시 시도')}</button></div>
    : <div role="status">{msg('불러오는 중...')}</div>
}
