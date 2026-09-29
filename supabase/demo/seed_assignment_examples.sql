-- Demo-only additive fixture. Run with psql --single-transaction.
-- Existing data is never reset; a repeated run skips this fixture batch.
do $$
declare
  i integer; j integer; k integer; v_kind integer;
  v_card integer; v_building integer; v_group integer; v_parent integer;
  v_lat double precision; v_lng double precision;
  v_region text; v_label text; v_type text; v_usage text; v_number text;
  v_restaurant boolean; v_polygon jsonb;
begin
  if not exists (select 1 from public.app_private_settings where key='environment' and value='test') then
    raise exception 'Demo environment required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('demo-assignment-examples-v1',0));
  if exists (select 1 from public.cards where name like '%배분테스트%') then
    raise notice 'Assignment fixtures already exist; keeping all current data';
    return;
  end if;
  perform set_config('app.suppress_notifications','true',true);
  insert into public.territory_regions(name,city,sort_order)
  select '배분테스트구','테스트시',20
  where not exists (select 1 from public.territory_regions where name='배분테스트구');

  for i in 1..6 loop
    v_kind := (i-1)%3;
    v_label := case v_kind when 0 then '주택' when 1 then '상가' else '혼합' end;
    v_region := case when i<=3 then '테스트구' else '배분테스트구' end;
    v_lat := 37.270 + ((i-1)/3)*0.004;
    v_lng := 127.125 + ((i-1)%3)*0.004;
    insert into public.cards(name,area,region,type,status)
    values (v_region||' 배분테스트 '||v_label||' '||i,'배분테스트동',v_region,'전체','미배정') returning id into v_card;
    v_polygon := jsonb_build_array(
      jsonb_build_object('lat',v_lat-0.001,'lng',v_lng-0.001),
      jsonb_build_object('lat',v_lat-0.001,'lng',v_lng+0.0015),
      jsonb_build_object('lat',v_lat+0.0015,'lng',v_lng+0.0015),
      jsonb_build_object('lat',v_lat+0.0015,'lng',v_lng-0.001));
    insert into public.card_boundaries(card_id,points) values(v_card,v_polygon);
    -- Both active demo leaders can exercise distribution of the new cards.
    insert into public.card_leader_assignments(card_id,user_name)
    select v_card,name from public.app_users where role='leader' and is_active and approval_status='approved';
    for j in 1..2 loop
      v_type := case when v_kind=1 then '상가' else '주택' end;
      insert into public.buildings(card_id,name,address,type,lat,lng,memo)
      values(v_card,'배분테스트 '||v_label||'건물 '||i||'-'||j,
        '테스트시 '||v_region||' 배분테스트로 '||(i*100+j),v_type,
        v_lat+(j-1)*0.0006,v_lng+(j-1)*0.0006,'가상 주소와 좌표를 사용한 배분 연습용 건물입니다.')
      returning id into v_building;
      for k in 1..4 loop
        v_usage := case when v_kind=1 or (v_kind=2 and k<=2) then '상가' else '주택' end;
        v_restaurant := v_usage='상가' and j=1 and k=1;
        v_number := case when v_restaurant then '배분테스트 식당 '||i
          when v_usage='상가' then '배분테스트 점포 '||j||'-'||k
          else (100*j+k)::text end;
        insert into public.units(building_id,number,status,is_chinese,is_restaurant,usage_type,memo)
        values(v_building,v_number,'미방문',true,v_restaurant,v_usage,'배분 연습용 가상 세대');
      end loop;
    end loop;
  end loop;

  insert into public.informal_groups(name,position,created_by)
  values('배분테스트 비공식',20,'데모 테스트 자료') returning id into v_group;
  for i in 1..3 loop
    v_lat := 37.280 + i*0.001;
    v_lng := 127.125 + i*0.002;
    insert into public.informal_assets(name,image_url,image_path,uploaded_by,group_id,kind,lat,lng,memo,zoom,boundary)
    values('배분테스트 비공식 '||i,'','','데모 테스트 자료',v_group,'비공식구역',v_lat,v_lng,
      '실제 봉사 장소가 아닌 가상 연습 카드입니다.',17,
      jsonb_build_array(jsonb_build_object('lat',v_lat-0.0004,'lng',v_lng-0.0004),
        jsonb_build_object('lat',v_lat-0.0004,'lng',v_lng+0.0008),
        jsonb_build_object('lat',v_lat+0.0008,'lng',v_lng+0.0008),
        jsonb_build_object('lat',v_lat+0.0008,'lng',v_lng-0.0004)))
    returning id into v_parent;
    insert into public.informal_assets(name,image_url,image_path,uploaded_by,group_id,parent_id,kind,lat,lng,memo)
    values('배분테스트 거점 '||i,'','','데모 테스트 자료',v_group,v_parent,'거점',v_lat,v_lng,'가상 연습 장소'),
      ('배분테스트 대화장소 '||i,'','','데모 테스트 자료',v_group,v_parent,'대화장소',v_lat+0.0004,v_lng+0.0004,'가상 연습 장소');
  end loop;
  if (select count(*) from public.cards where name like '%배분테스트%') <> 6
     or (select count(*) from public.units u join public.buildings b on b.id=u.building_id where b.name like '배분테스트 %') <> 48 then
    raise exception 'Unexpected fixture counts';
  end if;
end $$;

select c.name,
  count(*) filter(where coalesce(u.usage_type,b.type)='주택') as residential,
  count(*) filter(where coalesce(u.usage_type,b.type)='상가') as commercial,
  count(*) filter(where u.is_restaurant) as restaurants
from public.cards c join public.buildings b on b.card_id=c.id join public.units u on u.building_id=b.id
where c.name like '%배분테스트%' group by c.id,c.name order by c.id;
