import { supabase } from './supabase'
import { getAuthToken } from './authToken'
import { mergeCardBoundaryPoints } from '../utils/boundaryMerge'
import type { CardBoundary, GeoPoint } from '../types'
import type { ChineseTerritoryReportSnapshot, TerritoryReportRegionBoundary, TerritoryReportShare } from '../types/territoryReport'

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

const toPoints = (value: unknown): GeoPoint[] => Array.isArray(value)
  ? value.flatMap((point) => {
      if (!point || typeof point !== 'object') return []
      const lat = Number((point as { lat?: unknown }).lat)
      const lng = Number((point as { lng?: unknown }).lng)
      return Number.isFinite(lat) && Number.isFinite(lng) ? [{ lat, lng }] : []
    })
  : []

let regionBoundariesPromise: Promise<TerritoryReportRegionBoundary[]> | null = null

async function loadReportRegionBoundaries() {
  if (regionBoundariesPromise) return regionBoundariesPromise
  regionBoundariesPromise = (async () => {
    const [cardsResult, boundariesResult] = await Promise.all([
      supabase.from('cards').select('id, region'),
      supabase.from('card_boundaries').select('card_id, points'),
    ])
    if (cardsResult.error || boundariesResult.error) return []
    const regionByCard = new Map((cardsResult.data ?? []).map(card => [card.id, card.region || '미분류']))
    const grouped = new Map<string, CardBoundary[]>()
    for (const row of boundariesResult.data ?? []) {
      const region = regionByCard.get(row.card_id)
      const points = toPoints(row.points)
      if (!region || points.length < 3) continue
      const list = grouped.get(region) ?? []
      list.push({ cardId: row.card_id, points })
      grouped.set(region, list)
    }
    return Array.from(grouped, ([region, boundaries]) => {
      const merged = mergeCardBoundaryPoints(boundaries)
      return merged ? {
        region,
        points: merged.points.map(point => ({
          lat: Number(point.lat.toFixed(5)),
          lng: Number(point.lng.toFixed(5)),
        })),
      } : null
    }).filter((row): row is TerritoryReportRegionBoundary => row !== null)
  })()
  return regionBoundariesPromise
}

async function reportPresentation(includeAreaDetails: boolean) {
  return {
    p_include_area_details: includeAreaDetails,
    p_region_boundaries: await loadReportRegionBoundaries(),
  }
}

export async function previewChineseTerritoryReport(start: string, end: string, note: string, includeAreaDetails = false) {
  return rpc<ChineseTerritoryReportSnapshot>('preview_chinese_territory_report_v2_tx', {
    p_token: requireToken(), p_period_start: start, p_period_end: end, p_note: note,
    ...await reportPresentation(includeAreaDetails),
  })
}

export function createChineseTerritoryReportShare(input: {
  start: string
  end: string
  note: string
  expiresAt: string
  pin?: string
  includeAreaDetails?: boolean
}) {
  return reportPresentation(Boolean(input.includeAreaDetails)).then(presentation => rpc<{ ok: true; id: string; shareToken: string; expiresAt: string; pinRequired: boolean }>(
    'create_chinese_territory_report_share_v2_tx',
    {
      p_token: requireToken(), p_period_start: input.start, p_period_end: input.end,
      p_expires_at: input.expiresAt, p_pin: input.pin || null, p_note: input.note,
      ...presentation,
    },
  ))
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
