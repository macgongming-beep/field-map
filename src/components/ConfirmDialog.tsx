// 전역 Confirm/Alert 렌더러 — Toast 와 동일하게 앱 루트에 1회 마운트.
// confirm.ts 의 이벤트 버스를 구독해 큐에 쌓고, 맨 앞 요청 하나만 표시한다.

import { useEffect, useState, useCallback, useRef } from 'react'
import { msg } from '../lib/msg'
import { registerDialogListener, type DialogRequest } from '../lib/confirm'

export function ConfirmDialog() {
  const [queue, setQueue] = useState<DialogRequest[]>([])
  const promptInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    return registerDialogListener((req) => {
      setQueue((prev) => [...prev, req])
    })
  }, [])

  const current = queue[0]

  const close = useCallback((value: boolean | string | null) => {
    if (!current) return
    if (current.kind === 'prompt') current.resolve(typeof value === 'string' ? value : null)
    else current.resolve(value === true)
    setQueue((prev) => prev.slice(1))
  }, [current])

  // Esc=취소, Enter=확인
  useEffect(() => {
    if (!current) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); close(current.kind === 'prompt' ? null : false) }
      else if (e.key === 'Enter') {
        e.preventDefault()
        if (current.kind === 'prompt') {
          const value = promptInputRef.current?.value.trim() ?? ''
          if (value) close(value)
        } else close(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [current, close])

  if (!current) return null

  // 문구는 여기서 한 번에 번역한다 — 호출부가 100곳이 넘어 각자 번역하게 두면
  // 빠뜨리기 쉽다. 이미 번역된 문구(t()로 만든 중국어 등)는 사전에 없으므로
  // 그대로 통과한다.
  const cancelLabel = msg(current.cancelLabel ?? '취소')
  const confirmLabel = msg(current.confirmLabel ?? '확인')

  return (
    <div
      className="cdlg-backdrop"
      onClick={() => close(current.kind === 'alert' ? true : current.kind === 'prompt' ? null : false)}
      role="presentation"
    >
      <div
        className="cdlg"
        onClick={(e) => e.stopPropagation()}
        role="alertdialog"
        aria-modal="true"
      >
        {current.title && <h2 className="cdlg-title">{msg(current.title)}</h2>}
        <p className="cdlg-message">{msg(current.message)}</p>
        {current.kind === 'prompt' && (
          <input
            className="cdlg-input"
            ref={promptInputRef}
            defaultValue={current.initialValue ?? ''}
            placeholder={msg(current.placeholder ?? '사유를 입력하세요')}
            maxLength={200}
            autoFocus
          />
        )}
        <div className="cdlg-actions">
          {current.kind !== 'alert' && (
            <button className="cdlg-btn cdlg-cancel" onClick={() => close(current.kind === 'prompt' ? null : false)} type="button">
              {cancelLabel}
            </button>
          )}
          <button
            className={`cdlg-btn cdlg-confirm${current.kind !== 'prompt' && current.danger ? ' cdlg-danger' : ''}`}
            onClick={() => {
              if (current.kind !== 'prompt') { close(true); return }
              const value = promptInputRef.current?.value.trim() ?? ''
              if (value) close(value)
            }}
            type="button"
            autoFocus={current.kind !== 'prompt'}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
