import { useContext, useLayoutEffect, type ReactNode } from 'react'
import { msg } from '../lib/msg'
import { CalendarReadContext } from './CalendarReadContext'

export function CalendarReadGate({ month, full = false, children }: { month: string; full?: boolean; children: ReactNode }) {
  const state = useContext(CalendarReadContext)
  const select = state?.select
  // 0167: publish the month before the browser paints. With a passive effect every month
  // change painted one frame of the loading text even when the month was already loaded.
  // A month that still has to be read keeps showing the loading text below.
  useLayoutEffect(() => { select?.(month, full) }, [select, month, full])
  if (!state) return children
  if (state.month !== month || state.full !== full || !state.ready) {
    return <div role={state.error ? 'alert' : 'status'} style={{ padding: 24 }}>
      {state.error ? msg('자료를 불러오지 못했습니다. 연결을 확인하고 다시 시도해 주세요.') : msg('데이터 불러오는 중...')}
      {state.error && <button type="button" onClick={state.retry}>{msg('다시 시도')}</button>}
    </div>
  }
  return children
}
