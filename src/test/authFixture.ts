import { vi } from 'vitest'
import type { SharedAuth } from '../hooks/AuthContext'

export function authFixture(overrides: Partial<SharedAuth> = {}): SharedAuth {
  return {
    user: { id: 1, name: 'Admin', loginId: 'admin', role: 'admin', authToken: 'test-token' },
    loading: false,
    loginRetryHintFor: null,
    allUsers: [],
    login: vi.fn(async () => false),
    signup: vi.fn(async () => false),
    logout: vi.fn(),
    changePin: vi.fn(async () => false),
    updateMyProfile: vi.fn(async () => false),
    fetchAllUsers: vi.fn(async () => {}),
    ensureAllUsersFresh: vi.fn(async () => {}),
    resetUserPin: vi.fn(async () => false),
    updateUserRole: vi.fn(async () => false),
    updateUsersGroup: vi.fn(async () => false),
    renameUserGroup: vi.fn(async () => false),
    deleteUser: vi.fn(async () => false),
    createUser: vi.fn(async () => false),
    updateUserIdentity: vi.fn(async () => false),
    updateUserApprovalStatus: vi.fn(async () => false),
    updateCartServiceApproval: vi.fn(async () => false),
    fetchMyLoginLogs: vi.fn(async () => []),
    fetchUserLoginLogs: vi.fn(async () => []),
    ...overrides,
  }
}
