import { useState } from 'react'
import type { CalendarEvent } from '../../types'
import { showToast } from '../../lib/toast'
import { msg } from '../../lib/msg'

type ExportEventsModalProps = {
  isOpen: boolean
  onClose: () => void
  events: CalendarEvent[]
}

export function ExportEventsModal({ isOpen, onClose, events }: ExportEventsModalProps) {
  const [filter, setFilter] = useState<'all' | 'this_month' | 'last_month'>('all')

  if (!isOpen) return null

  const handleExport = () => {
    let filtered = events
    const now = new Date()

    if (filter === 'this_month') {
      const year = now.getFullYear()
      const month = String(now.getMonth() + 1).padStart(2, '0')
      filtered = events.filter((e) => e.date.startsWith(`${year}-${month}`))
    } else if (filter === 'last_month') {
      const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1)
      const year = lastMonthDate.getFullYear()
      const month = String(lastMonthDate.getMonth() + 1).padStart(2, '0')
      filtered = events.filter((e) => e.date.startsWith(`${year}-${month}`))
    }

    if (filtered.length === 0) {
      showToast(msg('해당 기간에 내보낼 일정이 없습니다.'), 'error')
      return
    }

    // CSV 변환
    const headers = [
      '날짜', '시작시간', '종료시간', '제목', '장소', '인도자',
      '참여가능여부', '참석자(명수)', '전시대모집', '전시대정원', '전시대신청자(명수)',
    ]
    const csvRows = [headers.join(',')]

    for (const e of filtered) {
      const attendeesCount = e.assigned?.length || 0
      const allowApps = e.allowApplications ? 'O' : 'X'
      const row = [
        e.date,
        e.time,
        e.endTime || '',
        `"${e.title.replace(/"/g, '""')}"`,
        `"${e.place.replace(/"/g, '""')}"`,
        `"${e.leader.replace(/"/g, '""')}"`,
        allowApps,
        attendeesCount,
        e.allowCartApplications ? 'O' : 'X',
        e.allowCartApplications ? (e.cartCapacity ?? '') : '',
        e.cartApplicants?.length ?? 0,
      ]
      csvRows.push(row.join(','))
    }

    const bom = '\uFEFF'
    const csvContent = bom + csvRows.join('\n')
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.setAttribute('download', `일정내보내기_${filter}_${Date.now()}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    
    showToast(msg('총 {length}개의 일정을 내보냈습니다.', { length: filtered.length }), 'success')
    onClose()
  }

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
          maxWidth: 340,
          background: 'var(--bg)',
          borderRadius: 16,
          padding: 24,
          boxShadow: '0 20px 40px rgba(0,0,0,0.2)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 16px', color: 'var(--ink)' }}>일정 내보내기</h2>
        <p style={{ fontSize: 14, color: 'var(--muted)', marginBottom: 20, lineHeight: 1.5 }}>
          캘린더에 등록된 전체 일정 데이터를 엑셀(CSV) 파일로 다운로드합니다.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 24 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 15, cursor: 'pointer' }}>
            <input type="radio" name="exportFilter" checked={filter === 'all'} onChange={() => setFilter('all')} />
            전체 기간 다운로드
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 15, cursor: 'pointer' }}>
            <input type="radio" name="exportFilter" checked={filter === 'this_month'} onChange={() => setFilter('this_month')} />
            이번 달 ({new Date().getMonth() + 1}월) 다운로드
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 15, cursor: 'pointer' }}>
            <input type="radio" name="exportFilter" checked={filter === 'last_month'} onChange={() => setFilter('last_month')} />
            지난 달 ({new Date().getMonth() === 0 ? 12 : new Date().getMonth()}월) 다운로드
          </label>
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              flex: 1,
              padding: '12px 0',
              borderRadius: 10,
              background: 'var(--bg-card)',
              border: '1px solid var(--border-default)',
              fontSize: 15,
              fontWeight: 650,
              cursor: 'pointer',
            }}
          >
            취소
          </button>
          <button
            type="button"
            onClick={handleExport}
            style={{
              flex: 1,
              padding: '12px 0',
              borderRadius: 10,
              background: 'var(--ink)',
              color: '#fff',
              border: 'none',
              fontSize: 15,
              fontWeight: 650,
              cursor: 'pointer',
            }}
          >
            다운로드
          </button>
        </div>
      </div>
    </div>
  )
}
