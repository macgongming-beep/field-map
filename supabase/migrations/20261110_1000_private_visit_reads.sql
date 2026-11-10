-- First privacy boundary only: keep every logged-in role's current read scope.
-- Apply using psql --single-transaction after backup. No data or write policy changes.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
      AND tablename IN ('visit_histories', 'return_visits', 'return_visit_logs')
  ) THEN
    RAISE EXCEPTION 'Private detail tables still published: review Realtime consumers before applying';
  END IF;
END $$;

ALTER TABLE public.visit_histories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.return_visits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.return_visit_logs ENABLE ROW LEVEL SECURITY;

-- Restrictive policies intersect with all permissive SELECT policies, including
-- legacy USING(true) rules. The existing helper rejects absent/expired sessions
-- and inactive/unapproved accounts without extending or mutating the session.
DROP POLICY IF EXISTS visit_histories_require_session_read ON public.visit_histories;
CREATE POLICY visit_histories_require_session_read ON public.visit_histories
  AS RESTRICTIVE FOR SELECT TO anon, authenticated
  USING ((SELECT private.request_session_user_id()) IS NOT NULL);

DROP POLICY IF EXISTS return_visits_require_session_read ON public.return_visits;
CREATE POLICY return_visits_require_session_read ON public.return_visits
  AS RESTRICTIVE FOR SELECT TO anon, authenticated
  USING ((SELECT private.request_session_user_id()) IS NOT NULL);

DROP POLICY IF EXISTS return_visit_logs_require_session_read ON public.return_visit_logs;
CREATE POLICY return_visit_logs_require_session_read ON public.return_visit_logs
  AS RESTRICTIVE FOR SELECT TO anon, authenticated
  USING ((SELECT private.request_session_user_id()) IS NOT NULL);

NOTIFY pgrst, 'reload schema';
