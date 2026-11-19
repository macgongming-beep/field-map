import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { confirmDialog } from '../lib/confirm'
import { useSharedAuth } from '../hooks/AuthContext'
import type { Role } from '../types'
import { roleLabels } from '../types'
import { AppHeader } from './AppHeader'
import { msg } from '../lib/msg'

type ApprovalTab = 'pending' | 'approved' | 'blocked'

// ⚠ 모듈 최상위에서 msg() 를 부르면 불러올 때의 언어로 굳는다 → 그릴 때 계산
function tabLabel(tab: ApprovalTab): string {
  if (tab === 'pending') return msg('승인대기')
  if (tab === 'approved') return msg('승인됨')
  return msg('차단됨')
}

function roleLabel(role: Role) {
  if (role === 'developer') return '개발자'
  if (role === 'user') return '봉사자'
  return roleLabels[role]
}

function formatDate(value?: string | null) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())}`
}

export function MobileSignupRequests({ isEmbedded }: { isEmbedded?: boolean }) {
  const navigate = useNavigate()
  const {
    user: currentUser,
    allUsers,
    fetchAllUsers,
    ensureAllUsersFresh,
    updateUserApprovalStatus,
    deleteUser,
  } = useSharedAuth()
  useEffect(() => { void ensureAllUsersFresh() }, [ensureAllUsersFresh])
  const [activeTab, setActiveTab] = useState<ApprovalTab>('pending')

  const isAdminLike = currentUser?.role === 'admin' || currentUser?.role === 'developer'

  const counts = useMemo(() => {
    return allUsers.reduce<Record<ApprovalTab, number>>((acc, item) => {
      const status = item.approvalStatus ?? 'approved'
      acc[status] += 1
      return acc
    }, { pending: 0, approved: 0, blocked: 0 })
  }, [allUsers])

  const users = useMemo(() => {
    return allUsers
      .filter((item) => (item.approvalStatus ?? 'approved') === activeTab)
      .sort((a, b) => {
        const dateA = a.created_at ?? ''
        const dateB = b.created_at ?? ''
        return activeTab === 'pending'
          ? dateA.localeCompare(dateB)
          : b.name.localeCompare(a.name, 'ko')
      })
  }, [activeTab, allUsers])

  if (!isAdminLike) {
    return (
      <div className="mobile-signup-requests-page">
        {!isEmbedded && (
          <AppHeader
            pageTitle={msg('가입 신청')}
            showBack
            onBack={() => navigate('/settings')}
            userId={currentUser?.id}
            userName={currentUser?.name}
            onOpenMenu={() => navigate('/settings')}
          />
        )}
        <section className="signup-request-empty-card">{msg('관리자만 사용할 수 있습니다.')}</section>
      </div>
    )
  }

  return (
    <div className="mobile-signup-requests-page">
      {!isEmbedded && (
        <AppHeader
          pageTitle={msg('가입 신청')}
          showBack
          onBack={() => navigate('/settings')}
          userId={currentUser?.id}
          userName={currentUser?.name}
          onOpenMenu={() => navigate('/settings')}
        />
      )}
      {isEmbedded && (
        <div style={{ padding: '0 4px 16px' }}>
          <h2 style={{ fontSize: 22, fontWeight: 800, color: 'var(--gray-900)', marginBottom: 8 }}>{msg('가입 신청 관리')}</h2>
        </div>
      )}

      <nav className="signup-request-tabs" aria-label={msg('가입 신청 상태')}>
        {(['pending', 'approved', 'blocked'] as ApprovalTab[]).map((tab) => (
          <button
            className={activeTab === tab ? 'active' : ''}
            key={tab}
            onClick={() => setActiveTab(tab)}
            type="button"
          >
            <span>{tabLabel(tab)}</span>
            <strong>{counts[tab]}</strong>
          </button>
        ))}
      </nav>

      {users.length === 0 ? (
        <section className="signup-request-empty-card">
          <span aria-hidden="true">✓</span>
          <strong>{msg('모두 처리되었습니다')}</strong>
          <p>{tabLabel(activeTab)} 사용자가 없습니다.</p>
          <button onClick={() => fetchAllUsers()} type="button">{msg('새로고침')}</button>
        </section>
      ) : (
        <section className="signup-request-list">
          {users.map((item) => (
            <article className="signup-request-card" key={item.id}>
              <div className="signup-request-card-head">
                <div>
                  <strong>{item.name}</strong>
                  <span>{item.loginId}</span>
                </div>
                <em>{roleLabel(item.role)}</em>
              </div>
              <p className="signup-request-meta">
                신청일 {formatDate(item.created_at)}
                {item.lastLoginAt ? ` · 마지막 로그인 ${formatDate(item.lastLoginAt)}` : ''}
              </p>
              <div className="signup-request-actions">
                {activeTab !== 'approved' && (
                  <button
                    className="approve"
                    onClick={() => updateUserApprovalStatus(item.id, 'approved')}
                    type="button"
                  >
                    {msg('승인')}
                  </button>
                )}
                {activeTab !== 'blocked' && currentUser?.id !== item.id && (
                  <button
                    className="block"
                    onClick={() => updateUserApprovalStatus(item.id, 'blocked')}
                    type="button"
                  >
                    {msg('차단')}
                  </button>
                )}
                {activeTab !== 'pending' && (
                  <button
                    className="pending"
                    onClick={() => updateUserApprovalStatus(item.id, 'pending')}
                    type="button"
                  >
                    {msg('대기')}
                  </button>
                )}
                {currentUser?.id !== item.id && (
                  <button
                    className="delete"
                    onClick={async () => {
                      if (!(await confirmDialog({ message: msg('{name} 계정을 삭제할까요?', { name: item.name }), danger: true, confirmLabel: msg('삭제') }))) return
                      void deleteUser(item.id)
                    }}
                    type="button"
                  >
                    {msg('삭제')}
                  </button>
                )}
              </div>
            </article>
          ))}
        </section>
      )}
    </div>
  )
}
