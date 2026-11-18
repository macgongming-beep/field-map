-- Demo first. Stable codes survive renames; deletion retires a group, never its events.
alter table public.service_groups add column display_name text,
  add column is_active boolean not null default true,
  add column sort_order integer not null default 0;

do $$
declare names text[]; n text; c text; i integer:=0;
begin
  select array_agg(a.value order by ord) into names from public.app_settings s,
    jsonb_array_elements_text(s.value::jsonb) with ordinality a(value,ord) where s.key='user_groups';
  if names is null then select array_agg(legacy_name order by array_position(array['dongtan','singal','cheoin','dongbaek'],code),code) into names from public.service_groups; end if;
  if exists(select 1 from unnest(names) v where nullif(btrim(v),'') is null or length(v)>12)
    then raise exception 'Invalid configured group names'; end if;
  update public.service_groups set display_name=legacy_name,is_active=false;
  -- Preserve membership even if an older settings edit omitted a populated group.
  for n in select v from unnest(names) with ordinality a(v,ord) order by ord loop
    select code into c from public.service_groups where n in(code,label_ko,label_zh,legacy_name);
    if c is null then
      c:='g_'||replace(gen_random_uuid()::text,'-','');
      insert into public.service_groups(code,label_ko,label_zh,legacy_name,display_name,is_active,sort_order)
        values(c,n,n,n,n,true,i);
    else
      if exists(select 1 from public.service_groups where code=c and is_active) then raise exception 'Ambiguous configured group aliases'; end if;
      update public.service_groups set display_name=n,is_active=true,sort_order=i where code=c;
    end if;
    i:=i+1;
  end loop;
  for n in select distinct group_name from public.app_users where nullif(btrim(group_name),'') is not null loop
    select code into c from public.service_groups where n in(code,label_ko,label_zh,legacy_name,display_name);
    if c is null then
      if length(n)>12 then raise exception 'Group name too long: %',n; end if;
      c:='g_'||replace(gen_random_uuid()::text,'-','');
      insert into public.service_groups(code,label_ko,label_zh,legacy_name,display_name,is_active,sort_order)
        values(c,n,n,n,n,true,i); i:=i+1;
    else update public.service_groups set is_active=true where code=c; end if;
  end loop;
  update public.app_users u set group_name=g.display_name from public.service_groups g
    where u.group_name in(g.code,g.label_ko,g.label_zh,g.legacy_name) and u.group_name is distinct from g.display_name;
  if (select count(*) from public.service_groups where is_active)>20 then raise exception 'Too many active groups'; end if;
end $$;
alter table public.service_groups alter column display_name set not null;
create unique index service_groups_display_name on public.service_groups(display_name);

create function private.publish_service_group_directory(p_revision bigint) returns text
language plpgsql security definer set search_path='' as $$
declare result text; names text; previous text;
begin
  select jsonb_build_object('revision',p_revision::text,'groups',coalesce(jsonb_agg(
    jsonb_build_object('code',code,'name',display_name,'active',is_active) order by sort_order,code),'[]'))::text,
    coalesce(jsonb_agg(display_name order by sort_order,code) filter(where is_active),'[]')::text
    into result,names from public.service_groups;
  previous:=current_setting('app.group_directory_write',true);
  perform set_config('app.group_directory_write','on',true);
  insert into public.app_settings(key,value) values('service_group_directory',result),('user_groups',names)
    on conflict(key) do update set value=excluded.value;
  perform set_config('app.group_directory_write',coalesce(previous,''),true);
  return result;
end $$;
revoke all on function private.publish_service_group_directory(bigint) from public,anon,authenticated;
select private.publish_service_group_directory(1);

create function private.guard_group_directory_settings() returns trigger
language plpgsql set search_path='' as $$
begin
  if (case when tg_op='DELETE' then old.key else new.key end) in('user_groups','service_group_directory')
    or (tg_op='UPDATE' and old.key in('user_groups','service_group_directory')) then
    if current_setting('app.group_directory_write',true) is distinct from 'on' then
      raise exception 'Use group directory management' using errcode='42501';
    end if;
  end if;
  if tg_op='DELETE' then return old; end if; return new;
end $$;
revoke all on function private.guard_group_directory_settings() from public,anon,authenticated;
create trigger guard_group_directory_settings before insert or update or delete on public.app_settings
  for each row execute function private.guard_group_directory_settings();

create function private.guard_user_group_membership() returns trigger
language plpgsql security definer set search_path='' as $$
declare chosen text;
begin
  if tg_op='UPDATE' and new.group_name is not distinct from old.group_name then return new; end if;
  if nullif(btrim(new.group_name),'') is null then new.group_name:=null; return new; end if;
  perform pg_advisory_xact_lock(20261118,2300);
  select display_name into chosen from public.service_groups
    where is_active and new.group_name in(code,label_ko,label_zh,legacy_name,display_name);
  if chosen is null then raise exception 'Unknown or retired group'; end if;
  new.group_name:=chosen; return new;
end $$;
revoke all on function private.guard_user_group_membership() from public,anon,authenticated;
create trigger guard_user_group_membership before insert or update of group_name on public.app_users
  for each row execute function private.guard_user_group_membership();

create function public.manage_service_group_tx(p_token uuid,p_action text,p_code text,p_name text,p_expected_revision bigint)
returns text language plpgsql security definer set search_path='' as $$
declare actor integer; rev bigint; n text:=btrim(p_name); g public.service_groups; c text;
begin
  actor:=public.verify_session(p_token);
  if not exists(select 1 from public.app_users where id=actor and is_active and approval_status='approved'
    and role in('admin','developer')) then raise exception 'Admin required' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(20261118,2300);
  select (value::jsonb->>'revision')::bigint into rev from public.app_settings where key='service_group_directory' for update;
  if rev is null or p_expected_revision is distinct from rev then raise exception 'Group directory changed' using errcode='PT409'; end if;
  if p_action not in('add','rename','archive') or p_action is null then raise exception 'Invalid group action'; end if;
  if p_action in('add','rename') then
    if nullif(n,'') is null or length(n)>12 then raise exception 'Invalid group name'; end if;
    if exists(select 1 from public.service_groups where code is distinct from p_code
      and n in(code,label_ko,label_zh,legacy_name,display_name)) then raise exception 'Duplicate group name'; end if;
  end if;
  if p_action='add' then
    if p_code is not null then raise exception 'New groups cannot supply a code'; end if;
    if (select count(*) from public.service_groups where is_active)>=20 then raise exception 'Too many active groups'; end if;
    c:='g_'||replace(gen_random_uuid()::text,'-','');
    insert into public.service_groups(code,label_ko,label_zh,legacy_name,display_name,is_active,sort_order)
      values(c,n,n,n,n,true,(select coalesce(max(sort_order),0)+1 from public.service_groups));
  else
    select * into g from public.service_groups where code=p_code and is_active for update;
    if not found then raise exception 'Group not found'; end if;
    if p_action='rename' then
      update public.service_groups set label_ko=n,label_zh=n,legacy_name=n,display_name=n where code=p_code;
      update public.app_users set group_name=n where group_name in(g.code,g.label_ko,g.label_zh,g.legacy_name,g.display_name);
    else
      update public.app_users set group_name=null where group_name in(g.code,g.label_ko,g.label_zh,g.legacy_name,g.display_name);
      update public.service_groups set is_active=false where code=p_code;
    end if;
  end if;
  return private.publish_service_group_directory(rev+1);
end $$;
revoke all on function public.manage_service_group_tx(uuid,text,text,text,bigint) from public;
grant execute on function public.manage_service_group_tx(uuid,text,text,text,bigint) to anon,authenticated;

create function private.guard_active_service_targets() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if tg_op='UPDATE' and new.target_groups is not distinct from old.target_groups then return new; end if;
  if exists(select 1 from unnest(new.target_groups) c join public.service_groups g on g.code=c where not g.is_active)
    then raise exception 'Cannot create service for a retired group'; end if;
  return new;
end $$;
revoke all on function private.guard_active_service_targets() from public,anon,authenticated;
create trigger guard_active_service_targets before insert or update of target_groups on public.calendar_events
  for each row execute function private.guard_active_service_targets();
notify pgrst,'reload schema';
