-- A denied session must never be indistinguishable from an empty/deleted comment.
create function public.read_group_event_comments(p_event_id integer,p_before_id bigint default null,p_ids bigint[] default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  if private.request_session_user_id() is null then
    raise exception using errcode='42501',message='COMMENT_SESSION_REQUIRED';
  end if;
  if p_event_id is null or p_event_id<=0 or (p_before_id is not null and p_before_id<=0)
    or (p_ids is not null and (cardinality(p_ids)>20 or array_position(p_ids,null) is not null or exists(select 1 from unnest(p_ids) x where x<=0)))
    or (p_before_id is not null and p_ids is not null) then
    raise exception using errcode='22023',message='Invalid comment page';
  end if;
  if not exists(select 1 from public.calendar_events where id=p_event_id and group_service_scope) then
    raise exception using errcode='22023',message='Group event required';
  end if;
  select coalesce(jsonb_agg(to_jsonb(page) order by page.id desc),'[]'::jsonb) into result from (
    select c.id,c.target_type,c.target_id,c.author_id,c.author_name,c.content,c.mention_ids,c.mention_names,c.created_at,c.deleted_at
    from public.comments c
    where c.target_type='calendar_event' and c.target_id=p_event_id and c.deleted_at is null
      and (p_ids is null or c.id=any(p_ids)) and (p_before_id is null or c.id<p_before_id)
    order by c.id desc limit 20
  ) page;
  return result;
end $$;
revoke all on function public.read_group_event_comments(integer,bigint,bigint[]) from public,anon,authenticated;
grant execute on function public.read_group_event_comments(integer,bigint,bigint[]) to anon,authenticated;
notify pgrst,'reload schema';
