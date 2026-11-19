import { useContext, type ReactNode } from 'react'
import { msg } from '../lib/msg'
import { RouteReadContext } from './RouteReadContext'

// Keep navigation and session providers mounted, without exposing partial route data.
export function RouteReadGate({ children }: { children: ReactNode }) {
  const state = useContext(RouteReadContext)
  if (!state || state.ready) return children
  return <div role={state.error ? 'alert' : 'status'} style={{ padding: 24 }}>
    {state.error ? msg('자료를 불러오지 못했습니다. 연결을 확인하고 다시 시도해 주세요.') : msg('데이터 불러오는 중...')}
    {state.error && <button type="button" onClick={state.retry}>{msg('다시 시도')}</button>}
  </div>
}
