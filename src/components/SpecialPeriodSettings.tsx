import { useState, type CSSProperties } from 'react'
import type { SpecialPeriod } from '../types'
import { confirmDialog } from '../lib/confirm'
import { findActivePeriod } from '../utils/specialPeriod'
import { getLocalDateString } from '../utils/dateUtils'
import { PERIOD_COLORS } from '../types'
import { msg } from '../lib/msg'

type PeriodInput = { label: string; startDate: string; endDate: string; color: string; hasInvitation: boolean }

function ColorPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="sps-color-picker" role="radiogroup" aria-label={msg('시즌 색상')}>
      {PERIOD_COLORS.map((c) => (
        <button
          key={c.value}
          type="button"
          title={msg(c.label)}
          aria-label={msg(c.label)}
          aria-checked={value === c.value}
          role="radio"
          className={value === c.value ? 'is-selected' : ''}
          onClick={() => onChange(c.value)}
          style={{ '--period-color': c.value } as CSSProperties}
        >
          {value === c.value && <span aria-hidden="true">✓</span>}
        </button>
      ))}
    </div>
  )
}

function PeriodForm({
  title,
  initial,
  todayStr,
  onSubmit,
  onCancel,
  submitLabel,
  submitting,
}: {
  title: string
  initial: PeriodInput
  todayStr: string
  onSubmit: (input: PeriodInput) => void
  onCancel: () => void
  submitLabel: string
  submitting: boolean
}) {
  const [label, setLabel] = useState(initial.label)
  const [startDate, setStartDate] = useState(initial.startDate)
  const [endDate, setEndDate] = useState(initial.endDate)
  const [color, setColor] = useState(initial.color)
  const [hasInvitation, setHasInvitation] = useState(initial.hasInvitation)

  const dateOrderInvalid = Boolean(startDate && endDate && endDate < startDate)
  const canSubmit = Boolean(label.trim() && startDate && endDate && !dateOrderInvalid && !submitting)
  const changeStartDate = (next: string) => {
    setStartDate(next)
    if (endDate && endDate < next) setEndDate(next)
  }

  return (
    <div className="cal-modal-backdrop" onClick={onCancel}>
      <div className="cal-modal sps-modal" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="cal-modal-head">
          <div className="cal-modal-title"><h2>{title}</h2></div>
          <button className="cal-modal-close" onClick={onCancel} type="button" aria-label={msg('닫기')}>×</button>
        </div>
        <div className="sps-form-body">
          <label className="sps-field">
            <span>{msg('시즌 이름')} <em>*</em></span>
            <input placeholder={msg('예: 봄 특별봉사 2026')} value={label} onChange={(e) => setLabel(e.target.value)} />
          </label>
          <div className="sps-date-grid">
            <label className="sps-field">
              <span>{msg('시작일')}</span>
              <input aria-label={msg('시작일')} type="date" value={startDate} onChange={(e) => changeStartDate(e.target.value)} />
            </label>
            <label className="sps-field">
              <span>{msg('종료일')}</span>
              <input aria-label={msg('종료일')} type="date" min={startDate || undefined} value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </label>
          </div>
          {dateOrderInvalid && <p className="sps-field-error" role="alert">{msg('종료일은 시작일보다 빠를 수 없습니다.')}</p>}
          <div className="sps-field">
            <span>{msg('색상')}</span>
            <ColorPicker value={color} onChange={setColor} />
          </div>
          <label className={`sps-invitation-option${hasInvitation ? ' is-selected' : ''}`}>
            <input
              type="checkbox"
              checked={hasInvitation}
              onChange={(e) => setHasInvitation(e.target.checked)}
            />
            <div>
              <strong>{msg('초대장 봉사')}</strong>
              <p>{msg('봉사 화면에 세대별 초대장 표시가 나타납니다.')}</p>
            </div>
          </label>
          {startDate && endDate && !dateOrderInvalid && (
            <div className="sps-date-summary" style={{ '--period-color': color } as CSSProperties}>
              <span>{startDate}</span><b aria-hidden="true">→</b><span>{endDate}</span>
              {startDate <= todayStr && endDate >= todayStr && <strong>{msg('현재 진행 중')}</strong>}
            </div>
          )}
        </div>
        <div className="sps-form-actions">
          <button onClick={onCancel} type="button" className="sps-cancel-btn">{msg('취소')}</button>
          <button onClick={() => canSubmit && onSubmit({ label: label.trim(), startDate, endDate, color, hasInvitation })} type="button" disabled={!canSubmit}
            className="sps-save-btn">
            {submitting ? msg('저장 중...') : submitLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

export function SpecialPeriodSettings({
  specialPeriods = [],
  isAdmin,
  onCreateSpecialPeriod,
  onUpdateSpecialPeriod,
  onDeleteSpecialPeriod,
}: {
  specialPeriods?: SpecialPeriod[]
  isAdmin: boolean
  onCreateSpecialPeriod?: (input: PeriodInput) => Promise<boolean | void> | boolean | void
  onUpdateSpecialPeriod?: (id: number, input: PeriodInput) => Promise<boolean | void> | boolean | void
  onDeleteSpecialPeriod?: (id: number) => Promise<void> | void
}) {
  const todayStr = getLocalDateString()
  const activePeriod = findActivePeriod(specialPeriods, todayStr)
  const upcomingPeriods = specialPeriods.filter((p) => todayStr < p.startDate).sort((a, b) => a.startDate.localeCompare(b.startDate))
  const pastPeriods = specialPeriods.filter((p) => todayStr > p.endDate).sort((a, b) => b.startDate.localeCompare(a.startDate))

  const [showCreateModal, setShowCreateModal] = useState(false)
  const [editingPeriod, setEditingPeriod] = useState<SpecialPeriod | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const dDay = (() => {
    if (!activePeriod) return null
    const end = new Date(activePeriod.endDate)
    const today = new Date(todayStr)
    return Math.ceil((end.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
  })()

  const handleCreate = async (input: PeriodInput) => {
    if (!onCreateSpecialPeriod) return
    setSubmitting(true)
    try {
      const saved = await Promise.resolve(onCreateSpecialPeriod(input))
      if (saved !== false) setShowCreateModal(false)
    } finally {
      setSubmitting(false)
    }
  }

  const handleUpdate = async (input: PeriodInput) => {
    if (!editingPeriod || !onUpdateSpecialPeriod) return
    setSubmitting(true)
    try {
      const saved = await Promise.resolve(onUpdateSpecialPeriod(editingPeriod.id, input))
      if (saved !== false) setEditingPeriod(null)
    } finally {
      setSubmitting(false)
    }
  }

  const rowStyle = { display: 'flex', alignItems: 'center', justifyContent: 'space-between' as const, gap: '10px', minHeight: '54px', padding: '8px 0', background: 'transparent', borderBottom: '1px solid var(--line)' }
  const actionBtnStyle = (danger?: boolean) => ({ padding: '3px 10px', border: `1px solid var(--line)`, borderRadius: '6px', background: 'var(--bg)', color: danger ? 'var(--status-danger)' : 'var(--muted)', fontSize: '12px', fontWeight: 600 as const, cursor: 'pointer' })

  return (
    <div className="special-period-settings">
      {activePeriod && (
        <div style={{ marginBottom: 16, padding: 16, background: 'var(--surface)', border: `1px solid var(--line)`, borderLeft: `4px solid ${activePeriod.color || 'var(--ink)'}`, borderRadius: 8 }}>
          {/* 헤더 행: 상태 라벨 + D-day + 액션 버튼 */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
              <span style={{ width: 6, height: 6, borderRadius: 99, background: activePeriod.color || 'var(--ink)', flexShrink: 0 }} />
              <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{msg('특별봉사 진행 중')}</span>
              {dDay !== null && (
                <span style={{ flexShrink: 0, padding: '1px 7px', borderRadius: 4, background: activePeriod.color || 'var(--ink)', color: '#fff', fontWeight: 700, fontSize: 11 }}>
                  {dDay > 0 ? `D-${dDay}` : dDay === 0 ? msg('오늘 마지막') : `D+${Math.abs(dDay)}`}
                </span>
              )}
            </div>
            {isAdmin && (
              <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                <button onClick={() => setEditingPeriod(activePeriod)} type="button" style={actionBtnStyle()}>{msg('수정')}</button>
                <button onClick={async () => { if (await confirmDialog({ message: msg('"{label}" 시즌을 즉시 종료할까요?\n이미 기록된 방문은 보존됩니다.', { label: activePeriod.label }), danger: true, confirmLabel: msg('종료') })) void onDeleteSpecialPeriod?.(activePeriod.id) }} type="button" style={actionBtnStyle(true)}>{msg('종료')}</button>
              </div>
            )}
          </div>
          {/* 시즌 이름 */}
          <p style={{ fontSize: 15, fontWeight: 700, margin: '0 0 4px', color: 'var(--ink)' }}>{activePeriod.label}</p>
          {/* 날짜: 한 줄 고정 */}
          <p style={{ fontSize: 12.5, color: 'var(--muted)', margin: '0 0 10px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontVariantNumeric: 'tabular-nums' }}>
            {activePeriod.startDate} ~ {activePeriod.endDate}
          </p>
          <p style={{ fontSize: 12, color: 'var(--muted)', margin: 0, lineHeight: 1.5 }}>
            {msg('기간 동안의 모든 방문 기록은 자동으로 이 시즌에 연결됩니다.')}
          </p>
        </div>
      )}

      {isAdmin && (
        <div className="detail-card" style={{ marginBottom: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
            <h2 style={{ fontSize: '15px', fontWeight: 700, margin: 0 }}>{msg('시즌 목록')}</h2>
            <button onClick={() => setShowCreateModal(true)} type="button"
              style={{ padding: '6px 14px', border: 0, borderRadius: '7px', background: 'var(--ink)', color: '#fff', fontSize: '13px', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>
              + {msg('새 시즌')}
            </button>
          </div>

          {upcomingPeriods.length > 0 && (
            <div style={{ marginBottom: '14px' }}>
              <p style={{ fontSize: '11px', fontWeight: 700, color: 'var(--muted)', margin: '0 0 6px' }}>{msg('예정')}</p>
              {upcomingPeriods.map((period) => (
                <div key={period.id} style={rowStyle}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: period.color, flexShrink: 0 }} />
                    <div style={{ minWidth: 0 }}>
                      <strong style={{ fontSize: '13px', display: 'block' }}>{period.label}</strong>
                      <div style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '2px' }}>{period.startDate} ~ {period.endDate}</div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                    <button onClick={() => setEditingPeriod(period)} type="button" style={actionBtnStyle()}>{msg('수정')}</button>
                    <button onClick={async () => { if (await confirmDialog({ message: msg('"{label}" 예정 시즌을 삭제할까요?', { label: period.label }), danger: true, confirmLabel: msg('삭제') })) void onDeleteSpecialPeriod?.(period.id) }} type="button" style={actionBtnStyle(true)}>{msg('삭제')}</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {pastPeriods.length > 0 && (
            <div>
              <p style={{ fontSize: '11px', fontWeight: 700, color: 'var(--muted)', margin: '0 0 6px' }}>{msg('지난 시즌')}</p>
              {pastPeriods.slice(0, 5).map((period) => (
                <div key={period.id} style={{ ...rowStyle, opacity: 0.7 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: period.color, flexShrink: 0 }} />
                    <div style={{ minWidth: 0 }}>
                      <strong style={{ fontSize: '13px', color: 'var(--ink)', display: 'block' }}>{period.label}</strong>
                      <div style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '2px' }}>{period.startDate} ~ {period.endDate}</div>
                    </div>
                  </div>
                  <button onClick={async () => { if (await confirmDialog({ message: msg('"{label}" 시즌을 삭제할까요? 방문 기록은 보존됩니다.', { label: period.label }), danger: true, confirmLabel: msg('삭제') })) void onDeleteSpecialPeriod?.(period.id) }} type="button" style={actionBtnStyle(true)}>{msg('삭제')}</button>
                </div>
              ))}
              {pastPeriods.length > 5 && (
                <p style={{ fontSize: '11px', color: 'var(--muted)', margin: '6px 0 0', textAlign: 'center' }}>{msg('외 {count}건', { count: pastPeriods.length - 5 })}</p>
              )}
            </div>
          )}

          {specialPeriods.length === 0 && (
            <p style={{ fontSize: '13px', color: 'var(--muted)', margin: 0, textAlign: 'center', padding: '16px 0' }}>{msg('등록된 시즌이 없습니다.')}</p>
          )}
        </div>
      )}

      {showCreateModal && (
        <PeriodForm
          title={msg('새 특별봉사 시즌')}
          initial={{ label: '', startDate: todayStr, endDate: '', color: PERIOD_COLORS[0].value, hasInvitation: false }}
          todayStr={todayStr}
          onSubmit={(input) => void handleCreate(input)}
          onCancel={() => setShowCreateModal(false)}
          submitLabel={msg('시즌 생성')}
          submitting={submitting}
        />
      )}

      {editingPeriod && (
        <PeriodForm
          title={msg('시즌 수정')}
          initial={{ label: editingPeriod.label, startDate: editingPeriod.startDate, endDate: editingPeriod.endDate, color: editingPeriod.color || PERIOD_COLORS[0].value, hasInvitation: editingPeriod.hasInvitation ?? false }}
          todayStr={todayStr}
          onSubmit={(input) => void handleUpdate(input)}
          onCancel={() => setEditingPeriod(null)}
          submitLabel={msg('저장')}
          submitting={submitting}
        />
      )}
    </div>
  )
}
