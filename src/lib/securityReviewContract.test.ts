import { describe, expect, test } from 'vitest'
import { readFileSync } from 'node:fs'

const followup = readFileSync('supabase/migrations/20260907_1500_review_followups.sql', 'utf8')
const users = readFileSync('supabase/migrations/20260907_1510_finalize_app_user_policies.sql', 'utf8')

describe('권한 역리뷰 후속 계약', () => {
  test('재방문 기록은 ID 소유권과 무효 처리를 사용하고 직접 DELETE 정책이 없다', () => {
    expect(followup).toContain('created_by_user_id integer references public.app_users')
    expect(followup).toContain('invalidate_return_visit_log_tx')
    expect(followup).not.toContain('create policy role_owner_return_visit_logs_delete')
  })

  test('연결 자료가 있는 장소는 역할과 무관하게 삭제 요청으로 전환한다', () => {
    expect(followup).toContain("if v_actor_role='user' or v_has_links then")
    expect(followup).toContain("if v_reason is null then raise exception '삭제 사유를 입력해 주세요'")
  })

  test('일반 사용자는 출입불가를 해제하거나 배정 참가를 취소하지 못한다', () => {
    expect(followup).toContain("if not p_blocked and not coalesce(v_actor_role in ('leader','admin','developer'),false)")
    expect(followup).toContain("role='신청' and user_name")
  })

  test('사용자 제거는 비활성화 RPC이고 본인 변경 칸은 제한된다', () => {
    expect(users).toContain('deactivate_app_user_tx')
    expect(users).toContain("new.login_id is distinct from old.login_id")
    expect(users).toContain("new.last_login_at is distinct from old.last_login_at")
  })
})
