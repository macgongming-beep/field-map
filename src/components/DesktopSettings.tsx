import { NavLink, Outlet, useLocation } from 'react-router-dom'
import type { ReturnVisit, Role } from '../types'
import { useAdminAttentionCounts } from '../hooks/useAdminAttentionCounts'
import type { AttentionUser } from '../utils/adminAttention'
import { msg } from '../lib/msg'


function isAdminLike(role: Role): boolean {
  return role === 'admin' || role === 'developer'
}

function SidebarLink({ to, icon, label, count, countLabel }: { to: string; icon: React.ReactNode; label: string; count?: number; countLabel?: string }) {
  return (
    <NavLink
      to={to}
      style={({ isActive }) => ({
        display: 'flex', alignItems: 'center', gap: 12, width: '100%',
        padding: '12px 16px', borderRadius: 10,
        background: isActive ? 'var(--gray-100)' : 'transparent',
        color: isActive ? 'var(--gray-900)' : 'var(--gray-700)',
        fontWeight: isActive ? 700 : 500,
        textDecoration: 'none', transition: 'background 0.15s, color 0.15s'
      })}
    >
      <span style={{ display: 'grid', placeItems: 'center', color: 'inherit' }}>
        {icon}
      </span>
      <span style={{ fontSize: 14 }}>{label}</span>
      {!!count && count > 0 && (
        <span className="mobile-settings-badge" style={{ marginLeft: 'auto' }} aria-label={msg('{label} {count}건', { label: countLabel ?? label, count })}>
          {count}
        </span>
      )}
    </NavLink>
  )
}

export function DesktopSettings({
  actualRole,
  onLogout,
  allUsers,
  returnVisits,
}: {
  currentUserId: number
  actualRole: Role
  onLogout: () => void
  allUsers: AttentionUser[]
  returnVisits: ReturnVisit[]
}) {
  const location = useLocation()
  const adminAttention = useAdminAttentionCounts({
    enabled: isAdminLike(actualRole),
    users: allUsers,
    returnVisits,
    refreshKey: location.pathname,
  })

  return (
    <div style={{ display: 'flex', width: '100%', maxWidth: 1200, height: 'calc(100vh / var(--app-zoom, 1))', padding: '24px 32px' }}>
      
      {/* Sidebar */}
      <aside style={{ width: 260, flexShrink: 0, paddingRight: 24, borderRight: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column' }}>
        {/* 다른 화면과 같은 제목 스타일을 쓴다. 예전에는 여기만 24px·왼쪽 여백 8px 이라
            설정에 들어올 때 제목이 커지고 밀려 보였다 */}
        <header className="page-header" style={{ marginBottom: 24 }}>
          <div className="page-header-text">
            <h1 className="page-header-title">설정</h1>
          </div>
        </header>
        
        <div style={{ display: 'grid', gap: 4, marginBottom: 24 }}>
          <SidebarLink
            to="/settings/profile"
            icon={<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>}
            label="내 정보"
          />
        </div>

        <div style={{ display: 'grid', gap: 4, marginBottom: 24 }}>
          <h3 style={{ fontSize: 12, fontWeight: 700, color: 'var(--gray-500)', marginBottom: 8, paddingLeft: 16, textTransform: 'uppercase', letterSpacing: 0.5 }}>소식 & 알림</h3>
          <SidebarLink
            to="/settings/notification"
            icon={<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg>}
            label="알림 디바이스 설정"
          />
          <SidebarLink
            to="/settings/location-permission"
            icon={<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 21s7-4.6 7-11a7 7 0 1 0-14 0c0 6.4 7 11 7 11Z"></path><circle cx="12" cy="10" r="2.5"></circle></svg>}
            label="위치 권한"
          />
        </div>

        {isAdminLike(actualRole) && (
          <div style={{ display: 'grid', gap: 4, marginBottom: 24 }}>
            <h3 style={{ fontSize: 12, fontWeight: 700, color: 'var(--gray-500)', marginBottom: 8, paddingLeft: 16, textTransform: 'uppercase', letterSpacing: 0.5 }}>관리 (Admin)</h3>
            <SidebarLink
              to="/settings/users"
              icon={<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>}
              label="사용자 관리"
            />
            <SidebarLink
              to="/settings/signup-requests"
              icon={<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="8.5" cy="7" r="4"></circle><line x1="20" y1="8" x2="20" y2="14"></line><line x1="23" y1="11" x2="17" y2="11"></line></svg>}
              label="가입 신청 관리"
              count={adminAttention.signupRequests}
              countLabel={msg('승인 대기')}
            />
            {actualRole === 'developer' && (
              <SidebarLink
                to="/settings/service-logs"
                icon={<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 8h10M7 12h10M7 16h6" /></svg>}
                label="봉사 로그 조회"
              />
            )}
            <SidebarLink
              to="/settings/territory-regions"
              icon={<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z" /><circle cx="12" cy="10" r="2.5" /></svg>}
              label="지역 관리"
            />
            <SidebarLink
              to="/settings/special-periods"
              icon={<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>}
              label="특별 봉사 시즌"
            />
            <SidebarLink
              to="/settings/suggestions"
              icon={<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>}
              label="대화 방법 제안 관리"
            />
            <SidebarLink
              to="/settings/data-management"
              icon={<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"></ellipse><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"></path><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"></path></svg>}
              label="데이터 관리"
            />
            <SidebarLink
              to="/settings/regular-visits"
              icon={<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 11l18-5v12L3 14v-3z"></path><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"></path></svg>}
              label="정기방문 관리"
              count={adminAttention.regularVisits}
              countLabel={msg('재지정 필요')}
            />
            <SidebarLink
              to="/settings/place-change-requests"
              icon={<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>}
              label={msg('자료 수정 요청')}
              count={adminAttention.placeRequests}
              countLabel={msg('처리 대기')}
            />
          </div>
        )}

        <div style={{ marginTop: 'auto', display: 'grid', gap: 4 }}>
          <button
            onClick={onLogout}
            style={{
              display: 'flex', alignItems: 'center', gap: 12, width: '100%',
              padding: '12px 16px', borderRadius: 10, border: 'none',
              background: 'transparent', color: 'var(--gray-700)', fontWeight: 500,
              cursor: 'pointer', textAlign: 'left', transition: 'background 0.15s, color 0.15s'
            }}
            type="button"
            onMouseOver={(e) => { e.currentTarget.style.background = 'var(--gray-100)'; e.currentTarget.style.color = 'var(--danger-600)' }}
            onMouseOut={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--gray-700)' }}
          >
            <span style={{ display: 'grid', placeItems: 'center', color: 'inherit' }}>
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>
            </span>
            <span style={{ fontSize: 14 }}>로그아웃</span>
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <main style={{ flex: 1, paddingLeft: 40, overflowY: 'auto' }}>
        <div style={{ maxWidth: 640 }}>
          <Outlet />
        </div>
      </main>
      
    </div>
  )
}
