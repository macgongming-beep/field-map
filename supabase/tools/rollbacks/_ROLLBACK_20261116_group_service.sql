-- Demo rollback only; deploy old app first. New service metadata and meeting secrets are removed.
DROP TRIGGER on_calendar_event_update ON public.calendar_events;
DROP TRIGGER service_event_guard ON public.calendar_events;
CREATE OR REPLACE FUNCTION public.notify_on_calendar_event_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_recipient_ids integer[]; v_link text;
begin
  if coalesce(current_setting('app.suppress_notifications',true),'')='on' or new.event_date<current_date then return new; end if;
  if old.event_date is not distinct from new.event_date
    and old.time is not distinct from new.time
    and old.place is not distinct from new.place
    and old.meeting_map_url is not distinct from new.meeting_map_url
    and old.leader_name is not distinct from new.leader_name
    and old.title is not distinct from new.title then return new; end if;
  -- 신청자와 쉼표 목록의 인도자를 각각 풀어야 공동 인도 일정도 빠지지 않는다.
  select array_agg(distinct recipient_id) into v_recipient_ids from (
    select u.id recipient_id from public.event_participants ep join public.app_users u on u.name=ep.user_name where ep.event_id=new.id
    union select ca.user_id from public.event_cart_applications ca where ca.event_id=new.id
    union select unnest(public.user_ids_in_name_list(new.leader_name))
  ) recipients
  where recipient_id is not null
    and recipient_id is distinct from nullif(current_setting('app.actor_id',true),'')::integer;
  v_recipient_ids:=public.filter_notification_recipients(v_recipient_ids,'event_change');
  if v_recipient_ids is null or cardinality(v_recipient_ids)=0 then return new; end if;
  v_link:='/calendar?openChat='||new.id;
  -- 푸시도 앱 알림과 같은 필터를 거친 수신자 목록만 사용한다.
  perform public.insert_notifications(v_recipient_ids,'event_change','일정이 변경되었습니다',new.title||' · '||new.event_date||' '||new.time,v_link,new.id);
  perform public.dispatch_push_notification(v_recipient_ids,'event_change','일정이 변경되었습니다',new.title||' · '||new.event_date||' '||new.time,v_link,new.id);
  return new;
end;
$function$

CREATE OR REPLACE FUNCTION public.update_calendar_event_series_tx(p_token uuid, p_series_id uuid, p_from_date date, p_payload jsonb, p_notify boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_actor_id integer; v_actor_role text; v_result jsonb;
begin
  v_actor_id:=public.verify_session(p_token);
  if v_actor_id is null then raise exception '세션이 유효하지 않습니다'; end if;
  select role into v_actor_role from public.app_users where id=v_actor_id;
  if v_actor_role not in ('leader','admin','developer') then raise exception '반복 일정을 고칠 권한이 없습니다'; end if;
  -- 구현 함수가 모든 대상 행을 먼저 잠그고 회차별 권한을 검사한다.
  v_result:=public.update_calendar_event_series_tx_impl_20260907(p_token,p_series_id,p_from_date,p_payload,p_notify);
  if p_payload ? 'allow_cart_applications' or p_payload ? 'cart_capacity' then
    update public.calendar_events e set
      allow_cart_applications=case when p_payload ? 'allow_cart_applications' then (p_payload->>'allow_cart_applications')::boolean else e.allow_cart_applications end,
      cart_capacity=case when p_payload ? 'cart_capacity' then nullif(p_payload->>'cart_capacity','')::integer else e.cart_capacity end
    where e.series_id=p_series_id and e.event_date>=p_from_date;
  end if;
  return v_result;
end;
$function$
CREATE TRIGGER on_calendar_event_update AFTER UPDATE OF event_date, "time", place, meeting_map_url, leader_name, title ON public.calendar_events FOR EACH ROW EXECUTE FUNCTION notify_on_calendar_event_change();
DROP FUNCTION public.save_service_events_tx(uuid,jsonb,uuid,boolean);
DROP FUNCTION public.get_event_meeting_access(integer);
DROP FUNCTION public.get_event_application_overlaps(integer);
DROP FUNCTION private.guard_service_event();
DROP FUNCTION private.service_event_notify(jsonb,integer[],integer,integer[]);
DROP FUNCTION private.validate_service_event_input(jsonb);
DROP TABLE public.event_meeting_access;
DROP TABLE private.service_event_imports;
ALTER TABLE public.calendar_events DROP COLUMN service_kind,DROP COLUMN target_groups,DROP COLUMN primary_leader_user_id,DROP COLUMN meeting_mode,DROP COLUMN edit_version;
DROP TABLE public.service_groups;
NOTIFY pgrst,'reload schema';
