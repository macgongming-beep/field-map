do $$
declare
  v_temp integer;
  v_final integer;
begin
  select count(*) into v_temp from pg_policies
  where schemaname = 'public'
    and tablename in ('calendar_events','event_participants','event_card_assignments',
      'event_card_assignment_cards','card_assignments','card_leader_assignments')
    and policyname like 'TEMP\_session\_gate\_%';
  if v_temp <> 0 then raise exception '일정·배정 TEMP 정책이 %개 남았습니다', v_temp; end if;

  select count(*) into v_final from pg_policies
  where schemaname = 'public'
    and policyname in (
      'role_admin_calendar_events_insert','role_admin_calendar_events_update','role_admin_calendar_events_delete',
      'role_event_participants_insert','role_event_participants_update','role_event_participants_delete',
      'role_event_card_assignments_insert','role_event_card_assignments_update','role_event_card_assignments_delete',
      'role_event_card_assignment_cards_insert','role_event_card_assignment_cards_update','role_event_card_assignment_cards_delete',
      'role_admin_card_assignments_insert','role_admin_card_assignments_update','role_admin_card_assignments_delete',
      'role_admin_card_leader_assignments_insert','role_admin_card_leader_assignments_update','role_admin_card_leader_assignments_delete'
    );
  if v_final <> 18 then raise exception '일정·배정 최종 정책이 %/18개입니다', v_final; end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='calendar_events' and cmd='SELECT')
     or not exists (select 1 from pg_policies where schemaname='public' and tablename='event_participants' and cmd='SELECT')
     or not exists (select 1 from pg_policies where schemaname='public' and tablename='event_card_assignments' and cmd='SELECT')
     or not exists (select 1 from pg_policies where schemaname='public' and tablename='event_card_assignment_cards' and cmd='SELECT') then
    raise exception 'Realtime에 필요한 SELECT 정책이 빠졌습니다';
  end if;

  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
    where n.nspname='public'
      and p.proname like '%\_impl\_20260907'
      and acl.grantee in (0, (select oid from pg_roles where rolname='anon'), (select oid from pg_roles where rolname='authenticated'))
      and acl.privilege_type='EXECUTE'
  ) then raise exception '숨긴 구현 함수에 실행권한이 남았습니다'; end if;
end $$;

select tablename, cmd, policyname, roles, qual, with_check
from pg_policies
where schemaname='public'
  and tablename in ('calendar_events','event_participants','event_card_assignments',
    'event_card_assignment_cards','card_assignments','card_leader_assignments')
order by tablename, cmd, policyname;
