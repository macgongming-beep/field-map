-- Apply with psql --single-transaction, after backing up the target DB.
-- This is server enforcement, not a client feature flag.
create table if not exists private.login_attempt_guard (
  user_id integer primary key references public.app_users(id) on delete cascade,
  failed_attempts integer not null default 0 check (failed_attempts between 0 and 5),
  window_started_at timestamptz,
  locked_until timestamptz
);
revoke all on private.login_attempt_guard from public, anon, authenticated;
alter table private.login_attempt_guard enable row level security;

-- Two-argument clients use the defaults of the guarded four-argument RPC.
drop function if exists public.auth_login(text, text);
create or replace function public.auth_login(
  p_login_id text, p_pin text,
  p_device_label text default null, p_user_agent text default null
)
returns table (token uuid, id integer, name text, login_id text, role text, approval_status text)
language plpgsql security definer
set search_path = ''
as $$
declare
  v_user public.app_users%rowtype;
  v_guard private.login_attempt_guard%rowtype;
  v_now timestamptz;
  v_token uuid;
  v_login text := btrim(coalesce(p_login_id, ''));
  v_dummy_hash constant text := '$2a$06$R9h/cIPz0gi.URNNX3kh2OPST9/PgBkqquzi.Ss7KIUgO2t0jWMUW';
begin
  if v_login = '' or length(v_login) > 256 or length(coalesce(p_pin, '')) > 1024 then
    return;
  end if;

  -- Serialize by the canonical account, including the legacy name fallback.
  -- The wall clock is read AFTER waiting for the lock, never transaction-start time.
  select u.* into v_user from public.app_users u
  where u.login_id = v_login or (u.login_id is null and u.name = v_login)
  order by (u.login_id = v_login) desc nulls last, u.id
  limit 1 for update;
  if not found then
    perform extensions.crypt(coalesce(p_pin, ''), v_dummy_hash);
    return;
  end if;

  insert into private.login_attempt_guard(user_id) values (v_user.id)
  on conflict (user_id) do nothing;
  select g.* into v_guard from private.login_attempt_guard g where g.user_id = v_user.id;
  v_now := clock_timestamp();
  if v_guard.locked_until > v_now then
    -- Identical failure shape; attempts during the lock never extend its deadline.
    perform extensions.crypt(coalesce(p_pin, ''), coalesce(v_user.pin, v_dummy_hash));
    return;
  end if;

  if v_guard.locked_until is not null
     or v_guard.window_started_at is null
     or v_guard.window_started_at <= v_now - interval '15 minutes' then
    v_guard.failed_attempts := 0;
    v_guard.window_started_at := v_now;
  end if;

  if p_pin is null or p_pin = '' or v_user.pin is null
     or v_user.pin <> extensions.crypt(p_pin, v_user.pin) then
    v_guard.failed_attempts := v_guard.failed_attempts + 1;
    update private.login_attempt_guard g
    set failed_attempts = v_guard.failed_attempts,
        window_started_at = v_guard.window_started_at,
        locked_until = case when v_guard.failed_attempts >= 5 then v_now + interval '15 minutes' else null end
    where g.user_id = v_user.id;
    -- Do not raise: an exception would roll back the failed-attempt write.
    return;
  end if;

  update private.login_attempt_guard g
  set failed_attempts = 0, window_started_at = null, locked_until = null
  where g.user_id = v_user.id;

  -- Preserve existing pending/blocked UI only after proving the password.
  if coalesce(v_user.approval_status, 'approved') <> 'approved' or v_user.is_active is false then
    return query select null::uuid, v_user.id, v_user.name, coalesce(v_user.login_id, v_user.name), v_user.role,
      case when v_user.is_active is false then 'blocked' else v_user.approval_status end;
    return;
  end if;
  insert into public.auth_sessions(user_id, device_label, user_agent)
  values (v_user.id, nullif(btrim(coalesce(p_device_label, '')), ''), nullif(btrim(coalesce(p_user_agent, '')), ''))
  returning auth_sessions.token into v_token;
  update public.app_users u set last_login_at = now() where u.id = v_user.id;
  if to_regclass('public.login_logs') is not null then
    insert into public.login_logs(user_id, logged_in_at) values (v_user.id, now());
  end if;
  return query select v_token, v_user.id, v_user.name, coalesce(v_user.login_id, v_user.name),
    v_user.role, coalesce(v_user.approval_status, 'approved');
end;
$$;
revoke all on function public.auth_login(text, text, text, text) from public;
grant execute on function public.auth_login(text, text, text, text) to anon, authenticated;

-- Keep the logged-in directory and its existing column grants. Never expose it
-- before custom-session authentication, even if another permissive SELECT exists.
drop policy if exists app_users_select_all on public.app_users;
create policy app_users_select_all on public.app_users for select to anon, authenticated
  using ((select private.request_session_user_id()) is not null);
drop policy if exists app_users_require_session_read on public.app_users;
create policy app_users_require_session_read on public.app_users as restrictive for select to anon, authenticated
  using ((select private.request_session_user_id()) is not null);

notify pgrst, 'reload schema';
