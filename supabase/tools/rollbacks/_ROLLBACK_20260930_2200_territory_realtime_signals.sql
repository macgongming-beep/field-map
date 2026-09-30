-- Disable VITE_TERRITORY_REALTIME_ENABLED and deploy the client before rollback.
drop trigger if exists signal_territory_building on public.buildings;
drop trigger if exists signal_territory_unit on public.units;
drop trigger if exists signal_territory_history on public.visit_histories;
drop trigger if exists signal_territory_regular on public.regular_visits;
drop trigger if exists signal_territory_access on public.building_access_events;
drop function if exists private.signal_territory_change();
drop function if exists private.touch_territory_signal(integer, integer);
drop table if exists public.territory_change_signals;
notify pgrst, 'reload schema';
