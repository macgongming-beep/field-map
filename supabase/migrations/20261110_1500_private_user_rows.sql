-- Enforcement phase. Old PWAs must receive the directory/contact client first.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication_tables
    WHERE schemaname = 'public' AND tablename = 'app_users') THEN
    RAISE EXCEPTION 'app_users is published: review Realtime before restricting reads';
  END IF;
END $$;
DROP POLICY IF EXISTS app_users_self_admin_read ON public.app_users;
CREATE POLICY app_users_self_admin_read ON public.app_users
  AS RESTRICTIVE FOR SELECT TO anon, authenticated
  USING (id = (SELECT private.request_session_user_id())
    OR (SELECT private.request_is_admin()));
NOTIFY pgrst, 'reload schema';
