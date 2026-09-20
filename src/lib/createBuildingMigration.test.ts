import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  'supabase/migrations/20260920_1200_create_building_tx.sql',
  'utf8',
)

describe('건물 등록 RPC 마이그레이션 계약', () => {
  it('식당 등록과 같은 주소 및 거리 판정을 실제로 호출한다', () => {
    expect(migration).toContain('private.restaurant_address_key(v_address)')
    expect(migration).toContain('private.same_building_location(b.address, b.lat, b.lng, v_address, p_lat, p_lng)')
    expect(migration).toContain("coalesce(p_lat, 0) <> 0 or coalesce(p_lng, 0) <> 0")
    expect(migration).toContain('pg_advisory_xact_lock(hashtextextended(v_address_key, 9051700))')
  })

  it('후보 하나는 재사용하고 여러 개는 사용자가 고르도록 생성하지 않는다', () => {
    expect(migration).toContain("'action', 'existing'")
    expect(migration).toContain("'action', 'ambiguous'")
    expect(migration).toContain('candidate_ids')
  })

  it('승인된 활성 사용자를 서버에서 확인한다', () => {
    expect(migration).toContain("approval_status = 'approved'")
    expect(migration).toContain('is_active = true')
  })

  it('definer 함수의 실행권한과 search_path를 잠근다', () => {
    expect(migration).toContain("set search_path = ''")
    expect(migration).toContain('revoke all on function public.create_building_tx')
    expect(migration).toContain('grant execute on function public.create_building_tx')
  })

  it('트리거나 유니크 인덱스로 복원 경로를 막지 않는다', () => {
    expect(migration).not.toMatch(/create\s+(?:unique\s+)?index/i)
    expect(migration).not.toMatch(/create\s+trigger/i)
  })
})
