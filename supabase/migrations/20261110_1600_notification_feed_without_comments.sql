-- Additive reader: keep the old RPC, stored notifications, and push pipeline.
-- Filtering after the old RPC would let hidden comments consume its LIMIT.
CREATE OR REPLACE FUNCTION public.get_my_notification_feed(p_token uuid, p_limit integer DEFAULT 50)
RETURNS SETOF public.notifications
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_user_id integer;
BEGIN
  v_user_id := public.verify_session(p_token);
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Invalid session' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT n.* FROM public.notifications n
    WHERE n.user_id = v_user_id AND n.type <> 'comment'
    ORDER BY n.created_at DESC, n.id DESC
    LIMIT least(greatest(coalesce(p_limit, 50), 0), 100);
END;
$function$;

REVOKE ALL ON FUNCTION public.get_my_notification_feed(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_notification_feed(uuid, integer) TO anon, authenticated;
NOTIFY pgrst, 'reload schema';
