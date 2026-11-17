// Catalog reads only. Passing shape checks do not approve installed bodies.
const signatures = [
  'public.verify_session(uuid)',
  'private.request_session_user_id()',
  'private.request_session_user_name()',
  'private.request_is_admin()',
  'private.user_can_manage_event(integer,integer)',
  'public.session_can_manage_event(integer)',
  'private.event_participant_identity_allowed(text,text)',
  'private.cleanup_team_participant_removal()',
  'public.assign_cards_bulk_tx(uuid,integer,jsonb,text,text)',
  'public.assign_scoped_cards_bulk_tx(uuid,integer,jsonb,text,text)',
  'public.assign_team_service_bulk_tx(uuid,integer,jsonb,text,text)',
  'public.remove_team_event_participant_tx(uuid,integer,text,boolean,text)',
  'public.update_calendar_event_tx(uuid,integer,jsonb,boolean)',
  'public.update_calendar_event_series_tx_impl_20260907(uuid,uuid,date,jsonb,boolean)',
  'public.rename_user_name_references(uuid,text,text)',
  'public.purge_user_name_references(uuid,text)',
  'public.merge_duplicate_buildings_tx(uuid,integer,jsonb,integer[])',
  'public.notify_on_comment()',
  'public.filter_notification_recipients(integer[],text)',
  'public.insert_notifications(integer[],text,text,text,text,integer)',
  'public.dispatch_push_notification(integer[],text,text,text,text,integer)',
]
const columns = {
  calendar_events: ['id','event_date','time','end_time','series_id','leader_name','meeting_map_url','allow_applications','assignment_status','assignment_shared_at','assignment_shared_by','assignment_team_scopes','assignment_team_informal'],
  event_participants: ['event_id','user_name','role'],
  event_card_assignments: ['event_id','user_name','assigned_card_id','team_key'],
  event_card_assignment_cards: ['event_id','user_name','card_id'],
  event_informal_assignments: ['event_id','user_name','asset_id'],
  event_restaurant_assignments: ['event_id','user_name','building_id','unit_id'],
  service_sessions: ['calendar_event_id','user_name','source','status','ended_at'],
  app_users: ['id','name','role','group_name','is_active','approval_status'],
  comments: ['id','target_type','target_id','author_id','author_name','content','mention_ids','mention_names','created_at','deleted_at'],
}
const quote = value => `'${value.replaceAll("'","''")}'`
const functionValues = signatures.map(s => `(${quote(s)})`).join(',')
const columnValues = Object.entries(columns).flatMap(([table, names]) => names.map(name => `(${quote(table)},${quote(name)})`)).join(',')

export const prerequisiteAuditSql = `with
  expected_functions(signature) as (values ${functionValues}),
  expected_columns(tab,col) as (values ${columnValues}),
  functions as (select e.signature,p.oid is not null present,p.prosecdef definer,
    md5(p.prosrc) body_hash,pg_get_function_result(p.oid) result_type,
    coalesce(has_function_privilege('anon',p.oid,'execute'),false) anon_execute,
    coalesce(has_function_privilege('authenticated',p.oid,'execute'),false) authenticated_execute
    from expected_functions e left join pg_proc p on p.oid=to_regprocedure(e.signature)),
  missing_columns as (select tab||'.'||col name from expected_columns e where not exists(
    select 1 from information_schema.columns c where c.table_schema='public' and c.table_name=e.tab and c.column_name=e.col)),
  checks as (select
    not exists(select 1 from functions where not present) functions_present,
    not exists(select 1 from missing_columns) columns_present,
    exists(select 1 from pg_trigger where tgrelid=to_regclass('public.event_participants')
      and tgfoid=to_regprocedure('private.cleanup_team_participant_removal()') and tgenabled='O') cleanup_trigger,
    exists(select 1 from pg_trigger where tgrelid=to_regclass('public.calendar_events')
      and tgname='on_calendar_event_update' and tgenabled='O') schedule_trigger,
    exists(select 1 from pg_trigger where tgrelid=to_regclass('public.comments')
      and tgfoid=to_regprocedure('public.notify_on_comment()') and tgenabled='O') comment_trigger,
    exists(select 1 from pg_publication where pubname='supabase_realtime') realtime_publication)
select json_build_object('checks',(select row_to_json(checks) from checks),
  'functions',(select json_agg(functions order by signature) from functions),
  'missingColumns',(select coalesce(json_agg(name order by name),'[]') from missing_columns)) prerequisites;`

export const prerequisiteGuardSql = `do $prerequisites$ declare report json; begin
  select prerequisites into report from (${prerequisiteAuditSql.replace(/;$/, '')}) audit;
  if exists(select 1 from json_each_text(report->'checks') where value<>'true') then
    raise exception 'Group service prerequisites missing: %',report;
  end if;
end $prerequisites$;\n`
