-- 새 회중 전용 템플릿.
-- 회중 책임자가 값을 확인한 뒤 자기 Supabase SQL Editor에서 실행한다.
-- 현재 운영 DB에는 별도 이관 파일로 자기 설정을 넣었다. 공용 코드는 중립값으로 시작한다.

insert into public.app_settings (key, value)
values (
  'congregation_profile',
  jsonb_build_object(
    'name', '새 회중 이름',
    'province', '경기도',
    'provinceShort', '경기',
    'defaultCity', '수원시',
    'mapCenter', jsonb_build_object('lat', 37.2636, 'lng', 127.0286),
    -- 전체 회중 외곽선이 아직 없으면 빈 배열. 다른 회중에 용인 경계를 복사하지 않는다.
    'territoryBoundary', jsonb_build_array(),
    -- 지역 관리의 구·시 번역 외에 동·읍·면 번역이 필요할 때만 추가한다.
    'placeNames', jsonb_build_array(
      jsonb_build_array('팔달구', '八达区', 'Paldal-gu')
    )
  )::text
)
on conflict (key) do update set value = excluded.value;
