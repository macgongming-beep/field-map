import { useState } from 'react'
import { showToast } from '../../lib/toast'
import { msg } from '../../lib/msg'
import { parsePastedEvents, type ParsedEvent } from '../../utils/eventImport'

type ImportEventsModalProps = {
  isOpen: boolean
  onClose: () => void
  onCreateEvent: (input: { date: string; time: string; endTime?: string; title: string; place: string; mapLink?: string; leader: string; memo: string; hasMeeting: boolean; allowApplications: boolean; allowCartApplications?: boolean; cartCapacity?: number | null }) => void
}

export function ImportEventsModal({ isOpen, onClose, onCreateEvent }: ImportEventsModalProps) {
  const [pasteData, setPasteData] = useState('')
  const [parsedRows, setParsedRows] = useState<ParsedEvent[]>([])
  const [isProcessing, setIsProcessing] = useState(false)

  if (!isOpen) return null

  const handleParse = () => {
    if (!pasteData.trim()) {
      showToast(msg('입력된 데이터가 없습니다.'), 'error')
      return
    }

    const results = parsePastedEvents(pasteData)

    if (results.length === 0) {
      showToast(msg('올바른 양식의 데이터를 찾을 수 없습니다. (엑셀에서 여러 열을 드래그하여 복사해주세요)'), 'error')
      return
    }

    setParsedRows(results)
    showToast(msg('{length}개의 일정을 인식했습니다.', { length: results.length }), 'success')
  }

  const handleImport = async () => {
    if (parsedRows.length === 0) return
    setIsProcessing(true)
    
    try {
      // API 병목이나 UI 블로킹을 막기 위해 약간의 딜레이를 두고 순차 호출 (필요시 병렬 호출)
      for (const row of parsedRows) {
        onCreateEvent({
          date: row.date,
          time: row.time,
          endTime: row.endTime || undefined,
          title: row.title || '전도',
          place: row.place,
          leader: row.leader,
          memo: row.memo,
          hasMeeting: false,
          allowApplications: row.allowApplications,
          allowCartApplications: row.allowCartApplications,
          cartCapacity: row.cartCapacity,
        })
        // 서버 과부하 방지를 위해 30ms 대기
        await new Promise((r) => setTimeout(r, 30))
      }
      showToast(msg('성공적으로 {length}개의 일정을 가져왔습니다.', { length: parsedRows.length }), 'success')
      onClose()
    } catch {
      showToast(msg('일부 일정을 등록하는 중 오류가 발생했습니다.'), 'error')
    } finally {
      setIsProcessing(false)
    }
  }

  const reset = () => {
    setPasteData('')
    setParsedRows([])
  }

  const isPreview = parsedRows.length > 0

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 99999,
        padding: 20,
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 600,
          background: 'var(--bg)',
          borderRadius: 16,
          padding: '24px 24px 20px',
          boxShadow: '0 20px 40px rgba(0,0,0,0.2)',
          display: 'flex',
          flexDirection: 'column',
          maxHeight: 'calc(90vh / var(--app-zoom, 1))',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: 'var(--ink)' }}>
            일정 가져오기 (엑셀 붙여넣기)
          </h2>
          {isPreview && (
            <button
              type="button"
              onClick={reset}
              style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 14, fontWeight: 650, cursor: 'pointer', padding: '4px 8px' }}
            >
              다시 붙여넣기
            </button>
          )}
        </div>

        {!isPreview ? (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16, gap: 16 }}>
              <p style={{ margin: 0, fontSize: 14, color: 'var(--muted)', lineHeight: 1.5 }}>
                엑셀이나 구글 스프레드시트에서 표 영역을 선택하여 복사(Ctrl+C)한 뒤, 아래 창에 붙여넣기(Ctrl+V) 해주세요.<br/>
                <b>필수 컬럼 순서</b>: 날짜, 시작시간, 종료시간, 제목, 장소, 인도자
              </p>
              <button
                type="button"
                onClick={() => {
                  const headers = ['날짜', '시작시간', '종료시간', '제목', '장소', '인도자']
                  const sampleRow = ['2026-05-25', '10:00', '12:00', '传道', '스타벅스', '관리자']
                  const csvContent = '\uFEFF' + headers.join(',') + '\n' + sampleRow.join(',')
                  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
                  const url = URL.createObjectURL(blob)
                  const link = document.createElement('a')
                  link.href = url
                  link.setAttribute('download', '일정_가져오기_양식.csv')
                  document.body.appendChild(link)
                  link.click()
                  document.body.removeChild(link)
                }}
                style={{ flexShrink: 0, padding: '8px 12px', borderRadius: 8, background: 'var(--bg-card)', border: '1px solid var(--border-default)', fontSize: 13, fontWeight: 650, cursor: 'pointer', color: 'var(--ink)' }}
              >
                📥 엑셀 양식 다운로드
              </button>
            </div>
            <textarea
              value={pasteData}
              onChange={(e) => setPasteData(e.target.value)}
              placeholder="여기에 엑셀 데이터를 붙여넣으세요..."
              style={{
                width: '100%',
                height: 200,
                padding: 16,
                borderRadius: 10,
                border: '1px solid var(--border-default)',
                background: 'var(--bg-card)',
                resize: 'none',
                fontFamily: 'monospace',
                fontSize: 13,
                outline: 'none',
                marginBottom: 20,
                boxSizing: 'border-box'
              }}
            />
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                type="button"
                onClick={onClose}
                style={{ flex: 1, padding: '12px 0', borderRadius: 10, background: 'var(--bg-card)', border: '1px solid var(--border-default)', fontSize: 15, fontWeight: 650, cursor: 'pointer' }}
              >
                취소
              </button>
              <button
                type="button"
                onClick={handleParse}
                style={{ flex: 1, padding: '12px 0', borderRadius: 10, background: 'var(--ink)', color: '#fff', border: 'none', fontSize: 15, fontWeight: 650, cursor: 'pointer' }}
              >
                미리보기
              </button>
            </div>
          </>
        ) : (
          <>
            <p style={{ fontSize: 14, color: 'var(--muted)', marginBottom: 16, lineHeight: 1.5 }}>
              총 <b>{parsedRows.length}</b>개의 일정을 인식했습니다. 아래 내역이 맞는지 확인 후 등록을 눌러주세요.
            </p>
            
            <div style={{ flex: 1, overflowY: 'auto', marginBottom: 20, border: '1px solid var(--line-2)', borderRadius: 10, background: 'var(--bg-card)' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, textAlign: 'left' }}>
                <thead style={{ position: 'sticky', top: 0, background: 'var(--gray-50)', borderBottom: '1px solid var(--line-2)' }}>
                  <tr>
                    <th style={{ padding: '10px 12px', fontWeight: 650, color: 'var(--muted)' }}>날짜</th>
                    <th style={{ padding: '10px 12px', fontWeight: 650, color: 'var(--muted)' }}>시간</th>
                    <th style={{ padding: '10px 12px', fontWeight: 650, color: 'var(--muted)' }}>제목</th>
                    <th style={{ padding: '10px 12px', fontWeight: 650, color: 'var(--muted)' }}>장소</th>
                  </tr>
                </thead>
                <tbody>
                  {parsedRows.map((row, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid var(--line-2)' }}>
                      <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>{row.date}</td>
                      <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>{row.time}{row.endTime ? `~${row.endTime}` : ''}</td>
                      <td style={{ padding: '10px 12px', color: 'var(--ink)' }}>{row.title}</td>
                      <td style={{ padding: '10px 12px', color: 'var(--muted)' }}>{row.place}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ display: 'flex', gap: 10, marginTop: 'auto' }}>
              <button
                type="button"
                onClick={onClose}
                disabled={isProcessing}
                style={{ flex: 1, padding: '12px 0', borderRadius: 10, background: 'var(--bg-card)', border: '1px solid var(--border-default)', fontSize: 15, fontWeight: 650, cursor: 'pointer', opacity: isProcessing ? 0.5 : 1 }}
              >
                취소
              </button>
              <button
                type="button"
                onClick={handleImport}
                disabled={isProcessing}
                style={{ flex: 1, padding: '12px 0', borderRadius: 10, background: 'var(--ink)', color: '#fff', border: 'none', fontSize: 15, fontWeight: 650, cursor: isProcessing ? 'not-allowed' : 'pointer', opacity: isProcessing ? 0.7 : 1 }}
              >
                {isProcessing ? '등록 중...' : `${parsedRows.length}개 일정 등록하기`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
