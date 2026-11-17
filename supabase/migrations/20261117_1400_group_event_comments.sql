-- Group comments are readable by approved app sessions, never by an anonymous API reader.
-- Legacy non-group comments retain their existing access and realtime behavior.
create policy group_comment_session_read on public.comments as restrictive for select to anon,authenticated
using(target_type<>'calendar_event' or exists(
  select 1 from public.calendar_events e where e.id=target_id and not coalesce(e.group_service_scope,false)
) or (select private.request_session_user_id()) is not null);

create index if not exists comments_event_page on public.comments(target_type,target_id,id desc) where deleted_at is null;

-- Only identifiers/revisions are public. Content and author never travel over this channel.
create table public.group_comment_signals(
  event_id integer primary key references public.calendar_events(id) on delete cascade,
  comment_id bigint not null,
  revision bigint not null default 1
);
alter table public.group_comment_signals enable row level security;
create policy group_comment_signal_read on public.group_comment_signals for select to anon,authenticated using(true);
grant select on public.group_comment_signals to anon,authenticated;
revoke insert,update,delete on public.group_comment_signals from anon,authenticated;
alter publication supabase_realtime add table public.group_comment_signals;

create function private.signal_group_comment() returns trigger language plpgsql security definer set search_path='' as $$
declare row_data public.comments;
begin
  if tg_op='DELETE' then row_data:=old;else row_data:=new;end if;
  if row_data.target_type='calendar_event' and exists(select 1 from public.calendar_events where id=row_data.target_id and group_service_scope) then
    insert into public.group_comment_signals(event_id,comment_id) values(row_data.target_id,row_data.id)
    on conflict(event_id) do update set comment_id=excluded.comment_id,revision=group_comment_signals.revision+1;
  end if;
  return null;
end $$;
revoke all on function private.signal_group_comment() from public,anon,authenticated;
create trigger group_comment_changed after insert or update or delete on public.comments for each row execute function private.signal_group_comment();

-- Keep the installed recipient/preferences/push logic; add an exact group/comment destination only.
do $$ declare definition text; needle text; matches integer; begin
  definition:=pg_get_functiondef('public.notify_on_comment()'::regprocedure);
  select count(*) into matches from regexp_matches(definition,'v_body[[:space:]]*:=[[:space:]]*new\.author_name','g');
  needle:=substring(definition from 'v_body[[:space:]]*:=[[:space:]]*new\.author_name');
  if matches<>1 or needle is null or position('&comment=' in definition)>0 then raise exception 'Unexpected comment notification implementation';end if;
  execute replace(definition,needle,$link$  if new.target_type='calendar_event' and exists(select 1 from public.calendar_events where id=new.target_id and group_service_scope) then
    v_link:=v_link||'&comment='||new.id::text;
  end if;
  v_body := new.author_name$link$);
end $$;
notify pgrst,'reload schema';
