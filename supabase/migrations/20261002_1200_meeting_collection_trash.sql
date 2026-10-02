-- Collection trash preserves articles; purge is explicit and admin-only.
create function public.change_service_meeting_collection(p_token uuid, p_id integer, p_expected_updated_at timestamptz, p_action text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_user integer; v_row public.service_meeting_collections;
begin
  v_user := public.verify_session(p_token);
  if not exists(select 1 from public.app_users where id=v_user and role in ('admin','developer')) then
    raise exception '관리자만 모임 정리를 수정할 수 있습니다';
  end if;
  if p_action is null or p_action not in ('trash','restore','purge') then raise exception '잘못된 작업입니다'; end if;
  -- Rare administrative operation: serialize with note saves before acquiring row locks.
  lock table public.service_meeting_notes in exclusive mode;
  select * into v_row from public.service_meeting_collections where id=p_id for update;
  if not found then raise exception '모음을 찾을 수 없습니다'; end if;
  if v_row.updated_at is distinct from p_expected_updated_at then return jsonb_build_object('ok',false,'conflict',true); end if;
  if p_action='trash' then
    if v_row.archived_at is not null then raise exception '이미 휴지통에 있습니다'; end if;
    update public.service_meeting_collections set archived_at=clock_timestamp(), home_enabled=false, updated_at=clock_timestamp() where id=p_id;
  else
    if v_row.archived_at is null then raise exception '휴지통의 모음만 처리할 수 있습니다'; end if;
    if p_action='restore' then
      update public.service_meeting_collections set archived_at=null, home_enabled=false, updated_at=clock_timestamp() where id=p_id;
    else
      delete from public.service_meeting_notes where collection_id=p_id;
      delete from public.service_meeting_collections where id=p_id;
    end if;
  end if;
  return jsonb_build_object('ok',true,'id',p_id);
end $$;
revoke all on function public.change_service_meeting_collection(uuid,integer,timestamptz,text) from public, anon, authenticated;
grant execute on function public.change_service_meeting_collection(uuid,integer,timestamptz,text) to anon, authenticated;

-- Direct article links must not bypass a trashed parent collection.
drop policy meeting_notes_read on public.service_meeting_notes;
create policy meeting_notes_read on public.service_meeting_notes for select to anon, authenticated
using ((select private.request_session_user_id()) is not null and (
  (select private.request_is_admin()) or (
    archived_at is null and exists(select 1 from public.service_meeting_collections c where c.id=collection_id and c.archived_at is null)
  )
));
