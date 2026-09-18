import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useParams } from 'react-router-dom'
import { getSharedChineseTerritoryReport } from '../lib/territoryReport'
import type { ChineseTerritoryReportSnapshot } from '../types/territoryReport'
import { TerritoryReportView } from './TerritoryReportView'

type State = 'loading' | 'pin' | 'invalid_pin' | 'locked' | 'unavailable' | 'ready'

export function SharedTerritoryReport() {
  const { shareToken = '' } = useParams()
  const [state, setState] = useState<State>('loading')
  const [pin, setPin] = useState('')
  const [snapshot, setSnapshot] = useState<ChineseTerritoryReportSnapshot | null>(null)
  const [expiresAt, setExpiresAt] = useState('')

  useEffect(() => {
    document.title = '구역 관리 보고서 | Field Map'
    const robots = document.createElement('meta')
    robots.name = 'robots'; robots.content = 'noindex,nofollow,noarchive'
    const referrer = document.createElement('meta')
    referrer.name = 'referrer'; referrer.content = 'no-referrer'
    document.head.append(robots, referrer)
    return () => { robots.remove(); referrer.remove() }
  }, [])

  const load = async (submittedPin?: string) => {
    setState('loading')
    try {
      const result = await getSharedChineseTerritoryReport(shareToken, submittedPin)
      if (result.ok && result.snapshot) {
        setSnapshot(result.snapshot); setExpiresAt(result.expiresAt ?? ''); setState('ready')
      } else {
        setState(result.code === 'pin_required' ? 'pin' : result.code ?? 'unavailable')
      }
    } catch { setState('unavailable') }
  }

  useEffect(() => {
    let active = true
    void getSharedChineseTerritoryReport(shareToken).then(result => {
      if (!active) return
      if (result.ok && result.snapshot) {
        setSnapshot(result.snapshot)
        setExpiresAt(result.expiresAt ?? '')
        setState('ready')
      } else {
        setState(result.code === 'pin_required' ? 'pin' : result.code ?? 'unavailable')
      }
    }).catch(() => { if (active) setState('unavailable') })
    return () => { active = false }
  }, [shareToken])

  const submit = (event: FormEvent) => { event.preventDefault(); void load(pin) }

  if (state === 'loading') return <main className="shared-report-gate">보고서를 불러오고 있습니다.</main>
  if (state === 'pin' || state === 'invalid_pin') return (
    <main className="shared-report-gate">
      <form onSubmit={submit}>
        <div className="shared-report-mark">FM</div>
        <h1>구역 관리 보고서</h1>
        <p>이 보고서는 6자리 암호로 보호되어 있습니다.</p>
        <input autoFocus inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="암호 6자리" aria-label="보고서 암호" />
        {state === 'invalid_pin' && <span className="shared-report-error">암호가 맞지 않습니다.</span>}
        <button type="submit" disabled={pin.length !== 6}>보고서 열기</button>
      </form>
    </main>
  )
  if (state === 'locked') return <main className="shared-report-gate"><div><h1>잠시 후 다시 시도해 주세요.</h1><p>암호 입력 횟수를 초과해 15분 동안 잠겼습니다.</p></div></main>
  if (state === 'unavailable' || !snapshot) return <main className="shared-report-gate"><div><h1>보고서를 열 수 없습니다.</h1><p>공유 기간이 끝났거나 링크가 종료되었습니다.</p></div></main>

  return (
    <main className="shared-report-page">
      <div className="shared-report-topbar no-print"><strong>Field Map</strong><span>{expiresAt && `${new Date(expiresAt).toLocaleDateString('ko-KR')}까지 공개`}</span><button type="button" onClick={() => window.print()}>PDF 인쇄</button></div>
      <TerritoryReportView snapshot={snapshot} shared />
    </main>
  )
}
