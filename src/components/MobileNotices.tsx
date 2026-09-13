import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { confirmDialog } from '../lib/confirm'
import type { Notice, Role } from '../types'
import { t, type AppLanguage } from '../i18n'
import { CommentSection, type MentionUser } from './CommentSection'
import { msg } from '../lib/msg'

const PRIORITY_COLOR: Record<Notice['priority'], { bg: string; color: string }> = {
  긴급: { bg: 'var(--status-danger-bg)', color: 'var(--status-danger)' },
  일반: { bg: 'var(--tint)', color: 'var(--text)' },
  정보: { bg: 'var(--status-info-bg)', color: 'var(--status-info)' },
}

function translatePriority(priority: Notice['priority'], language: AppLanguage): string {
  if (priority === '긴급') return t(language, 'notices.priorityUrgent')
  if (priority === '정보') return t(language, 'notices.priorityInfo')
  return t(language, 'notices.priorityNormal')
}

export function MobileNotices({
  language = 'ko',
  currentVisitor,
  currentUserId,
  notices,
  role,
  mentionUsers = [],
  noticesEnabled = true,
  variant = 'mobile',
  onToggleNotices,
  onCreateNotice,
  onDeleteNotice,
}: {
  language?: AppLanguage
  currentVisitor: string
  currentUserId?: number | null
  notices: Notice[]
  role: Role
  mentionUsers?: MentionUser[]
  noticesEnabled?: boolean
  variant?: 'mobile' | 'desktop'
  onToggleNotices?: (enabled: boolean) => Promise<boolean>
  onCreateNotice: (input: { title: string; content: string; priority: Notice['priority']; author: string }) => void
  onDeleteNotice: (id: number) => void
}) {
  const isAdmin = role === 'admin' || role === 'developer'
  const [showCreate, setShowCreate] = useState(false)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [priority, setPriority] = useState<Notice['priority']>('일반')
  const [searchParams, setSearchParams] = useSearchParams()

  useEffect(() => {
    const noticeId = searchParams.get('noticeId')
    if (!noticeId) return
    const notice = notices.find((item) => item.id === Number(noticeId))
    if (!notice) return

    setTimeout(() => {
      document.getElementById(`mobile-notice-${noticeId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 120)

    const next = new URLSearchParams(searchParams)
    next.delete('noticeId')
    setSearchParams(next, { replace: true })
  }, [notices, searchParams, setSearchParams])

  const handleCreate = () => {
    if (!title.trim() || !content.trim()) return
    onCreateNotice({ title: title.trim(), content: content.trim(), priority, author: currentVisitor })
    setTitle(''); setContent(''); setPriority('일반')
    setShowCreate(false)
  }

  return (
    <div style={{ padding: '18px 18px 32px' }}>
      {showCreate && (
        <>
          <div className={variant === 'desktop' ? 'notice-create-backdrop' : 'mobile-sheet-backdrop'} onClick={() => setShowCreate(false)} />
          <div className={variant === 'desktop' ? 'notice-create-dialog' : 'mobile-sheet'}>
            {variant === 'mobile' && <div className="mobile-sheet-handle" />}
            <div className="mobile-sheet-title">
              <h2>{t(language, 'notices.create')}</h2>
              <button className="mobile-sheet-close" onClick={() => setShowCreate(false)} type="button">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="mobile-form-field">
              <label>{t(language, 'notices.priority')}</label>
              <select value={priority} onChange={(e) => setPriority(e.target.value as Notice['priority'])}>
                <option value="일반">{t(language, 'notices.priorityNormal')}</option>
                <option value="정보">{t(language, 'notices.priorityInfo')}</option>
                <option value="긴급">{t(language, 'notices.priorityUrgent')}</option>
              </select>
            </div>
            <div className="mobile-form-field">
              <label>{t(language, 'notices.titleLabel')}</label>
              <input placeholder={t(language, 'notices.titlePlaceholder')} value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="mobile-form-field">
              <label>{t(language, 'notices.contentLabel')}</label>
              <textarea placeholder={t(language, 'notices.contentPlaceholder')} value={content} onChange={(e) => setContent(e.target.value)} style={{ minHeight: '120px' }} />
            </div>
            <button className="mobile-form-save" disabled={!title.trim() || !content.trim()} onClick={handleCreate} type="button">{t(language, 'comment.submit')}</button>
            <button className="mobile-form-cancel" onClick={() => setShowCreate(false)} type="button">{t(language, 'common.cancel')}</button>
          </div>
        </>
      )}

      {isAdmin && (
        <label className="notice-feature-control">
          <span>
            <strong>{t(language, 'settings.noticesFeature')}</strong>
            <small>{t(language, 'settings.noticesFeatureDesc')}</small>
          </span>
          <input
            checked={noticesEnabled}
            onChange={(event) => { void onToggleNotices?.(event.target.checked) }}
            type="checkbox"
          />
        </label>
      )}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: 'var(--ink)', letterSpacing: '-0.01em' }}>{t(language, 'notices.sectionTitle')}</h2>
        {isAdmin && noticesEnabled && (
          <button
            onClick={() => setShowCreate(true)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              height: 32, minHeight: 32, padding: '0 12px', borderRadius: 8,
              background: 'var(--ink)', color: '#fff', fontSize: 13, fontWeight: 600,
              border: 'none', cursor: 'pointer', letterSpacing: '-0.005em',
            }}
            type="button"
          >
            {t(language, 'notices.createBtn')}
          </button>
        )}
      </div>

      {!noticesEnabled && (
        <div className="notice-feature-off">{t(language, 'notices.featureOff')}</div>
      )}

      {noticesEnabled && notices.length === 0 && (
        <div style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--muted)', fontSize: 13, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 12 }}>
          {t(language, 'notices.empty')}
        </div>
      )}

      {noticesEnabled && notices.map((notice) => (
        <div className="mobile-notice-card" id={`mobile-notice-${notice.id}`} key={notice.id}>
          <span className="mobile-notice-priority" style={{ background: PRIORITY_COLOR[notice.priority]?.bg, color: PRIORITY_COLOR[notice.priority]?.color }}>
            {translatePriority(notice.priority, language)}
          </span>
          <h3 className="mobile-notice-title">{notice.title}</h3>
          <p className="mobile-notice-content">{notice.content}</p>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
            <span className="mobile-notice-meta">{notice.author} · {notice.createdAt.slice(0, 10)}</span>
            {isAdmin && (
              <button
                onClick={async () => { if (await confirmDialog({ message: t(language, 'notices.deleteConfirm'), danger: true, confirmLabel: msg('삭제') })) onDeleteNotice(notice.id) }}
                style={{
                  height: 26, minHeight: 26, padding: '0 10px',
                  borderRadius: 8, border: 'none',
                  background: 'transparent', color: 'var(--muted)',
                  fontSize: 12, fontWeight: 500, cursor: 'pointer',
                }}
                type="button"
              >
                {t(language, 'common.delete')}
              </button>
            )}
          </div>
          <CommentSection
            compact
            language={language}
            currentUserId={currentUserId}
            currentVisitor={currentVisitor}
            role={role}
            targetId={notice.id}
            targetType="notice"
            users={mentionUsers}
          />
        </div>
      ))}
    </div>
  )
}
