-- Export any list titles before rollback; article bodies remain untouched.
create or replace function public.save_service_meeting_collection(p_token uuid, p_id integer, p_expected_updated_at timestamptz, p_data jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_user integer; v_row public.service_meeting_collections; v_end date;
begin
  v_user := public.verify_session(p_token);
  if not exists(select 1 from public.app_users where id=v_user and role in ('admin','developer')) then
    raise exception '관리자만 모임 정리를 수정할 수 있습니다';
  end if;
  if p_id is not null then
    select * into v_row from public.service_meeting_collections where id=p_id for update;
    if not found then raise exception '모음을 찾을 수 없습니다'; end if;
    if v_row.updated_at is distinct from p_expected_updated_at then return jsonb_build_object('ok',false,'conflict',true); end if;
    if v_row.archived_at is not null then raise exception '보관된 모음입니다'; end if;
  end if;
  v_end := (p_data->>'end_date')::date;
  if p_id is null then
    insert into public.service_meeting_collections(name_ko,name_zh,start_date,end_date,home_visible_until,home_position,collapse_suggestions)
    values(btrim(p_data->>'name_ko'),coalesce(p_data->>'name_zh',''),(p_data->>'start_date')::date,v_end,
      coalesce((p_data->>'home_visible_until')::date,v_end+14),coalesce(p_data->>'home_position','after_service'),coalesce((p_data->>'collapse_suggestions')::boolean,true))
    returning * into v_row;
  else
    update public.service_meeting_collections set name_ko=btrim(p_data->>'name_ko'),name_zh=coalesce(p_data->>'name_zh',''),
      start_date=(p_data->>'start_date')::date,end_date=v_end,home_visible_until=coalesce((p_data->>'home_visible_until')::date,v_end+14),
      home_position=coalesce(p_data->>'home_position','after_service'),collapse_suggestions=coalesce((p_data->>'collapse_suggestions')::boolean,true),
      archived_at=case when coalesce((p_data->>'archive')::boolean,false) then clock_timestamp() else null end,
      updated_at=clock_timestamp() where id=p_id returning * into v_row;
  end if;
  return jsonb_build_object('ok',true,'id',v_row.id);
end $$;
revoke all on function public.save_service_meeting_collection(uuid,integer,timestamptz,jsonb) from public, anon, authenticated;
grant execute on function public.save_service_meeting_collection(uuid,integer,timestamptz,jsonb) to anon, authenticated;

create or replace function public.save_service_meeting_note(p_token uuid, p_id integer, p_event_id integer, p_collection_id integer, p_expected_updated_at timestamptz, p_data jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_user integer; v_row public.service_meeting_notes; v_event public.calendar_events; v_ko text; v_zh text;
begin
  v_user := public.verify_session(p_token);
  if not exists(select 1 from public.app_users where id=v_user and role in ('admin','developer')) then
    raise exception '관리자만 모임 정리를 수정할 수 있습니다';
  end if;
  -- Match calendar deletion's lock order (event, then note). Avoid stale snapshots/deadlocks.
  if p_id is not null then
    select event_id into p_event_id from public.service_meeting_notes where id=p_id;
  end if;
  if p_event_id is not null then
    select * into v_event from public.calendar_events where id=p_event_id for update;
    if not found and p_id is null then raise exception '일정을 찾을 수 없습니다'; end if;
  end if;
  if p_id is not null then
    select * into v_row from public.service_meeting_notes where id=p_id for update;
    if not found then raise exception '글을 찾을 수 없습니다'; end if;
    if v_row.updated_at is distinct from p_expected_updated_at then return jsonb_build_object('ok',false,'conflict',true); end if;
    if v_row.archived_at is not null then raise exception '보관된 글입니다'; end if;
  elsif p_event_id is null then
    raise exception '일정을 선택해 주세요';
  elsif exists(select 1 from public.service_meeting_notes where event_id=p_event_id) then
    return jsonb_build_object('ok',false,'conflict',true);
  end if;
  perform 1 from public.service_meeting_collections where id=p_collection_id and archived_at is null for share;
  if not found then raise exception '사용할 수 없는 모음입니다'; end if;
  v_ko := btrim(p_data->>'body_ko'); v_zh := btrim(coalesce(p_data->>'body_zh',''));
  if p_id is null then
    insert into public.service_meeting_notes(event_id,collection_id,title_ko,title_zh,body_ko,body_zh,excerpt_ko,excerpt_zh,
      reading_minutes_ko,reading_minutes_zh,event_date_snapshot,event_time_snapshot,event_place_snapshot,event_leader_snapshot,author_user_id)
    values(p_event_id,p_collection_id,btrim(p_data->>'title_ko'),coalesce(p_data->>'title_zh',''),v_ko,v_zh,
      left(regexp_replace(v_ko,'\s+',' ','g'),180),left(regexp_replace(v_zh,'\s+',' ','g'),180),
      greatest(1,ceil(length(v_ko)/300.0)::integer),greatest(1,ceil(length(v_zh)/300.0)::integer),
      v_event.event_date,v_event.time,coalesce(v_event.place,''),coalesce(v_event.leader_name,''),v_user) returning * into v_row;
  else
    update public.service_meeting_notes set collection_id=p_collection_id,title_ko=btrim(p_data->>'title_ko'),title_zh=coalesce(p_data->>'title_zh',''),
      body_ko=v_ko,body_zh=v_zh,excerpt_ko=left(regexp_replace(v_ko,'\s+',' ','g'),180),excerpt_zh=left(regexp_replace(v_zh,'\s+',' ','g'),180),
      reading_minutes_ko=greatest(1,ceil(length(v_ko)/300.0)::integer),reading_minutes_zh=greatest(1,ceil(length(v_zh)/300.0)::integer),
      archived_at=case when coalesce((p_data->>'archive')::boolean,false) then clock_timestamp() else null end,
      updated_at=clock_timestamp() where id=p_id returning * into v_row;
  end if;
  return jsonb_build_object('ok',true,'id',v_row.id);
end $$;
revoke all on function public.save_service_meeting_note(uuid,integer,integer,integer,timestamptz,jsonb) from public, anon, authenticated;
grant execute on function public.save_service_meeting_note(uuid,integer,integer,integer,timestamptz,jsonb) to anon, authenticated;

alter table public.service_meeting_notes drop column list_title_ko, drop column list_title_zh;
alter table public.service_meeting_collections drop column home_enabled;

