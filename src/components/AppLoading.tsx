import { useEffect, useState } from 'react'
import { msg } from '../lib/msg'
import { applyUpdate } from '../lib/pwa'

export function AppLoading({ kind = 'data', failed = false }: {
  kind?: 'data' | 'screen' | 'login'
  failed?: boolean
}) {
  const [slow, setSlow] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const [retryFailed, setRetryFailed] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), 12_000)
    return () => clearTimeout(timer)
  }, [])

  async function retry() {
    setRetrying(true)
    setRetryFailed(false)
    try { await applyUpdate() }
    catch { setRetryFailed(true) }
    finally { setRetrying(false) }
  }

  return (
    <div className="app-loading" role="status">
      <div className="app-loading-main">
        <div className="app-loading-brand">
          <svg className="app-loading-mark" aria-hidden="true" focusable="false" viewBox="0 0 1024 1024">
            <rect width="1024" height="1024" rx="230" fill="#111827"/>
            <g fill="none" stroke="#fff" strokeLinecap="round" strokeLinejoin="round">
              <path d="M246 314l176-74 180 74 176-74v420l-176 74-180-74-176 74V314z" strokeWidth="54"/>
              <path d="M422 240v420M602 314v420" strokeWidth="42" opacity=".72"/>
              <path d="M512 350c-79 0-143 62-143 139 0 106 143 239 143 239s143-133 143-239c0-77-64-139-143-139z" fill="#111827" strokeWidth="46"/>
              <circle cx="512" cy="488" r="48" fill="#fff" stroke="none"/>
            </g>
          </svg>
          <strong>Field Map</strong>
        </div>
        <div className="app-loading-status">
          {!failed && <span className="app-loading-spinner" aria-hidden="true" />}
          <p>{failed ? msg('자료를 불러오지 못했습니다. 연결을 확인하고 다시 시도해 주세요.')
            : kind === 'data' ? msg('데이터 불러오는 중...')
              : kind === 'login' ? msg('로그인 화면 불러오는 중...') : msg('화면 구성 불러오는 중...')}</p>
        </div>
        {(slow || failed) && (
          <div className="app-loading-recovery">
            {!failed && <p>{msg('평소보다 오래 걸리고 있습니다. 연결 상태를 확인해 주세요.')}</p>}
            <button className="ds-btn ds-btn-primary" type="button" disabled={retrying} onClick={() => void retry()}>
              {retrying ? msg('다시 불러오는 중...') : msg('앱 다시 불러오기')}
            </button>
            {retryFailed && <p role="alert">{msg('업데이트를 적용하지 못했습니다. 잠시 후 다시 눌러 주세요.')}</p>}
          </div>
        )}
      </div>
    </div>
  )
}
