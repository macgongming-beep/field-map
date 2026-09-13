-- 테스트 DB 씨앗. **여러 번 돌려도 같은 결과가 되게** 만들었다 (지우고 다시 넣는다).
--
-- ⚠⚠ 이 파일은 **표식이 있는 DB 에서만** 돈다. ⚠⚠
--
--   처음에는 '사용자가 5명 넘으면 중단' 으로 막았는데, 그건 막지 못한다.
--   **새 회중은 첫 관리자 한 명으로 시작한다.** 그대로 통과해서, 공개된
--   테스트 개발자 계정이 남의 운영 DB 에 생길 수 있다.
--
--   그래서 사람 수 대신 **일부러 심은 표식**을 본다. 테스트 DB 에 한 번만
--   손으로 넣는다. 운영에는 절대 넣지 않는다.
--
--     insert into public.app_private_settings (key, value)
--     values ('environment', 'test');
--
--   app_private_settings 는 anon/authenticated 가 못 읽는다 (deny_all 정책).
--
-- 넣는 것: 관리자 1 · 지역 1 · 카드 2 · 건물 2 · 호수 4 · 방문기록 2 ·
--          정기방문 1 · 특별봉사 기간 1
-- test-admin 계정과 비밀번호는 이 파일이 만들지 않는다.
-- 비밀번호는 .env.test.local 의 TEST_LOGIN_PIN 에만 둔다.

do $$
declare v_env text;
begin
  select value into v_env
  from public.app_private_settings
  where key = 'environment';

  if coalesce(v_env, '') <> 'test' then
    raise exception
      '이 DB 에는 테스트 표식이 없습니다 — 중단합니다. '
      '테스트 DB 라면 app_private_settings 에 environment=test 를 먼저 넣으세요. '
      '(운영에는 절대 넣지 마세요)';
  end if;
end $$;

-- ── 지우기 (자식부터) ────────────────────────────────────────────
delete from public.visit_histories where visitor_name = 'test-admin';
delete from public.regular_visits where visitor_name = 'test-admin';
delete from public.units where building_id in (select id from public.buildings where name like 'T-%');
delete from public.buildings where name like 'T-%';
delete from public.cards where name like '테스트구 %';
delete from public.territory_regions where name = '테스트구';
delete from public.special_periods where label = '테스트 특별봉사';

-- ── 관리자 ──────────────────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from public.app_users
    where login_id = 'test-admin'
      and role = 'developer'
      and approval_status = 'approved'
      and is_active
  ) then
    raise exception '비공개 test-admin 개발자 계정을 먼저 만드세요';
  end if;
end $$;

-- ── 지역 · 카드 ─────────────────────────────────────────────────
insert into public.territory_regions (name, city, sort_order)
values ('테스트구', '테스트시', 1);

insert into public.cards (name, area, region, type, status)
values ('테스트구 한동 1', '한동', '테스트구', '전체', '미배정'),
       ('테스트구 두동 1', '두동', '테스트구', '전체', '미배정');

-- ── 건물 · 호수 ─────────────────────────────────────────────────
insert into public.buildings (card_id, name, address, type, lat, lng)
select id, 'T-한동빌라', '테스트시 테스트구 한동로 1', '주택', 37.5, 127.1
from public.cards where name = '테스트구 한동 1';

insert into public.buildings (card_id, name, address, type, lat, lng)
select id, 'T-두동상가', '테스트시 테스트구 두동로 2', '상가', 37.6, 127.2
from public.cards where name = '테스트구 두동 1';

-- 호수 표기를 일부러 섞는다 — 운영 데이터가 그렇다 (101 / 101호)
insert into public.units (building_id, number, status, is_chinese)
select id, x.n, '미방문', true
from public.buildings b
cross join (values ('101'), ('102호')) as x(n)
where b.name = 'T-한동빌라';

insert into public.units (building_id, number, status, is_chinese)
select id, x.n, '미방문', true
from public.buildings b
cross join (values ('201호'), ('B02')) as x(n)
where b.name = 'T-두동상가';

-- ── 방문 기록 · 정기방문 ────────────────────────────────────────
insert into public.visit_histories (unit_id, visitor_name, result, time_slot, memo, visited_at)
select u.id, 'test-admin', '부재', '오후', '씨앗 데이터', current_date - 3
from public.units u join public.buildings b on b.id = u.building_id
where b.name = 'T-한동빌라' and u.number = '101';

insert into public.visit_histories (unit_id, visitor_name, result, time_slot, memo, visited_at)
select u.id, 'test-admin', '만남', '저녁', '씨앗 데이터', current_date - 1
from public.units u join public.buildings b on b.id = u.building_id
where b.name = 'T-두동상가' and u.number = '201호';

insert into public.regular_visits (unit_id, visitor_name)
select u.id, 'test-admin'
from public.units u join public.buildings b on b.id = u.building_id
where b.name = 'T-두동상가' and u.number = '201호';

-- ── 특별봉사 기간 ────────────────────────────────────────────────
-- smoke 가 '조용히 빈 결과' 를 잡으려면 여기에 반드시 한 건이 있어야 한다.
-- RLS 가 잘못 켜지면 이 표가 에러 없이 0건이 되고, 화면에서 시즌이 사라진다.
insert into public.special_periods (label, start_date, end_date, color)
values ('테스트 특별봉사', current_date - 7, current_date + 7, '#7c3aed');

-- ── 확인 ────────────────────────────────────────────────────────
select '사용자' as 항목, count(*) from public.app_users where login_id = 'test-admin'
union all select '지역', count(*) from public.territory_regions where name = '테스트구'
union all select '카드', count(*) from public.cards where name like '테스트구 %'
union all select '건물', count(*) from public.buildings where name like 'T-%'
union all select '호수', count(*) from public.units u join public.buildings b on b.id = u.building_id where b.name like 'T-%'
union all select '방문기록', count(*) from public.visit_histories where visitor_name = 'test-admin'
union all select '정기방문', count(*) from public.regular_visits where visitor_name = 'test-admin'
union all select '특별봉사', count(*) from public.special_periods where label = '테스트 특별봉사'
order by 1;
