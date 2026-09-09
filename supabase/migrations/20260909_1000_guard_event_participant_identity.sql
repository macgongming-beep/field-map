-- 일정 참가자 신규 등록 계약
--   · 계정 참가자: 승인되고 활성인 app_users만
--   · 게스트: app_users에 같은 이름이 없는 사람만
-- 기존 참가·배정 행은 보존하고, 새 INSERT/UPDATE에만 적용한다.

create or replace function private.normalize_person_name(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select btrim(regexp_replace(
    coalesce(p_value, ''),
    '[[:space:]' || chr(160) || chr(12288) || ']+',
    ' ',
    'g'
  ));
$$;

revoke all on function private.normalize_person_name(text) from public;
grant execute on function private.normalize_person_name(text) to anon, authenticated;

create or replace function private.event_participant_identity_allowed(
  p_user_name text,
  p_role text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when nullif(private.normalize_person_name(p_user_name), '') is null then false
    when p_role = '게스트' then not exists (
      select 1
      from public.app_users u
      where lower(private.normalize_person_name(u.name))
        = lower(private.normalize_person_name(p_user_name))
    )
    when p_role in ('신청', '입명') then exists (
      select 1
      from public.app_users u
      where lower(private.normalize_person_name(u.name))
        = lower(private.normalize_person_name(p_user_name))
        and coalesce(u.approval_status, 'approved') = 'approved'
        and coalesce(u.is_active, true)
    )
    else false
  end;
$$;

revoke all on function private.event_participant_identity_allowed(text,text)
  from public;
grant execute on function private.event_participant_identity_allowed(text,text)
  to anon, authenticated;

-- 가입할 때부터 일정 참가 판정과 같은 형태로 이름을 저장한다.
create or replace function public.signup_tx(
  p_login_id text,
  p_name     text,
  p_pin      text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_login_id text := btrim(coalesce(p_login_id, ''));
  v_name     text := private.normalize_person_name(p_name);
  v_id       integer;
begin
  -- role·approval_status 는 인자로 받지 않는다. 서버가 user/pending 을 강제한다.
  if v_login_id = '' or v_name = '' or coalesce(p_pin, '') = '' then
    return jsonb_build_object('ok', false, 'reason', 'empty',
                              'message', '아이디·이름·비밀번호를 모두 입력해 주세요.');
  end if;

  if exists (select 1 from public.app_users where login_id = v_login_id) then
    return jsonb_build_object('ok', false, 'reason', 'login_id_taken',
                              'message', '이미 사용 중인 아이디입니다.');
  end if;
  if exists (
    select 1 from public.app_users
    where lower(private.normalize_person_name(name)) = lower(v_name)
  ) then
    return jsonb_build_object('ok', false, 'reason', 'name_taken',
                              'message', '이미 사용 중인 닉네임입니다. 다른 이름을 사용해 주세요.');
  end if;

  begin
    insert into public.app_users (login_id, name, pin, role, approval_status)
    values (v_login_id, v_name, p_pin, 'user', 'pending')
    returning id into v_id;
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'reason', 'taken',
                              'message', '이미 사용 중인 아이디 또는 닉네임입니다.');
  end;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

revoke all on function public.signup_tx(text, text, text) from public;
grant execute on function public.signup_tx(text, text, text) to anon, authenticated;

drop policy if exists role_event_participants_insert on public.event_participants;
create policy role_event_participants_insert on public.event_participants
  for insert to public with check (
    (
      (select public.session_can_manage_event(event_id))
      and (select private.event_participant_identity_allowed(user_name, role))
    )
    or (
      role = '신청'
      and (select private.event_participant_identity_allowed(user_name, role))
      and user_name = (
        select u.name from public.app_users u
        where u.id = (select private.request_session_user_id())
      )
      and exists (
        select 1 from public.calendar_events e
        where e.id = event_id and e.allow_applications
      )
    )
  );

drop policy if exists role_event_participants_update on public.event_participants;
create policy role_event_participants_update on public.event_participants
  for update to public
  using ((select public.session_can_manage_event(event_id)))
  with check (
    (select public.session_can_manage_event(event_id))
    and (select private.event_participant_identity_allowed(user_name, role))
  );

notify pgrst, 'reload schema';

do $$
begin
  if to_regprocedure('private.event_participant_identity_allowed(text,text)') is null then
    raise exception 'event participant identity guard 함수가 없습니다';
  end if;
  if to_regprocedure('private.normalize_person_name(text)') is null then
    raise exception '이름 정규화 함수가 없습니다';
  end if;
  if private.normalize_person_name(
    chr(12288) || 'Wang' || chr(12288) || 'Xiao' || chr(160) || 'Ming' || chr(12288)
  ) <> 'Wang Xiao Ming' then
    raise exception '전각·NBSP 이름 정규화가 계약과 다릅니다';
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'event_participants'
      and policyname = 'role_event_participants_insert'
      and cmd = 'INSERT'
  ) then
    raise exception 'event_participants INSERT 정책이 없습니다';
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'event_participants'
      and policyname = 'role_event_participants_update'
      and cmd = 'UPDATE'
  ) then
    raise exception 'event_participants UPDATE 정책이 없습니다';
  end if;
end;
$$;
