import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  'supabase/migrations/20260920_1100_duplicate_building_candidate_key.sql',
  'utf8',
)

describe('중복 건물 후보 병합 마이그레이션 계약', () => {
  it('구버전 자동 병합의 정확 주소 키를 바꾸지 않는다', () => {
    expect(migration).not.toContain('create or replace function public.normalize_building_address')
  })

  it('식당 등록 주소 키를 재사용하고 선택한 기준 건물만 처리한다', () => {
    expect(migration).toContain('private.restaurant_address_key(b.address)')
    expect(migration).toContain('b.id = any(p_selected_primary_ids)')
    expect(migration).toContain('array[v_primary.id]')
  })

  it('담당 충돌로 보류되면 후보 주소를 원래 값으로 복구한다', () => {
    expect(migration).toContain('jsonb_to_recordset(v_original_buildings)')
    expect(migration).toContain('set address = original.address')
  })

  it('화면에서 고른 원본 주소만 남길 수 있고 후보 밖 주소는 거부한다', () => {
    expect(migration).toContain('p_address_overrides jsonb')
    expect(migration).toContain('and b.address = v_selected_address')
    expect(migration).toContain('set address = v_selected_address')
  })

  it('새 security definer 함수는 빈 search_path를 쓴다', () => {
    expect(migration).toContain("set search_path = ''")
  })
})
