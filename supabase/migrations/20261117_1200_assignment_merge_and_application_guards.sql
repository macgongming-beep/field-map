-- Preserve the currently installed merge implementation, including candidate/history fixes.
do $$ declare definition text; begin
  if to_regprocedure('private.merge_duplicate_buildings_before_assignment_guard(uuid,integer,jsonb,integer[])') is not null then
    raise exception 'Merge guard is already installed';
  end if;
  definition:=pg_get_functiondef('public.merge_duplicate_buildings_tx(uuid,integer,jsonb,integer[])'::regprocedure);
  execute replace(definition,'FUNCTION public.merge_duplicate_buildings_tx(',
    'FUNCTION private.merge_duplicate_buildings_before_assignment_guard(');
end $$;
revoke all on function private.merge_duplicate_buildings_before_assignment_guard(uuid,integer,jsonb,integer[]) from public,anon,authenticated;

create or replace function public.merge_duplicate_buildings_tx(
  p_token uuid,p_scope_card_id integer default null,p_name_overrides jsonb default '{}'::jsonb,
  p_selected_primary_ids integer[] default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare prior text; result jsonb;
begin
  prior:=current_setting('app.assignment_maintenance',true);
  perform set_config('app.assignment_maintenance','on',true);
  result:=private.merge_duplicate_buildings_before_assignment_guard(p_token,p_scope_card_id,p_name_overrides,p_selected_primary_ids);
  perform set_config('app.assignment_maintenance',coalesce(prior,''),true);
  return result;
end $$;
revoke all on function public.merge_duplicate_buildings_tx(uuid,integer,jsonb,integer[]) from public;
grant execute on function public.merge_duplicate_buildings_tx(uuid,integer,jsonb,integer[]) to anon,authenticated;

-- Substitute applications have the same closing/duplicate rules as self applications.
-- The existing parent-event lock serializes this check with other application RPCs.
do $$ declare definition text; needle text:='  rev:=public.assignment_revision(e);'; begin
  definition:=pg_get_functiondef('public.manage_event_participant_versioned_tx(uuid,integer,text,text,bigint,text)'::regprocedure);
  if position(needle in definition)=0 or position('applications_closed' in definition)>0 then
    raise exception 'Unexpected participant function';
  end if;
  execute replace(definition,needle,$guard$
  if p_action='add' then
    if not coalesce(e.allow_applications,true) then
      return jsonb_build_object('ok',false,'reason','applications_closed');
    end if;
    if exists(select 1 from public.event_cart_applications ca join public.app_users u on u.id=ca.user_id
      where ca.event_id=p_event_id and lower(private.normalize_person_name(u.name))=lower(private.normalize_person_name(p_user_name))) then
      return jsonb_build_object('ok',false,'reason','cart_application_exists');
    end if;
  end if;
  rev:=public.assignment_revision(e);$guard$);
end $$;
notify pgrst,'reload schema';
