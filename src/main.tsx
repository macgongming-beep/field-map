import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { BrowserRouter } from 'react-router-dom'
import App from './App.tsx'
import { Analytics } from '@vercel/analytics/react'
import { preloadNaverMapSDK } from './lib/preloadMap'
import { initSentry } from './lib/sentry'
import './lib/pwa' // Service Worker 등록 (사이드 이펙트만)
import { applyUpdate } from './lib/pwa'
import { msg } from './lib/msg'

// Sentry 가장 먼저 (이후 발생하는 모든 에러 캐치)
initSentry()

// 지도 SDK 미리 로드 (지도 화면 진입 시 즉시 사용 가능)
preloadNaverMapSDK()

// 모바일 브라우저 자체 확대/축소 방지.
// iOS Safari 계열은 viewport user-scalable=no만으로는 핀치 줌이 남는 경우가 있어
// gesture 이벤트와 두 손가락 touchmove를 함께 막는다.
const preventBrowserZoom = (event: Event) => {
  event.preventDefault()
}

document.addEventListener('gesturestart', preventBrowserZoom, { passive: false })
document.addEventListener('gesturechange', preventBrowserZoom, { passive: false })
document.addEventListener('gestureend', preventBrowserZoom, { passive: false })
document.addEventListener('touchmove', (event) => {
  if (event.touches.length > 1) {
    event.preventDefault()
  }
}, { passive: false })

import { Sentry } from './lib/sentry'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Sentry.ErrorBoundary
      fallback={({ error }) => {
        // PWA 캐시 깨짐 (배포 후 옛 bundle hash 가 존재 안 함) 의심 신호
        const errMessage = String((error as Error)?.message ?? '')
        const isChunkError = /Failed to fetch dynamically imported module|ChunkLoadError|Loading chunk/.test(errMessage)

        const hardReload = async () => {
          try {
            await applyUpdate()
          } catch {
            window.alert(msg('업데이트를 적용하지 못했습니다. 잠시 후 다시 눌러 주세요.'))
          }
        }

        return (
          <div
            style={{
              minHeight: 'calc(100vh / var(--app-zoom, 1))',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '40px 24px',
              textAlign: 'center',
              background: 'var(--bg, #F8F8F7)',
              fontFamily: 'Pretendard Variable, Pretendard, -apple-system, BlinkMacSystemFont, sans-serif',
            }}
          >
            <h2 style={{
              margin: '0 0 8px', fontSize: 20, fontWeight: 700,
              color: 'var(--ink, #1A1A18)', letterSpacing: '-0.01em',
            }}>
              {isChunkError ? msg('새 버전이 준비됐습니다.') : msg('오류가 발생했습니다')}
            </h2>
            <p style={{
              margin: '0 0 24px', fontSize: 14, fontWeight: 400,
              color: 'var(--muted, #7A7A75)', lineHeight: 1.55,
              maxWidth: 320,
            }}>
              {isChunkError
                ? msg('입력한 내용을 저장한 뒤 업데이트해 주세요. 다른 앱 창도 새로고침됩니다.')
                : msg('자료를 불러오지 못했습니다. 연결을 확인하고 다시 시도해 주세요.')}
            </p>
            <button
              onClick={() => void hardReload()}
              style={{
                height: 44, minHeight: 44, padding: '0 22px',
                background: 'var(--ink, #1A1A18)', color: '#fff',
                border: 'none', borderRadius: 8,
                fontSize: 14, fontWeight: 600,
                cursor: 'pointer', letterSpacing: '-0.005em',
              }}
            >
              {msg('앱 다시 불러오기')}
            </button>
          </div>
        )
      }}
    >
      <BrowserRouter>
        <App />
        <Analytics />
      </BrowserRouter>
    </Sentry.ErrorBoundary>
  </StrictMode>,
)
