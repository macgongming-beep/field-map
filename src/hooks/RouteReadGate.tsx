import { useContext, type ReactNode } from 'react'
import { msg } from '../lib/msg'
import { RouteReadContext, TerritoryReadContext } from './RouteReadContext'

// Keep navigation and session providers mounted, without exposing partial route data.
export function RouteReadGate({ children }: { children: ReactNode }) {
  const state = useContext(RouteReadContext)
  if (!state || state.ready) return children
  return <div role={state.error ? 'alert' : 'status'} style={{ padding: 24 }}>
    {state.error ? msg('자료를 불러오지 못했습니다. 연결을 확인하고 다시 시도해 주세요.') : msg('데이터 불러오는 중...')}
    {state.error && <button type="button" onClick={state.retry}>{msg('다시 시도')}</button>}
  </div>
}

// Event detail and assignment editors need territory data even where the month
// view does not. Never render them from a partial snapshot.
export function TerritoryReadGate({ children, onClose }: { children: ReactNode; onClose?: () => void }) {
  const state = useContext(TerritoryReadContext)
  if (!state || state.ready) return children
  return <div className="mobile-sheet-backdrop" role="presentation" onClick={onClose}>
    <div className="mobile-sheet" role={state.error ? 'alert' : 'status'} style={{ padding: 24 }} onClick={event => event.stopPropagation()}>
      {state.error ? msg('자료를 불러오지 못했습니다. 연결을 확인하고 다시 시도해 주세요.') : msg('데이터 불러오는 중...')}
      {state.error && <button type="button" onClick={state.retry}>{msg('다시 시도')}</button>}
    </div>
  </div>
}
