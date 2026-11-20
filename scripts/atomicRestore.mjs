// Owner-only, offline maintenance restore. runOwnerSql supplies ONE transaction.
const literal = value => `'${value.replaceAll("'", "''")}'`
export const REQUIRED_BUSINESS_BACKUPS = ['event_meeting_access', 'place_change_requests', 'territory_report_shares']

export function atomicRestoreSql(payload, { replace = false, full = false, requiredTables = REQUIRED_BUSINESS_BACKUPS } = {}) {
  if (requiredTables.some(name => !/^[a-z][a-z0-9_]*$/.test(name))) throw new Error('Invalid required table')
  const entries = Object.entries(payload)
  if (!entries.length) throw new Error('No restore tables selected')
  for (const [table, rows] of entries) {
    if (!/^[a-z][a-z0-9_]*$/.test(table) || !Array.isArray(rows)) throw new Error('Invalid restore table')
    const columns = rows.length ? Object.keys(rows[0]).sort() : []
    if (rows.some(row => !row || Array.isArray(row) || typeof row !== 'object' ||
      JSON.stringify(Object.keys(row).sort()) !== JSON.stringify(columns))) throw new Error('Inconsistent backup columns')
    if (table === 'app_users' && rows.some(row => row.pin != null && !/^\$2[aby]\$\d\d\$[./A-Za-z0-9]{53}$/.test(row.pin))) {
      throw new Error('Restore requires hashed PINs; plaintext is never imported')
    }
  }
  // Do not replay side effects (push, auto sessions, cleanup). FK/check constraints stay on.
  // Every selected relation is locked before any data/trigger change. The lock, trigger
  // changes, rows and sequence RESTART all roll back together on failure.
  return `
select pg_advisory_xact_lock(20261118,2300);
create temporary table restore_input(name text primary key, rows jsonb not null, done boolean default false) on commit drop;
insert into restore_input(name,rows) values ${entries.map(([name,rows]) => `(${literal(name)},${literal(JSON.stringify(rows))}::jsonb)`).join(',')};
create temporary table restore_relations(oid oid primary key) on commit drop;
do $restore$ declare r record; rel oid; begin
  ${full ? requiredTables.map(name => `if to_regclass('public.${name}') is not null and not exists(select 1 from restore_input where name='${name}') then raise exception 'Incomplete business backup: ${name}'; end if;`).join('\n') : ''}
  for r in select name from restore_input order by name loop
    rel := to_regclass(format('public.%I',r.name));
    if rel is null or not exists(select 1 from pg_class where oid=rel and relkind='r') then raise exception 'Missing restore table: %',r.name; end if;
    insert into restore_relations values(rel) on conflict do nothing;
  end loop;
  if exists(select 1 from restore_input where name='service_groups') then
    insert into restore_relations select 'public.app_users'::regclass union select 'public.app_settings'::regclass on conflict do nothing;
  end if;
  if to_regclass('private.event_assignment_revisions') is not null then
    insert into restore_relations values('private.event_assignment_revisions'::regclass) on conflict do nothing;
  end if;
  for r in select c.oid,c.relowner from restore_relations x join pg_class c on c.oid=x.oid order by c.oid loop
    if not pg_has_role(current_user,r.relowner,'USAGE') then raise exception 'Table owner required'; end if;
    execute format('lock table %s in access exclusive mode',r.oid::regclass);
  end loop;
end $restore$;
create temporary table restore_triggers on commit drop as
  select t.tgrelid,t.tgname,t.tgenabled from pg_trigger t join restore_relations r on r.oid=t.tgrelid where not t.tgisinternal;
create temporary table restore_memberships(id bigint,code text) on commit drop;
do $restore$ begin
  if exists(select 1 from restore_input where name='service_groups') then
    insert into restore_memberships select u.id,g.code from public.app_users u join public.service_groups g
      on u.group_name in(g.code,g.label_ko,g.label_zh,g.legacy_name,g.display_name);
  end if;
end $restore$;
do $restore$ declare r record; begin
  for r in select * from restore_triggers loop execute format('alter table %s disable trigger %I',r.tgrelid::regclass,r.tgname); end loop;
end $restore$;
do $restore$
declare r record; rel oid; cols text; keys text; updates text; body jsonb; unknown_column text;
begin
  while exists(select 1 from restore_input where not done) loop
    select i.* into r from restore_input i where not done and not exists(
      select 1 from pg_constraint f join restore_input p on f.confrelid=to_regclass(format('public.%I',p.name))
      where f.contype='f' and f.conrelid=to_regclass(format('public.%I',i.name)) and p.name<>i.name and not p.done
    ) order by case when i.name='service_groups' then 0 else 1 end,i.name limit 1;
    if not found then raise exception 'Restore dependency cycle'; end if;
    rel:=to_regclass(format('public.%I',r.name)); body:=r.rows;
    if jsonb_array_length(body)>0 then
      select string_agg(format('%I',key),',' order by key) into cols from jsonb_object_keys(body->0) key;
      select key into unknown_column from jsonb_object_keys(body->0) key where not exists(
        select 1 from pg_attribute where attrelid=rel and attname=key and attnum>0 and not attisdropped and attgenerated='') limit 1;
      if unknown_column is not null then raise exception 'Unknown backup column in %',r.name; end if;
      select string_agg(format('%I',a.attname),',' order by k.ord) into keys from pg_constraint c
        cross join lateral unnest(c.conkey) with ordinality k(num,ord) join pg_attribute a on a.attrelid=c.conrelid and a.attnum=k.num
        where c.conrelid=rel and c.contype='p';
      if keys is null then raise exception 'Restore primary key missing: %',r.name; end if;
      if exists(select 1 from pg_constraint c cross join lateral unnest(c.conkey) k(num)
        join pg_attribute a on a.attrelid=c.conrelid and a.attnum=k.num
        where c.conrelid=rel and c.contype='p' and not (body->0 ? a.attname)) then raise exception 'Backup primary key missing: %',r.name; end if;
      select string_agg(format('%I=%s',a.attname,case when r.name='cards' and a.attname='group_assignment_revision'
        then 'greatest(target.group_assignment_revision,excluded.group_assignment_revision)+1' else format('excluded.%I',a.attname) end),',') into updates
        from pg_attribute a where a.attrelid=rel and a.attnum>0 and not a.attisdropped and body->0 ? a.attname
        and not exists(select 1 from pg_constraint c where c.conrelid=rel and c.contype='p' and a.attnum=any(c.conkey));
      execute format('insert into %s as target (%s) overriding system value select %s from jsonb_populate_recordset(null::%s,$1)
        on conflict (%s) %s',rel::regclass,cols,cols,rel::regclass,keys,
        ${replace ? "case when updates is not null then 'do update set '||updates else 'do nothing' end" : "'do nothing'"}) using body;
    end if;
    update restore_input set done=true where name=r.name;
  end loop;
end $restore$;
do $restore$ begin
  if exists(select 1 from restore_input where name='service_groups') then
    update public.app_users u set group_name=case when g.is_active then g.display_name else null end
      from restore_memberships m join public.service_groups g on g.code=m.code
      where u.id=m.id and not exists(select 1 from restore_input i cross join lateral jsonb_array_elements(i.rows) x
        where i.name='app_users' and (x->>'id')::bigint=u.id);
    update public.app_users u set group_name=case when g.is_active then g.display_name else null end
      from public.service_groups g where u.group_name in(g.code,g.label_ko,g.label_zh,g.legacy_name,g.display_name);
    perform private.publish_service_group_directory(coalesce((select (value::jsonb->>'revision')::bigint
      from public.app_settings where key='service_group_directory'),0)+1);
  end if;
  if to_regclass('private.event_assignment_revisions') is not null and exists(select 1 from restore_input
    where name in('calendar_events','event_participants','event_card_assignments','event_card_assignment_cards',
      'event_informal_assignments','event_restaurant_assignments')) then
    insert into private.event_assignment_revisions(event_id,revision) select id,1 from public.calendar_events
      on conflict(event_id) do update set revision=private.event_assignment_revisions.revision+1;
  end if;
  if exists(select 1 from restore_input where name='card_group_assignments') then
    update public.cards set group_assignment_revision=group_assignment_revision+1;
  end if;
end $restore$;
do $restore$ declare r record; high bigint; previous bigint; begin
  for r in select a.attrelid,a.attname,pg_get_serial_sequence(c.oid::regclass::text,a.attname)::regclass seq
    from restore_relations x join pg_class c on c.oid=x.oid join pg_attribute a on a.attrelid=c.oid
    where a.attnum>0 and not a.attisdropped and pg_get_serial_sequence(c.oid::regclass::text,a.attname) is not null loop
    execute format('select coalesce(max(%I),0) from %s',r.attname,r.attrelid::regclass) into high;
    execute format('select last_value from %s',r.seq) into previous;
    execute format('alter sequence %s restart with %s',r.seq,greatest(high,previous)+1);
  end loop;
  for r in select * from restore_triggers loop
    execute format('alter table %s %s trigger %I',r.tgrelid::regclass,
      case r.tgenabled when 'D' then 'disable' when 'A' then 'enable always' when 'R' then 'enable replica' else 'enable' end,r.tgname);
  end loop;
end $restore$;
select jsonb_build_object('tables',(select count(*) from restore_input),'rows',(select sum(jsonb_array_length(rows)) from restore_input));`
}
