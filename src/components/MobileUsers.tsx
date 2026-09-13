import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth, type LoginLogRecord } from '../hooks/useAuth'
import { supabase } from '../lib/supabase'
import { showToast } from '../lib/toast'
import { confirmDialog } from '../lib/confirm'
import { pushBackHandler } from '../lib/backStack'
import {
  DEFAULT_USER_GROUPS,
  USER_GROUPS_SETTING_KEY,
  parseUserGroups,
  serializeUserGroups,
} from '../utils/userGroups'
import type { Role } from '../types'
import { roleLabels } from '../types'
import { AppHeader } from './AppHeader'
import { msg } from '../lib/msg'
import { CART_APPLICATIONS_ENABLED } from '../config/features'

type UserFilter = 'all' | 'admin' | 'leader' | 'user'

const roleOrder: Record<Role, number> = { developer: 0, admin: 1, leader: 2, user: 3 }

function displayRole(role: Role) {
  if (role === 'developer') return '개발자'
  if (role === 'user') return '봉사자'
  return roleLabels[role]
}

function roleClass(role: Role) {
  if (role === 'admin' || role === 'developer') return 'admin'
  if (role === 'leader') return 'leader'
  return 'user'
}

function formatLastLogin(value?: string | null) {
  if (!value) return msg('로그인 기록 없음')
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return msg('로그인 기록 없음')
  return `마지막 접속 ${date.getMonth() + 1}/${date.getDate()}`
}

function formatLoginDateTime(value?: string | null) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  const pad = (num: number) => String(num).padStart(2, '0')
  return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function MobileUsers({ isEmbedded }: { isEmbedded?: boolean }) {
  const navigate = useNavigate()
  const {
    user: currentUser,
    allUsers,
    fetchAllUsers,
    createUser,
    updateUserIdentity,
    updateUserRole,
    resetUserPin,
    deleteUser,
    updateUsersGroup,
    updateCartServiceApproval,
    renameUserGroup,
    fetchUserLoginLogs,
  } = useAuth()

  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState<UserFilter>('all')
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null)
  const [showAddForm, setShowAddForm] = useState(false)
  const [newLoginId, setNewLoginId] = useState('')
  const [newName, setNewName] = useState('')
  const [newPin, setNewPin] = useState('')
  const [newRole, setNewRole] = useState<Role>('user')
  const [editLoginId, setEditLoginId] = useState('')
  const [editName, setEditName] = useState('')
  const [editPin, setEditPin] = useState('')
  const [loginLogs, setLoginLogs] = useState<LoginLogRecord[]>([])
  const [loadingLoginLogs, setLoadingLoginLogs] = useState(false)
  const [loginLogsExpanded, setLoginLogsExpanded] = useState(false)
  // 집단(처인/신갈/동백/동탄 …) — app_settings.user_groups 에서 로드, 앱에서 편집 가능
  const [groups, setGroups] = useState<string[]>(DEFAULT_USER_GROUPS)
  const [groupFilter, setGroupFilter] = useState<string>('all')
  const [groupEditOpen, setGroupEditOpen] = useState(false)
  const [newGroupName, setNewGroupName] = useState('')
  const [editingGroup, setEditingGroup] = useState<string | null>(null)
  const [editingGroupName, setEditingGroupName] = useState('')
  const [selectMode, setSelectMode] = useState(false)
  const [cartApprovalMode, setCartApprovalMode] = useState(false)
  const [checkedIds, setCheckedIds] = useState<Set<number>>(new Set())
  const [bulkGroup, setBulkGroup] = useState<string>('')

  const isAdminLike = currentUser?.role === 'admin' || currentUser?.role === 'developer'

  useEffect(() => {
    if (isAdminLike) void fetchAllUsers()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdminLike, currentUser?.role])

  // 집단 목록 로드 (서버 공유 — 관리자가 바꾸면 모두에게 반영)
  useEffect(() => {
    if (!isAdminLike) return
    void supabase.from('app_settings').select('value').eq('key', USER_GROUPS_SETTING_KEY).maybeSingle()
      .then(({ data }) => setGroups(parseUserGroups(data?.value)))
  }, [isAdminLike])

  // 집단 이름 변경 — 목록과 소속 사용자의 group_name 을 함께 갱신
  const commitGroupRename = async () => {
    const from = editingGroup
    const to = editingGroupName.trim()
    if (!from) return
    if (!to || to === from) { setEditingGroup(null); setEditingGroupName(''); return }
    if (groups.includes(to)) { showToast(msg('같은 이름의 집단이 이미 있습니다.'), 'error'); return }

    const ok = await renameUserGroup(from, to)
    if (!ok) return
    await saveGroups(groups.map((g) => (g === from ? to : g)))
    if (groupFilter === from) setGroupFilter(to)
    setEditingGroup(null)
    setEditingGroupName('')
    showToast(msg('\'{from}\' → \'{to}\' 로 변경했습니다.', { from: from, to: to }), 'success')
  }

  const saveGroups = async (next: string[]) => {
    const serialized = serializeUserGroups(next)
    setGroups(parseUserGroups(serialized))
    const { error } = await supabase.from('app_settings').upsert({ key: USER_GROUPS_SETTING_KEY, value: serialized }, { onConflict: 'key' })
    if (error) showToast(msg('집단 목록 저장에 실패했습니다.'), 'error')
  }

  const users = useMemo(() => {
    return allUsers
      .filter((item) => currentUser?.role === 'developer' || item.role !== 'developer')
      .filter((item) => (item.approvalStatus ?? 'approved') === 'approved')
      .sort((a, b) => {
        const byRole = roleOrder[a.role] - roleOrder[b.role]
        if (byRole !== 0) return byRole
        return a.name.localeCompare(b.name, 'ko')
      })
  }, [allUsers, currentUser?.role])

  const filteredUsers = useMemo(() => {
    const query = search.trim().toLowerCase()
    return users.filter((item) => {
      const matchesRole = roleFilter === 'all' || item.role === roleFilter
      const matchesGroup =
        groupFilter === 'all' ||
        (groupFilter === '__none__' ? !item.groupName : item.groupName === groupFilter)
      const matchesSearch =
        !query ||
        item.name.toLowerCase().includes(query) ||
        item.loginId.toLowerCase().includes(query)
      return matchesRole && matchesGroup && matchesSearch
    })
  }, [roleFilter, groupFilter, search, users])

  // 집단별 인원수 (미지정 포함)
  const groupCounts = useMemo(() => {
    const m = new Map<string, number>()
    for (const u of users) m.set(u.groupName || '__none__', (m.get(u.groupName || '__none__') ?? 0) + 1)
    return m
  }, [users])

  const toggleChecked = (id: number) => {
    setCheckedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const applyBulkGroup = async () => {
    if (checkedIds.size === 0) return
    const target = bulkGroup === '__none__' ? null : bulkGroup
    if (!target && bulkGroup !== '__none__') { showToast(msg('지정할 집단을 선택해 주세요'), 'error'); return }
    const ok = await updateUsersGroup([...checkedIds], target)
    if (ok) { setCheckedIds(new Set()); setSelectMode(false); setBulkGroup('') }
  }

  const selectedUser = users.find((item) => item.id === selectedUserId) ?? null

  // 사용자 상세에서 OS·스와이프 뒤로가기를 가로채 **목록으로만** 돌아간다.
  // 등록하지 않으면 바깥 층(설정)의 핸들러가 실행돼 설정까지 나가 버린다.
  useEffect(() => {
    if (selectedUserId == null) return
    return pushBackHandler(() => setSelectedUserId(null))
  }, [selectedUserId])
  const adminCount = users.filter((item) => item.role === 'admin' || item.role === 'developer').length

  useEffect(() => {
    if (!selectedUser) return
    setEditLoginId(selectedUser.loginId)
    setEditName(selectedUser.name)
    setEditPin('')
    setLoginLogsExpanded(false)
  }, [selectedUser])

  useEffect(() => {
    let cancelled = false
    const loadLogs = async () => {
      if (!selectedUser || currentUser?.role !== 'developer') {
        setLoginLogs([])
        return
      }
      setLoadingLoginLogs(true)
      try {
        const logs = await fetchUserLoginLogs(selectedUser.id, 30)
        if (!cancelled) setLoginLogs(logs)
      } finally {
        if (!cancelled) setLoadingLoginLogs(false)
      }
    }
    void loadLogs()
    return () => {
      cancelled = true
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.role, selectedUser?.id])

  const resetAddForm = () => {
    setNewLoginId('')
    setNewName('')
    setNewPin('')
    setNewRole('user')
  }

  if (!isAdminLike) {
    return (
      <div className="mobile-users-page">
        {!isEmbedded && (
          <AppHeader
            pageTitle={msg('사용자 관리')}
            showBack
            onBack={() => navigate('/settings')}
            userId={currentUser?.id}
            userName={currentUser?.name}
            onOpenMenu={() => navigate('/settings')}
          />
        )}
        <section className="mobile-users-empty">{msg('관리자만 사용할 수 있습니다.')}</section>
      </div>
    )
  }

  if (selectedUser) {
    const canDelete = currentUser?.id !== selectedUser.id
    const visibleLoginLogs = loginLogsExpanded ? loginLogs : loginLogs.slice(0, 3)
    return (
      <div className="mobile-users-page">
        {!isEmbedded && (
          <AppHeader
            pageTitle={msg('사용자 편집')}
            subtitle={`${displayRole(selectedUser.role)} · ${formatLastLogin(selectedUser.lastLoginAt)}`}
            showBack
            onBack={() => setSelectedUserId(null)}
            userId={currentUser?.id}
            userName={currentUser?.name}
            onOpenMenu={() => navigate('/settings')}
          />
        )}
        {isEmbedded && (
          <div style={{ marginBottom: 16 }}>
            <button className="ds-btn ds-btn-secondary" onClick={() => setSelectedUserId(null)} type="button">
              {msg('뒤로')}
            </button>
          </div>
        )}

        <section className="mobile-user-detail-card">
          <div className={`mobile-user-avatar ${roleClass(selectedUser.role)}`}>
            {selectedUser.name.slice(0, 1)}
          </div>
          <div>
            <strong>{selectedUser.name}</strong>
            <span>{selectedUser.loginId}</span>
          </div>
          <span className={`mobile-user-role-badge ${roleClass(selectedUser.role)}`}>
            {displayRole(selectedUser.role)}
          </span>
        </section>

        <section className="mobile-user-manage-card mobile-user-account-card">
          <h2>{msg('계정 관리')}</h2>
          <label>
            <span>{msg('아이디')}</span>
            <input value={editLoginId} onChange={(event) => setEditLoginId(event.target.value)} />
          </label>
          <label>
            <span>{msg('닉네임')}</span>
            <input value={editName} onChange={(event) => setEditName(event.target.value)} />
          </label>
          <button
            disabled={!editLoginId.trim() || !editName.trim()}
            onClick={async () => {
              const ok = await updateUserIdentity(selectedUser.id, editLoginId, editName)
              if (ok) setSelectedUserId(selectedUser.id)
            }}
            type="button"
          >
            {msg('아이디 · 닉네임 저장')}
          </button>
        </section>

        {currentUser?.role === 'developer' && (
          <section className="mobile-user-manage-card mobile-user-login-card">
            <div className="mobile-user-login-head">
              <h2>{msg('로그인 기록')}</h2>
              <span>{loginLogsExpanded ? `${loginLogs.length}건` : `최근 ${Math.min(loginLogs.length, 3)}건`}</span>
            </div>
            {loadingLoginLogs ? (
              <p className="mobile-login-empty">{msg('로그인 기록을 불러오는 중입니다.')}</p>
            ) : loginLogs.length === 0 ? (
              <p className="mobile-login-empty">{msg('아직 로그인 기록이 없습니다.')}</p>
            ) : (
              <div className={`mobile-login-list${loginLogsExpanded ? ' is-expanded' : ''}`}>
                {visibleLoginLogs.map((log) => (
                  <div className="mobile-login-row" key={log.id}>
                    <span>{msg('로그인')}</span>
                    <strong>{formatLoginDateTime(log.logged_in_at)}</strong>
                  </div>
                ))}
                {loginLogs.length > 3 && (
                  <button
                    className="mobile-login-toggle"
                    onClick={() => setLoginLogsExpanded((value) => !value)}
                    type="button"
                  >
                    {loginLogsExpanded ? msg('접기') : `더 보기 ${loginLogs.length - 3}건`}
                  </button>
                )}
              </div>
            )}
          </section>
        )}

        <section className="mobile-user-manage-card">
          <h2>{msg('집단')}</h2>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
            {groups.map((g) => {
              const on = selectedUser.groupName === g
              return (
                <button
                  key={g}
                  onClick={() => void updateUsersGroup([selectedUser.id], on ? null : g)}
                  type="button"
                  style={{ minHeight: 0, padding: '8px 14px', borderRadius: 999, fontSize: 13.5, fontWeight: on ? 700 : 500, cursor: 'pointer',
                    border: on ? '1.5px solid var(--ink)' : '1px solid var(--line)',
                    background: on ? 'var(--ink)' : 'var(--surface)', color: on ? '#fff' : 'var(--ink)' }}
                >
                  {on ? '✓ ' : ''}{g}
                </button>
              )
            })}
            <button
              onClick={() => void updateUsersGroup([selectedUser.id], null)}
              type="button"
              style={{ minHeight: 0, padding: '8px 14px', borderRadius: 999, fontSize: 13.5, fontWeight: !selectedUser.groupName ? 700 : 500, cursor: 'pointer',
                border: !selectedUser.groupName ? '1.5px solid var(--ink)' : '1px solid var(--line)',
                background: !selectedUser.groupName ? 'var(--ink)' : 'var(--surface)', color: !selectedUser.groupName ? '#fff' : 'var(--muted)' }}
            >
              {!selectedUser.groupName ? '✓ ' : ''}미지정
            </button>
          </div>
          <p style={{ margin: 0, fontSize: 12, color: 'var(--muted)' }}>{msg('한 사용자는 하나의 집단에만 속합니다.')}</p>
        </section>

        <section className="mobile-user-manage-card mobile-user-role-card">
          <h2>{msg('사용자 권한')}</h2>
          <div className="mobile-user-role-select">
            {(['admin', 'leader', 'user'] as Role[]).map((role) => (
              <button
                key={role}
                className={selectedUser.role === role ? 'active' : ''}
                onClick={() => updateUserRole(selectedUser.id, role)}
                type="button"
              >
                {displayRole(role)}
              </button>
            ))}
          </div>
          <p>{msg('관리자는 인도자와 봉사자 권한을 포함합니다.')}</p>
        </section>

        {CART_APPLICATIONS_ENABLED && <section className="mobile-user-manage-card mobile-user-cart-card">
          <div className="mobile-user-setting-row">
            <div>
              <h2>{msg('전시대 봉사')}</h2>
              <p>{msg('승인된 사용자만 전시대 봉사에 신청할 수 있습니다.')}</p>
            </div>
            <button
              aria-pressed={selectedUser.cartServiceApproved === true}
              className={`mobile-user-compact-toggle${selectedUser.cartServiceApproved ? ' active' : ''}`}
              onClick={() => void updateCartServiceApproval(selectedUser.id, !selectedUser.cartServiceApproved)}
              type="button"
            >
              {selectedUser.cartServiceApproved ? msg('승인됨') : msg('미승인')}
            </button>
          </div>
        </section>}

        <section className="mobile-user-manage-card mobile-user-password-card">
          <h2>{msg('비밀번호')}</h2>
          <button onClick={() => resetUserPin(selectedUser.id)} type="button">
            {msg('0000으로 초기화')}
          </button>
          <div className="mobile-user-inline-form">
            <input
              placeholder={msg('새 비밀번호')}
              value={editPin}
              onChange={(event) => setEditPin(event.target.value)}
            />
            <button
              disabled={!editPin.trim()}
              onClick={async () => {
                const ok = await resetUserPin(selectedUser.id, editPin)
                if (ok) setEditPin('')
              }}
              type="button"
            >
              {msg('변경')}
            </button>
          </div>
        </section>

        <section className="mobile-user-danger-card">
          <div>
            <strong>{msg('사용자 제거')}</strong>
            <span>{msg('로그인 계정만 삭제하고 방문 기록은 보존합니다.')}</span>
          </div>
          <button
            disabled={!canDelete}
            onClick={async () => {
              if (!(await confirmDialog({ message: msg('{name} 사용자를 제거할까요?', { name: selectedUser.name }), danger: true, confirmLabel: msg('제거') }))) return
              const ok = await deleteUser(selectedUser.id)
              if (ok) setSelectedUserId(null)
            }}
            type="button"
          >
            {msg('제거')}
          </button>
        </section>
      </div>
    )
  }

  return (
    <div className="mobile-users-page">
      {!isEmbedded && (
        <AppHeader
          pageTitle={msg('사용자 관리')}
          subtitle={`회중 ${users.length}명 · 관리자 ${adminCount}`}
          showBack
          onBack={() => navigate('/settings')}
          userId={currentUser?.id}
          userName={currentUser?.name}
          onOpenMenu={() => navigate('/settings')}
        />
      )}
      {isEmbedded && (
        <div style={{ padding: '0 4px 16px' }}>
          <h2 style={{ fontSize: 22, fontWeight: 800, color: 'var(--gray-900)' }}>{msg('사용자 관리')}</h2>
          <p style={{ color: 'var(--gray-500)', fontSize: 13, marginTop: 4 }}>회중 {users.length}명 · 관리자 {adminCount}</p>
        </div>
      )}

      <section className="mobile-users-toolbar">
        <div className="mobile-users-search-row">
          <label className="mobile-users-search-box">
            <span aria-hidden="true">⌕</span>
            <input
              aria-label={msg('사용자 이름 검색')}
              placeholder={msg('이름 검색')}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <label className="mobile-users-filter-box">
            <select
              aria-label={msg('권한 필터')}
              value={roleFilter}
              onChange={(event) => setRoleFilter(event.target.value as UserFilter)}
            >
              <option value="all">{msg('전체')}</option>
              <option value="admin">{msg('관리자')}</option>
              <option value="leader">{msg('인도자')}</option>
              <option value="user">{msg('봉사자')}</option>
            </select>
          </label>
          <label className="mobile-users-filter-box">
            <select
              aria-label={msg('집단 필터')}
              value={groupFilter}
              onChange={(event) => setGroupFilter(event.target.value)}
            >
              <option value="all">{msg('집단 전체')}</option>
              {groups.map((g) => (
                <option key={g} value={g}>{g} ({groupCounts.get(g) ?? 0})</option>
              ))}
              <option value="__none__">미지정 ({groupCounts.get('__none__') ?? 0})</option>
            </select>
          </label>
        </div>
        <div className="mobile-users-command-row">
          <button
            className="mobile-users-add-toggle"
            onClick={() => {
              setCartApprovalMode(false)
              setShowAddForm((value) => !value)
            }}
            type="button"
          >
            <span aria-hidden="true">＋</span>{msg('사용자 추가')}
          </button>
          <button
            className="mobile-users-add-toggle"
            onClick={() => { setSelectMode((v) => !v); setCartApprovalMode(false); setCheckedIds(new Set()) }}
            type="button"
          >
            {selectMode ? msg('선택 취소') : msg('선택')}
          </button>
          <details className="mobile-users-more-menu">
            <summary aria-label={msg('사용자 관리 더보기')} title={msg('사용자 관리 더보기')}>•••</summary>
            <div className="mobile-users-more-popover">
              <button
                onClick={(event) => {
                  setGroupEditOpen((value) => !value)
                  event.currentTarget.closest('details')?.removeAttribute('open')
                }}
                type="button"
              >
                {msg('집단 편집')}
              </button>
            </div>
          </details>
        </div>
      </section>

      {/* 집단 이름 편집 */}
      {groupEditOpen && (
        <section className="mobile-user-manage-card">
          <h2>{msg('집단 관리')}</h2>
          <p style={{ fontSize: 12.5, color: 'var(--muted)', margin: '0 0 10px' }}>
            {msg('집단 이름을 누르면 수정할 수 있고, ×로 삭제합니다. 이름을 바꾸면 소속된 사용자도 함께 옮겨집니다. 삭제해도 사용자 정보는 유지되며 해당 집단은 미지정으로 표시됩니다.')}
          </p>
          {groups.length === 0 && (
            <p style={{ fontSize: 13, color: 'var(--muted)', margin: '0 0 10px' }}>
              {msg('아직 집단이 없습니다. 아래에 이름을 넣어 만드세요. 집단을 쓰지 않는다면 비워 둬도 됩니다.')}
            </p>
          )}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
            {groups.map((g) => (
              editingGroup === g ? (
                <span key={g} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <input
                    aria-label={`${g} 이름 변경`}
                    value={editingGroupName}
                    autoFocus
                    onChange={(e) => setEditingGroupName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') void commitGroupRename() }}
                    style={{ width: 110, padding: '6px 10px', border: '1px solid var(--ink)', borderRadius: 999, fontSize: 13, background: 'var(--surface)', color: 'var(--ink)' }}
                  />
                  <button
                    onClick={() => void commitGroupRename()}
                    style={{ minHeight: 0, padding: '6px 10px', borderRadius: 999, border: 'none', background: 'var(--ink)', color: '#fff', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}
                    type="button"
                  >{msg('저장')}</button>
                  <button
                    onClick={() => { setEditingGroup(null); setEditingGroupName('') }}
                    style={{ minHeight: 0, padding: '6px 8px', borderRadius: 999, border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--muted)', fontSize: 12.5, cursor: 'pointer' }}
                    type="button"
                  >{msg('취소')}</button>
                </span>
              ) : (
                <span key={g} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderRadius: 999, border: '1px solid var(--line)', background: 'var(--surface)', fontSize: 13 }}>
                  <button
                    aria-label={`${g} 이름 변경`}
                    title={msg('이름 변경')}
                    onClick={() => { setEditingGroup(g); setEditingGroupName(g) }}
                    style={{ minHeight: 0, border: 'none', background: 'transparent', color: 'var(--ink)', cursor: 'pointer', padding: 0, fontSize: 13, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 4 }}
                    type="button"
                  >
                    {g}
                    {/* 이름을 눌러 수정할 수 있음을 알리는 연필 아이콘 */}
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
                    </svg>
                  </button>
                  <button
                    aria-label={`${g} 삭제`}
                    onClick={async () => {
                      if (await confirmDialog({ message: msg('\'{g}\' 집단을 목록에서 삭제할까요?', { g: g }), danger: true, confirmLabel: msg('삭제') })) {
                        void saveGroups(groups.filter((x) => x !== g))
                      }
                    }}
                    style={{ minHeight: 0, border: 'none', background: 'transparent', color: 'var(--muted)', cursor: 'pointer', padding: 0, fontSize: 14 }}
                    type="button"
                  >×</button>
                </span>
              )
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              aria-label={msg('새 집단 이름')}
              placeholder={msg('새 집단 이름')}
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              style={{ flex: 1, minWidth: 0, padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 13, background: 'var(--surface)', color: 'var(--ink)' }}
            />
            <button
              disabled={!newGroupName.trim()}
              onClick={() => { void saveGroups([...groups, newGroupName]); setNewGroupName('') }}
              type="button"
              style={{ minHeight: 0, padding: '8px 14px', borderRadius: 8, border: 'none', background: 'var(--ink)', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
            >{msg('추가')}</button>
          </div>
        </section>
      )}

      {/* 선택 모드: 일괄 집단 지정 바 */}
      {selectMode && (
        <section className="mobile-users-selection-bar">
          <strong>{checkedIds.size}명 {msg('선택')}</strong>
          <select
            aria-label={msg('지정할 집단')}
            value={bulkGroup}
            onChange={(e) => setBulkGroup(e.target.value)}
          >
            <option value="">{msg('집단 선택…')}</option>
            {groups.map((g) => <option key={g} value={g}>{g}</option>)}
            <option value="__none__">{msg('미지정으로 해제')}</option>
          </select>
          <button
            disabled={checkedIds.size === 0 || !bulkGroup}
            onClick={() => void applyBulkGroup()}
            type="button"
          >{msg('집단 지정')}</button>
          <button
            className="mobile-users-selection-cancel"
            onClick={() => { setSelectMode(false); setCheckedIds(new Set()) }}
            type="button"
          >{msg('취소')}</button>
        </section>
      )}

      {showAddForm && (
        <section className="mobile-user-manage-card mobile-users-add-card">
          <h2>{msg('사용자 추가')}</h2>
          <label>
            <span>{msg('아이디')}</span>
            <input value={newLoginId} onChange={(event) => setNewLoginId(event.target.value)} />
          </label>
          <label>
            <span>{msg('닉네임')}</span>
            <input value={newName} onChange={(event) => setNewName(event.target.value)} />
          </label>
          <label>
            <span>{msg('초기 비밀번호')}</span>
            <input value={newPin} onChange={(event) => setNewPin(event.target.value)} />
          </label>
          <label>
            <span>{msg('권한')}</span>
            <select value={newRole} onChange={(event) => setNewRole(event.target.value as Role)}>
              <option value="user">{msg('봉사자')}</option>
              <option value="leader">{msg('인도자')}</option>
              <option value="admin">{msg('관리자')}</option>
            </select>
          </label>
          <div className="mobile-users-add-actions">
            <button
              onClick={() => {
                resetAddForm()
                setShowAddForm(false)
              }}
              type="button"
            >
              {msg('취소')}
            </button>
            <button
              disabled={!newLoginId.trim() || !newName.trim() || !newPin.trim()}
              onClick={async () => {
                const ok = await createUser(newLoginId, newName, newPin, newRole)
                if (ok) {
                  resetAddForm()
                  setShowAddForm(false)
                }
              }}
              type="button"
            >
              {msg('추가')}
            </button>
          </div>
        </section>
      )}

      <section className="mobile-users-list" aria-label={msg('사용자 목록')}>
        <div className="mobile-users-list-head">
          <div className="mobile-users-view-tabs" role="tablist" aria-label={msg('사용자 관리')}>
            <button
              aria-selected={!cartApprovalMode}
              className={!cartApprovalMode ? 'active' : ''}
              onClick={() => { setCartApprovalMode(false); setSelectMode(false); setCheckedIds(new Set()) }}
              role="tab"
              type="button"
            >
              {msg('사용자 목록')}
            </button>
            {CART_APPLICATIONS_ENABLED && (
              <button
                aria-selected={cartApprovalMode}
                className={cartApprovalMode ? 'active' : ''}
                onClick={() => { setCartApprovalMode(true); setSelectMode(false); setCheckedIds(new Set()); setSelectedUserId(null) }}
                role="tab"
                type="button"
              >
                {msg('전시대 승인')}
              </button>
            )}
          </div>
          <span>{filteredUsers.length}명</span>
        </div>
        {filteredUsers.length === 0 ? (
          <div className="mobile-users-empty">{msg('검색 결과가 없습니다.')}</div>
        ) : (
          filteredUsers.map((item) => (
            <div
              className={`mobile-users-list-card${cartApprovalMode ? ' is-cart-approval' : ''}`}
              key={item.id}
              onClick={() => (selectMode ? toggleChecked(item.id) : cartApprovalMode ? undefined : setSelectedUserId(item.id))}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return
                event.preventDefault()
                if (selectMode) toggleChecked(item.id)
                else if (!cartApprovalMode) setSelectedUserId(item.id)
              }}
              role={cartApprovalMode ? undefined : 'button'}
              tabIndex={cartApprovalMode ? undefined : 0}
            >
              {selectMode ? (
                <input
                  type="checkbox"
                  checked={checkedIds.has(item.id)}
                  onChange={() => toggleChecked(item.id)}
                  onClick={(e) => e.stopPropagation()}
                  style={{ width: 17, height: 17, accentColor: 'var(--ink)', flexShrink: 0 }}
                />
              ) : (
                <span className={`mobile-user-avatar ${roleClass(item.role)}`}>{item.name.slice(0, 1)}</span>
              )}
              <span className="mobile-users-row-main">
                <strong>{item.name}{currentUser?.id === item.id ? <small> ({msg('나')})</small> : null}</strong>
                <small>
                  {cartApprovalMode ? `${displayRole(item.role)} · ` : ''}{item.loginId} · {formatLastLogin(item.lastLoginAt)}
                  {item.groupName ? ` · ${item.groupName}` : ''}
                </small>
              </span>
              {!cartApprovalMode && (
                <span className={`mobile-user-role-badge ${roleClass(item.role)}`}>
                  {displayRole(item.role)}
                </span>
              )}
              {CART_APPLICATIONS_ENABLED && cartApprovalMode ? (
                <button
                  aria-label={`${item.name} ${msg('전시대 승인')}`}
                  aria-pressed={item.cartServiceApproved === true}
                  className={`mobile-user-compact-toggle${item.cartServiceApproved ? ' active' : ''}`}
                  onClick={(event) => {
                    event.stopPropagation()
                    void updateCartServiceApproval(item.id, !item.cartServiceApproved)
                  }}
                  type="button"
                >
                  <span className="mobile-user-approval-switch" aria-hidden="true"><i /></span>
                  <span>{item.cartServiceApproved ? msg('승인됨') : msg('미승인')}</span>
                </button>
              ) : !selectMode && <span className="mobile-users-chevron" aria-hidden="true">›</span>}
            </div>
          ))
        )}
      </section>
    </div>
  )
}
