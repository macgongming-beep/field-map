-- Additive phase: deploy the directory/contact clients before restricting app_users.
CREATE OR REPLACE FUNCTION public.get_user_directory()
RETURNS TABLE(id integer, name text, role text, approval_status text, is_active boolean,
  group_name text, cart_service_approved boolean, cart_service_approved_at timestamptz,
  created_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF private.request_session_user_id() IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT u.id, u.name, u.role, u.approval_status, u.is_active,
    u.group_name, u.cart_service_approved, u.cart_service_approved_at, u.created_at
  FROM public.app_users u
  WHERE u.role <> 'developer' AND u.name <> '개발자'
    AND coalesce(u.login_id, '') <> '개발자'
  ORDER BY u.created_at DESC, u.id;
END $$;
REVOKE ALL ON FUNCTION public.get_user_directory() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_user_directory() TO anon, authenticated;

-- Only the current leaders of an existing event are exposed, never a caller's list of user IDs.
CREATE OR REPLACE FUNCTION public.get_event_leader_contacts(p_event_id integer)
RETURNS TABLE(id integer, name text, phone text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF private.request_session_user_id() IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT u.id, u.name, u.phone
  FROM public.app_users u
  WHERE coalesce(u.is_active, true) AND coalesce(u.approval_status, 'approved') = 'approved'
    AND EXISTS (
      SELECT 1 FROM public.calendar_events e,
        unnest(string_to_array(coalesce(e.leader_name, ''), ',')) AS leader(name)
      WHERE e.id = p_event_id
        AND lower(regexp_replace(btrim(leader.name), '\s+', ' ', 'g'))
          = lower(regexp_replace(btrim(u.name), '\s+', ' ', 'g'))
    )
  ORDER BY u.id;
END $$;
REVOKE ALL ON FUNCTION public.get_event_leader_contacts(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_event_leader_contacts(integer) TO anon, authenticated;
NOTIFY pgrst, 'reload schema';
