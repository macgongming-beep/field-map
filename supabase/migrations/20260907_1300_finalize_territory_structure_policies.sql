-- 구역 구조 자료의 최종 쓰기 계약.
-- SELECT 정책은 Realtime 계약 때문에 건드리지 않는다.

alter table public.buildings
  add column if not exists units_surveyed boolean not null default false;

create or replace function public.session_can_manage_place_structure()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select coalesce(private.request_session_role() in ('leader', 'admin', 'developer'), false)
$$;
revoke all on function public.session_can_manage_place_structure() from public;
grant execute on function public.session_can_manage_place_structure() to anon, authenticated;

-- 일반 사용자는 방문 상태와 현장 메모·중국어 표시만 직접 고칠 수 있다.
-- 호수, 소속 건물, 용도와 식당 연결은 인도자·관리자만 변경한다.
create or replace function public.guard_unit_structure_change()
returns trigger
language plpgsql security invoker
set search_path = ''
as $$
begin
  if current_user in ('postgres', 'supabase_admin', 'service_role') then return new; end if;
  if public.session_can_manage_place_structure() then return new; end if;

  if new.id is distinct from old.id
     or new.building_id is distinct from old.building_id
     or new.number is distinct from old.number
     or new.created_at is distinct from old.created_at
     or new.is_restaurant is distinct from old.is_restaurant
     or new.naver_place_id is distinct from old.naver_place_id
     or new.usage_type is distinct from old.usage_type then
    raise exception '세대 구조를 변경할 권한이 없습니다' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_unit_structure_change() from public, anon, authenticated;
drop trigger if exists guard_unit_structure_change_trigger on public.units;
create trigger guard_unit_structure_change_trigger
before update on public.units
for each row execute function public.guard_unit_structure_change();

create or replace function public.guard_building_structure_change()
returns trigger
language plpgsql security invoker
set search_path = ''
as $$
begin
  if current_user in ('postgres', 'supabase_admin', 'service_role') then return new; end if;
  if public.session_can_manage_place_structure() then return new; end if;

  if new.id is distinct from old.id
     or new.card_id is distinct from old.card_id
     or new.name is distinct from old.name
     or new.address is distinct from old.address
     or new.type is distinct from old.type
     or new.lat is distinct from old.lat
     or new.lng is distinct from old.lng
     or new.warning is distinct from old.warning
     or new.memo is distinct from old.memo
     or new.created_at is distinct from old.created_at
     or new.is_chinese_heavy is distinct from old.is_chinese_heavy
     or new.is_restaurant is distinct from old.is_restaurant
     or new.access_status is distinct from old.access_status then
    raise exception '건물 구조를 변경할 권한이 없습니다' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_building_structure_change() from public, anon, authenticated;
drop trigger if exists guard_building_structure_change_trigger on public.buildings;
create trigger guard_building_structure_change_trigger
before update on public.buildings
for each row execute function public.guard_building_structure_change();

-- 삭제 직전의 대상과 영향 범위를 관리자 감사 기록에 남긴다.
create or replace function private.log_place_deletion(
  p_actor_id integer,
  p_actor_name text,
  p_actor_role text,
  p_target_type text,
  p_target_id bigint,
  p_impact jsonb,
  p_reason text
)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_card_id integer;
  v_card_name text;
  v_target jsonb;
begin
  if p_target_type = 'building' then
    select b.card_id, c.name, to_jsonb(b)
      into v_card_id, v_card_name, v_target
    from public.buildings b
    left join public.cards c on c.id = b.card_id
    where b.id = p_target_id;
  elsif p_target_type = 'unit' then
    select b.card_id, c.name,
           to_jsonb(u) || jsonb_build_object('building_name', b.name, 'address', b.address)
      into v_card_id, v_card_name, v_target
    from public.units u
    join public.buildings b on b.id = u.building_id
    left join public.cards c on c.id = b.card_id
    where u.id = p_target_id;
  else
    raise exception '삭제 대상 종류가 올바르지 않습니다';
  end if;

  if v_target is null then raise exception '삭제 대상을 찾을 수 없습니다'; end if;

  insert into public.service_logs (
    card_id, card_name, actor_id, actor_name, action, target_type, target_id, details
  ) values (
    v_card_id, v_card_name, p_actor_id, p_actor_name,
    case when p_target_type = 'building' then 'building_deleted' else 'unit_deleted' end,
    p_target_type, p_target_id,
    jsonb_build_object(
      'actor_role', p_actor_role,
      'reason', nullif(btrim(coalesce(p_reason, '')), ''),
      'target', v_target,
      'impact', coalesce(p_impact, '{}'::jsonb)
    )
  );
end;
$$;
revoke all on function private.log_place_deletion(integer,text,text,text,bigint,jsonb,text)
  from public, anon, authenticated;

create or replace function public.delete_place_or_request_tx(
  p_token uuid,
  p_target_type text,
  p_target_id bigint,
  p_request_type text default null,
  p_note text default ''
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_actor_id integer;
  v_actor_name text;
  v_actor_role text;
  v_has_links boolean;
  v_request jsonb;
  v_existing_request_id bigint;
  v_impact jsonb;
begin
  v_actor_id := public.verify_session(p_token);
  select name, role into v_actor_name, v_actor_role
  from public.app_users where id = v_actor_id;
  if p_target_type not in ('building', 'unit') then
    raise exception '삭제 대상 종류가 올바르지 않습니다';
  end if;

  -- 삭제와 영향 계산 사이에 대상이 바뀌지 않게 먼저 잠근다.
  if p_target_type = 'building' then
    perform 1 from public.buildings where id = p_target_id for update;
  else
    perform 1 from public.units where id = p_target_id for update;
  end if;
  if not found then raise exception '장소를 찾을 수 없습니다'; end if;

  v_has_links := private.place_has_linked_data(p_target_type, p_target_id);
  if v_actor_role = 'user' then
    select id into v_existing_request_id
    from public.place_change_requests
    where status = 'pending' and request_type = 'remove_place'
      and ((p_target_type = 'unit' and unit_id = p_target_id)
        or (p_target_type = 'building' and building_id = p_target_id and unit_id is null))
    order by id desc limit 1;
    if v_existing_request_id is not null then
      update public.place_change_requests
      set impact_snapshot = private.place_impact_snapshot(p_target_type, p_target_id)
      where id = v_existing_request_id;
      return jsonb_build_object('ok', true, 'action', 'requested',
        'request_id', v_existing_request_id, 'has_linked_data', v_has_links,
        'already_requested', true);
    end if;

    v_request := public.submit_place_change_request_tx(
      p_token, coalesce(p_request_type, 'remove_place'),
      case when p_target_type = 'building' then p_target_id else null end,
      case when p_target_type = 'unit' then p_target_id else null end,
      null, p_note
    );
    return jsonb_build_object('ok', true, 'action', 'requested',
      'request_id', v_request -> 'id', 'has_linked_data', v_has_links);
  end if;

  if not coalesce(v_actor_role in ('leader', 'admin', 'developer'), false) then
    raise exception '장소를 삭제할 권한이 없습니다' using errcode = '42501';
  end if;

  v_impact := private.place_impact_snapshot(p_target_type, p_target_id);
  perform private.queue_place_deletion_signal(p_target_type, p_target_id);
  perform private.log_place_deletion(
    v_actor_id, v_actor_name, v_actor_role, p_target_type, p_target_id, v_impact, p_note
  );
  if p_target_type = 'unit' then
    delete from public.units where id = p_target_id;
  else
    delete from public.buildings where id = p_target_id;
  end if;

  return jsonb_build_object('ok', true, 'action', 'deleted',
    'has_linked_data', v_has_links, 'impact', v_impact);
end;
$$;
revoke all on function public.delete_place_or_request_tx(uuid,text,bigint,text,text)
  from public, anon, authenticated;
grant execute on function public.delete_place_or_request_tx(uuid,text,bigint,text,text)
  to anon, authenticated;

create or replace function public.execute_place_deletion_request_tx(
  p_token uuid,
  p_request_id bigint
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_actor_id integer;
  v_actor_name text;
  v_actor_role text;
  v_request public.place_change_requests%rowtype;
  v_target_type text;
  v_target_id bigint;
  v_impact jsonb;
begin
  v_actor_id := public.verify_session(p_token);
  select name, role into v_actor_name, v_actor_role
  from public.app_users where id = v_actor_id;
  if not coalesce(v_actor_role in ('admin', 'developer'), false) then
    raise exception '관리자만 장소 삭제를 확정할 수 있습니다' using errcode = '42501';
  end if;

  select * into v_request from public.place_change_requests
  where id = p_request_id and status = 'pending' for update;
  if not found then raise exception '처리할 삭제 요청을 찾을 수 없습니다'; end if;
  if v_request.request_type <> 'remove_place' then raise exception '장소 삭제 요청이 아닙니다'; end if;

  if v_request.unit_id is not null then
    v_target_type := 'unit'; v_target_id := v_request.unit_id;
    perform 1 from public.units where id = v_target_id for update;
  elsif v_request.building_id is not null then
    v_target_type := 'building'; v_target_id := v_request.building_id;
    perform 1 from public.buildings where id = v_target_id for update;
  else
    raise exception '삭제할 장소가 이미 없거나 연결이 끊겼습니다';
  end if;
  if not found then raise exception '삭제할 장소가 이미 없습니다'; end if;

  v_impact := private.place_impact_snapshot(v_target_type, v_target_id);
  perform private.queue_place_deletion_signal(v_target_type, v_target_id);
  perform private.log_place_deletion(
    v_actor_id, v_actor_name, v_actor_role, v_target_type, v_target_id,
    v_impact, coalesce(nullif(btrim(v_request.note), ''), '삭제 요청 승인')
  );
  if v_target_type = 'unit' then
    delete from public.units where id = v_target_id;
  else
    delete from public.buildings where id = v_target_id;
  end if;

  update public.place_change_requests
  set status = 'completed', impact_snapshot = v_impact,
      reviewed_by_name = v_actor_name, review_note = '삭제 실행', reviewed_at = now()
  where id = p_request_id;

  return jsonb_build_object('ok', true, 'action', 'deleted', 'impact', v_impact);
end;
$$;
revoke all on function public.execute_place_deletion_request_tx(uuid,bigint)
  from public, anon, authenticated;
grant execute on function public.execute_place_deletion_request_tx(uuid,bigint)
  to anon, authenticated;

-- 카드·경계는 관리자 전용이다.
drop policy if exists "TEMP_session_gate_cards_ins" on public.cards;
drop policy if exists "TEMP_session_gate_cards_upd" on public.cards;
drop policy if exists "TEMP_session_gate_cards_del" on public.cards;
drop policy if exists role_admin_cards_insert on public.cards;
drop policy if exists role_admin_cards_update on public.cards;
drop policy if exists role_admin_cards_delete on public.cards;
create policy role_admin_cards_insert on public.cards for insert to anon, authenticated
  with check ((select private.request_is_admin()));
create policy role_admin_cards_update on public.cards for update to anon, authenticated
  using ((select private.request_is_admin())) with check ((select private.request_is_admin()));
create policy role_admin_cards_delete on public.cards for delete to anon, authenticated
  using ((select private.request_is_admin()));

drop policy if exists "TEMP_session_gate_card_boundaries_ins" on public.card_boundaries;
drop policy if exists "TEMP_session_gate_card_boundaries_upd" on public.card_boundaries;
drop policy if exists "TEMP_session_gate_card_boundaries_del" on public.card_boundaries;
drop policy if exists role_admin_card_boundaries_insert on public.card_boundaries;
drop policy if exists role_admin_card_boundaries_update on public.card_boundaries;
drop policy if exists role_admin_card_boundaries_delete on public.card_boundaries;
create policy role_admin_card_boundaries_insert on public.card_boundaries for insert to anon, authenticated
  with check ((select private.request_is_admin()));
create policy role_admin_card_boundaries_update on public.card_boundaries for update to anon, authenticated
  using ((select private.request_is_admin())) with check ((select private.request_is_admin()));
create policy role_admin_card_boundaries_delete on public.card_boundaries for delete to anon, authenticated
  using ((select private.request_is_admin()));

-- 건물·세대 생성은 승인 사용자 모두, 기존 구조 변경은 인도자 이상이다.
drop policy if exists "TEMP_session_gate_buildings_ins" on public.buildings;
drop policy if exists "TEMP_session_gate_buildings_upd" on public.buildings;
drop policy if exists buildings_delete_admin on public.buildings;
drop policy if exists role_member_buildings_insert on public.buildings;
drop policy if exists role_manager_buildings_update on public.buildings;
drop policy if exists role_member_buildings_update on public.buildings;
create policy role_member_buildings_insert on public.buildings for insert to anon, authenticated
  with check ((select private.request_session_user_id()) is not null);
create policy role_member_buildings_update on public.buildings for update to anon, authenticated
  using ((select private.request_session_user_id()) is not null)
  with check ((select private.request_session_user_id()) is not null);

drop policy if exists "TEMP_session_gate_units_ins" on public.units;
drop policy if exists "TEMP_session_gate_units_upd" on public.units;
drop policy if exists units_delete_admin on public.units;
drop policy if exists role_member_units_insert on public.units;
drop policy if exists role_member_units_update on public.units;
create policy role_member_units_insert on public.units for insert to anon, authenticated
  with check ((select private.request_session_user_id()) is not null);
create policy role_member_units_update on public.units for update to anon, authenticated
  using ((select private.request_session_user_id()) is not null)
  with check ((select private.request_session_user_id()) is not null);

-- DELETE 정책은 일부러 만들지 않는다. 건물·세대 삭제는 감사 RPC만 통과한다.
revoke truncate, references, trigger on public.cards, public.card_boundaries, public.buildings, public.units
  from public, anon, authenticated;

notify pgrst, 'reload schema';
