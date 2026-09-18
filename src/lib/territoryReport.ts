import { supabase } from './supabase'
import { getAuthToken } from './authToken'
import type { ChineseTerritoryReportSnapshot, TerritoryReportShare } from '../types/territoryReport'

function requireToken() {
  const token = getAuthToken()
  if (!token) throw new Error('로그인이 필요합니다.')
  return token
}

async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const result = await supabase.rpc(name as never, args as never)
  if (result.error) throw result.error
  return result.data as T
}

export function previewChineseTerritoryReport(start: string, end: string, note: string) {
  return rpc<ChineseTerritoryReportSnapshot>('preview_chinese_territory_report_tx', {
    p_token: requireToken(), p_period_start: start, p_period_end: end, p_note: note,
  })
}

export function createChineseTerritoryReportShare(input: {
  start: string
  end: string
  note: string
  expiresAt: string
  pin?: string
}) {
  return rpc<{ ok: true; id: string; shareToken: string; expiresAt: string; pinRequired: boolean }>(
    'create_chinese_territory_report_share_tx',
    {
      p_token: requireToken(), p_period_start: input.start, p_period_end: input.end,
      p_expires_at: input.expiresAt, p_pin: input.pin || null, p_note: input.note,
    },
  )
}

export function listChineseTerritoryReportShares() {
  return rpc<TerritoryReportShare[]>('list_chinese_territory_report_shares_tx', { p_token: requireToken() })
}

export function revokeChineseTerritoryReportShare(id: string) {
  return rpc<boolean>('revoke_chinese_territory_report_share_tx', {
    p_token: requireToken(), p_share_id: id,
  })
}

export function getSharedChineseTerritoryReport(shareToken: string, pin?: string) {
  return rpc<{
    ok: boolean
    code?: 'unavailable' | 'pin_required' | 'invalid_pin' | 'locked'
    lockedUntil?: string
    snapshot?: ChineseTerritoryReportSnapshot
    expiresAt?: string
  }>('get_chinese_territory_report_share', { p_share_token: shareToken, p_pin: pin || null })
}
