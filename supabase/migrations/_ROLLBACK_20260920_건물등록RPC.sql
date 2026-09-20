-- create_building_tx만 제거한다. 이 함수로 생성된 건물 자료는 보존한다.
drop function if exists public.create_building_tx(
  uuid, integer, text, text, text, double precision, double precision
);

notify pgrst, 'reload schema';
