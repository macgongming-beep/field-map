-- Some production databases have not installed the optional cart feature.
-- Keep the same fixed public projection without requiring its two columns.
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
    u.group_name, (to_jsonb(u)->>'cart_service_approved')::boolean,
    (to_jsonb(u)->>'cart_service_approved_at')::timestamptz, u.created_at
  FROM public.app_users u
  WHERE u.role <> 'developer' AND u.name <> '개발자'
    AND coalesce(u.login_id, '') <> '개발자'
  ORDER BY u.created_at DESC, u.id;
END $$;
REVOKE ALL ON FUNCTION public.get_user_directory() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_user_directory() TO anon, authenticated;
NOTIFY pgrst, 'reload schema';
