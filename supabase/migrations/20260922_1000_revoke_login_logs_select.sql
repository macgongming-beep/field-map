-- 로그인 기록은 get_login_logs RPC로만 읽는다.
-- 과거 설치에서 남을 수 있는 표 단위와 컬럼 단위 SELECT 권한을 모두 회수한다.

revoke select on public.login_logs from anon, authenticated;
revoke select (id, user_id, logged_in_at) on public.login_logs from anon, authenticated;

do $$
begin
  if has_table_privilege('anon', 'public.login_logs', 'select')
     or has_table_privilege('authenticated', 'public.login_logs', 'select')
     or exists (
       select 1
       from information_schema.column_privileges
       where table_schema = 'public'
         and table_name = 'login_logs'
         and grantee in ('anon', 'authenticated')
         and privilege_type = 'SELECT'
     ) then
    raise exception 'login_logs 직접 SELECT 권한이 남아 있습니다';
  end if;
end $$;

notify pgrst, 'reload schema';
