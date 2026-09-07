-- 사용자 행은 본인/관리자 범위로 쓰되, 본인은 이름·전화·PIN만 바꿀 수 있다.
-- 관리자 화면의 사용자 제거는 물리 DELETE가 아니라 비활성화 RPC로 처리한다.

create or replace function public.guard_app_user_privilege_change()
returns trigger
language plpgsql security invoker
set search_path = ''
as $$
begin
  if current_user in ('postgres','supabase_admin','service_role') then return new; end if;
  if (select public.session_is_admin()) then return new; end if;

  if new.id is distinct from old.id
     or new.created_at is distinct from old.created_at
     or new.last_login_at is distinct from old.last_login_at
     or new.login_id is distinct from old.login_id
     or new.group_name is distinct from old.group_name
     or new.role is distinct from old.role
     or new.approval_status is distinct from old.approval_status
     or new.is_active is distinct from old.is_active then
    raise exception '본인은 이름·전화번호·비밀번호만 바꿀 수 있습니다' using errcode='42501';
  end if;
  return new;
end;
$$;

create or replace function public.deactivate_app_user_tx(
  p_token uuid, p_user_id integer, p_reason text
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_actor_id integer; v_actor_name text; v_actor_role text;
  v_target public.app_users%rowtype; v_reason text:=nullif(btrim(coalesce(p_reason,'')),'');
  v_purge jsonb;
begin
  v_actor_id:=public.verify_session(p_token);
  select name,role into v_actor_name,v_actor_role from public.app_users where id=v_actor_id;
  if not coalesce(v_actor_role in ('admin','developer'),false) then
    raise exception '관리자만 사용자를 제거할 수 있습니다' using errcode='42501';
  end if;
  if p_user_id=v_actor_id then raise exception '현재 로그인한 계정은 제거할 수 없습니다' using errcode='22023'; end if;
  if v_reason is null then raise exception '사용자 제거 사유를 입력해 주세요' using errcode='22023'; end if;
  select * into v_target from public.app_users where id=p_user_id for update;
  if not found then raise exception '사용자를 찾을 수 없습니다'; end if;
  if v_target.role='developer' and v_actor_role<>'developer' then
    raise exception '개발자 계정은 개발자만 제거할 수 있습니다' using errcode='42501';
  end if;
  if not v_target.is_active then
    return jsonb_build_object('ok',true,'already_inactive',true,'id',p_user_id);
  end if;

  update public.app_users
  set name=left(v_target.name,200)||' · 비활성 #'||p_user_id,
      login_id='__inactive__'||p_user_id||'__'||left(v_target.login_id,180),
      approval_status='blocked', is_active=false
  where id=p_user_id;
  delete from public.auth_sessions where user_id=p_user_id;

  -- 이름을 비운 뒤 미래 배정만 정리한다. 과거 기록과 작성자 ID는 보존한다.
  v_purge:=public.purge_user_name_references(p_token,v_target.name);
  insert into public.service_logs(actor_id,actor_name,action,target_type,target_id,details)
  values(v_actor_id,v_actor_name,'user_deactivated','app_user',p_user_id,
    jsonb_build_object('actor_role',v_actor_role,'reason',v_reason,
      'target',jsonb_build_object('id',v_target.id,'name',v_target.name,
        'login_id',v_target.login_id,'role',v_target.role,'group_name',v_target.group_name),
      'purge',v_purge));
  return jsonb_build_object('ok',true,'id',p_user_id,'name',v_target.name);
end;
$$;
revoke all on function public.deactivate_app_user_tx(uuid,integer,text)
  from public, anon, authenticated;
grant execute on function public.deactivate_app_user_tx(uuid,integer,text)
  to anon, authenticated;

drop policy if exists "TEMP_session_gate_app_users_ins" on public.app_users;
drop policy if exists "TEMP_session_gate_app_users_upd" on public.app_users;
drop policy if exists "TEMP_session_gate_app_users_del" on public.app_users;
drop policy if exists role_admin_app_users_insert on public.app_users;
drop policy if exists role_self_admin_app_users_update on public.app_users;
drop policy if exists role_admin_app_users_delete on public.app_users;
drop policy if exists role_developer_app_users_delete on public.app_users;
create policy role_admin_app_users_insert on public.app_users
  for insert to anon, authenticated with check ((select private.request_is_admin()));
create policy role_self_admin_app_users_update on public.app_users
  for update to anon, authenticated
  using (id=(select private.request_session_user_id()) or (select private.request_is_admin()))
  with check (id=(select private.request_session_user_id()) or (select private.request_is_admin()));
-- 앱은 비활성화 RPC를 사용한다. 관리자 직접 DELETE는 smoke 정리와 유지보수 호환을
-- 위해 남기되, 작성 기록이 있는 계정은 FK RESTRICT가 영구 삭제를 막는다.
create policy role_developer_app_users_delete on public.app_users
  for delete to anon, authenticated
  using (coalesce((select private.request_session_role())='developer',false));
revoke truncate, references, trigger on public.app_users from public, anon, authenticated;

notify pgrst, 'reload schema';

do $$
declare v_temp integer; v_final integer;
begin
  select count(*) into v_temp from pg_policies
  where schemaname='public' and tablename='app_users' and policyname like 'TEMP_session_gate_%';
  select count(*) into v_final from pg_policies
  where schemaname='public' and tablename='app_users'
    and policyname in ('role_admin_app_users_insert','role_self_admin_app_users_update','role_developer_app_users_delete');
  if v_temp <> 0 or v_final <> 3 then
    raise exception 'app_users 정책 VERIFY 실패: TEMP %, final %/3', v_temp, v_final;
  end if;
  if not has_function_privilege('anon','public.deactivate_app_user_tx(uuid,integer,text)','EXECUTE') then
    raise exception '사용자 비활성화 RPC 실행권한이 없습니다';
  end if;
  if not exists (
    select 1 from pg_trigger where tgrelid='public.app_users'::regclass
      and tgname='app_users_guard_privilege' and not tgisinternal
  ) then
    raise exception 'app_users 권한 보호 트리거가 없습니다';
  end if;
end $$;
