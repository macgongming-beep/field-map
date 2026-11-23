import { useContext, useEffect, type ReactNode } from 'react'
import { FullBuildingContext } from '../hooks/buildingDemand'
import { msg } from '../lib/msg'

/**
 * Tools that edit or match against territory data (regular/return visits, restaurant
 * service) need the complete building snapshot. A lighter route snapshot asks for it
 * here when the tool opens, and never renders the tool from partial buildings.
 * `sheet` shows the wait/failure as a bottom sheet the tool would have opened.
 * `tier="map"` is for tools whose consumed fields all come with the map snapshot.
 */
export function FullBuildingGate({ children, sheet = false, onClose, tier = 'full' }: { children: ReactNode; sheet?: boolean; onClose?: () => void; tier?: 'map' | 'full' }) {
  const reader = useContext(FullBuildingContext)
  // 0171: a tool that only lists places (no memos) accepts an existing map snapshot.
  const request = tier === 'map' ? reader?.requestMap : reader?.request
  useEffect(() => { request?.() }, [request])
  if (!reader || (tier === 'map' ? reader.mapReady : reader.ready)) return children
  const body = reader.error
    ? <>{msg('자료를 불러오지 못했습니다.')}<button type="button" onClick={() => { void reader.retry().catch(() => {}) }}>{msg('다시 시도')}</button></>
    : msg('불러오는 중...')
  if (!sheet) return <div role={reader.error ? 'alert' : 'status'}>{body}</div>
  return <div className="mobile-sheet-backdrop" role="presentation" onClick={onClose}>
    <div className="mobile-sheet" role={reader.error ? 'alert' : 'status'} style={{ padding: 24 }} onClick={event => event.stopPropagation()}>{body}</div>
  </div>
}
