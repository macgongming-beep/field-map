// @vitest-environment node
import {readFileSync} from 'node:fs'
import {PGlite} from '@electric-sql/pglite'
import {beforeAll,beforeEach,afterAll,expect,test} from 'vitest'
let db:PGlite
const token=(id:number)=>`00000000-0000-0000-0000-${String(id).padStart(12,'0')}`
const cleanup=readFileSync('supabase/migrations/20260930_1600_atomic_team_participant_removal.sql','utf8').split('create or replace function public.remove_team_event_participant_tx')[0]
let migration=readFileSync('supabase/migrations/20261117_1000_assignment_and_schedule_permissions.sql','utf8')+readFileSync('supabase/migrations/20261117_1010_assignment_revisions.sql','utf8')+readFileSync('supabase/migrations/20261117_1100_assignment_revision_followup.sql','utf8')+readFileSync('supabase/migrations/20261117_1200_assignment_merge_and_application_guards.sql','utf8')
if(process.env.ASSIGNMENT_REVIEW_MUTATION==='revision')migration=migration.replaceAll('p_expected_revision is null or p_expected_revision<>rev','false')
if(process.env.ASSIGNMENT_REVIEW_MUTATION==='permission')migration=migration.replace("and u.role in ('admin','developer'));","and u.role in ('leader','admin','developer'));")
if(process.env.ASSIGNMENT_REVIEW_MUTATION==='maintenance')migration=migration.replace('not(guarded or maintenance or cascading)','not guarded')
if(process.env.ASSIGNMENT_REVIEW_MUTATION==='identity')migration=migration.replace('not private.event_participant_identity_allowed(p_user_name,p_role)','false')
if(process.env.ASSIGNMENT_REVIEW_MUTATION==='application')migration=migration.replace("if p_action='add' then\n    if not coalesce", "if false then\n    if not coalesce")
if(process.env.ASSIGNMENT_REVIEW_MUTATION==='merge')migration=migration.replace("perform set_config('app.assignment_maintenance','on',true);\n  result:=private.merge", "perform set_config('app.assignment_maintenance','',true);\n  result:=private.merge")
beforeAll(async()=>{
  db=new PGlite()
  await db.exec(`create role anon;create role authenticated;create schema private;
    create table app_users(id int primary key,name text unique,role text,group_name text,is_active boolean default true,approval_status text default 'approved');
    create table auth_sessions(token uuid,user_id int);
    create table service_groups(code text primary key,label_ko text,label_zh text,legacy_name text);
    insert into service_groups values('dongtan','동탄','东滩','东滩'),('singal','신갈','新葛','新葛');
    create table calendar_events(id serial primary key,event_date date default '2099-11-18',time text default '14:30',end_time text default '16:30',title text default 'Test',group_service_scope boolean default true,target_groups text[] default array['dongtan'],assignment_status text,assignment_shared_at timestamptz,assignment_team_scopes jsonb default '{}',assignment_team_informal jsonb);
    create table cards(id int primary key);create table informal_assets(id int primary key,archived boolean default false,parent_id int);create table buildings(id int primary key);create table units(id int primary key,building_id int references buildings on delete cascade);
    alter table calendar_events add allow_applications boolean default true;
    create table event_cart_applications(event_id int references calendar_events on delete cascade,user_id int references app_users on delete cascade);
    create table event_participants(id serial primary key,event_id int references calendar_events on delete cascade,user_name text,role text default '신청',service_activity text default 'service',unique(event_id,user_name));
    ${['event_card_assignments','event_card_assignment_cards','event_informal_assignments','event_restaurant_assignments'].map(t=>`create table ${t}(id serial primary key,event_id int references calendar_events on delete cascade,user_name text,team_key text,assigned_by text);alter table ${t} enable row level security;create policy existing_read on ${t} for select using(true);create policy group_service_scoped_read on ${t} as restrictive for select using(true);grant select,insert,update,delete on ${t} to anon;`).join('')}
    create table service_sessions(calendar_event_id int,user_name text,source text,status text,ended_at timestamptz);
    alter table event_card_assignments add assigned_card_id int references cards on delete cascade;
    alter table event_card_assignment_cards add card_id int references cards on delete cascade;
    alter table event_informal_assignments add asset_id int references informal_assets on delete cascade;
    alter table event_restaurant_assignments add building_id int references buildings on delete cascade,add unit_id int references units on delete cascade;
    alter table service_sessions enable row level security;
    create policy existing_session on service_sessions for all using(true) with check(true);grant all on service_sessions to anon;
    create function private.request_session_user_id() returns int language sql stable as $$ select nullif(current_setting('test.actor',true),'')::int $$;
    create function private.request_is_admin() returns boolean language sql security definer as $$select role in ('admin','developer') from public.app_users where id=private.request_session_user_id()$$;
    create function private.request_session_user_name() returns text language sql security definer as $$select name from public.app_users where id=private.request_session_user_id()$$;
    ${readFileSync('supabase/migrations/20260909_1000_guard_event_participant_identity.sql','utf8').split('-- 가입할')[0]}
    create function public.verify_session(t uuid) returns int language sql set search_path=public as $$select u.id from app_users u join auth_sessions s on s.user_id=u.id where s.token=t and u.is_active and u.approval_status='approved'$$;
    create function private.user_can_manage_event(integer,integer) returns boolean language sql as $$select true$$;
    create function public.can_read_group_service_row(integer,text default null) returns boolean language sql as $$select true$$;
    create function public.save_service_events_tx(p_token uuid,p_rows jsonb,p_request_id uuid,p_notify boolean) returns boolean language sql as $$select private.user_can_manage_event(public.verify_session(p_token),1)$$;
    create function public.update_calendar_event_tx(p_token uuid,p_event_id integer,p_payload jsonb,p_notify boolean) returns boolean language sql as $$select private.user_can_manage_event(public.verify_session(p_token),p_event_id)$$;
    create function public.update_calendar_event_series_tx(p_token uuid,p_series_id uuid,p_from_date date,p_payload jsonb,p_notify boolean) returns boolean language sql as $$select private.user_can_manage_event(public.verify_session(p_token),1)$$;
    create function public.assign_cards_bulk_tx(uuid,integer,jsonb,text,text) returns jsonb language sql as $$select '{}'::jsonb$$;
    create function public.assign_scoped_cards_bulk_tx(uuid,integer,jsonb,text,text) returns jsonb language sql as $$select '{}'::jsonb$$;
    create function public.remove_team_event_participant_tx(uuid,integer,text,boolean,text) returns jsonb language sql as $$select '{}'::jsonb$$;
    create function public.rename_user_name_references(p_token uuid,p_old text,p_new text) returns jsonb language plpgsql security definer as $$begin
      if public.verify_session(p_token)<>1 then raise exception 'permission';end if;
      update public.event_participants set user_name=p_new where user_name=p_old;
      update public.event_card_assignments set user_name=p_new where user_name=p_old;
      return '{"ok":true}'::jsonb;end$$;
    create function public.purge_user_name_references(p_token uuid,p_name text) returns jsonb language plpgsql security definer as $$begin
      if public.verify_session(p_token)<>1 then raise exception 'permission';end if;
      delete from public.event_participants where user_name=p_name;
      delete from public.event_card_assignments where user_name=p_name;
      return '{"ok":true}'::jsonb;end$$;
    create function public.assign_team_service_bulk_tx(p_token uuid,p_event_id integer,p_assignments jsonb,p_status text,p_expected_shared_at text) returns jsonb language plpgsql security definer set search_path=public as $$declare a jsonb;begin
      if not private.user_can_manage_event(public.verify_session(p_token),p_event_id) then raise exception 'permission';end if;
      delete from event_card_assignments where event_id=p_event_id;
      for a in select value from jsonb_array_elements(p_assignments) loop insert into event_card_assignments(event_id,user_name,team_key,assigned_by) values(p_event_id,a->>'userName',a->>'teamKey',(select name from app_users where id=public.verify_session(p_token)));end loop;
      update calendar_events set assignment_team_informal='{}',assignment_status=p_status where id=p_event_id;
      return jsonb_build_object('ok',true);
    end$$;
    create function public.merge_duplicate_buildings_tx(p_token uuid,p_scope_card_id integer default null,p_name_overrides jsonb default '{}',p_selected_primary_ids integer[] default null) returns jsonb language plpgsql security definer as $$begin
      if public.verify_session(p_token) is distinct from 1 then raise exception 'permission';end if;
      delete from public.event_restaurant_assignments a where building_id=21 and exists(select 1 from public.event_restaurant_assignments b where b.building_id=20 and b.event_id=a.event_id and b.user_name=a.user_name);
      update public.event_restaurant_assignments set building_id=20 where building_id=21;
      delete from public.buildings where id=21;
      return '{"ok":true}'::jsonb;end$$;
    ${cleanup}
    ${migration}
    grant usage on schema private to anon;
  `)
},30000)
afterAll(async()=>{await db.close()})
beforeEach(async()=>{
  await db.exec(`reset role;set test.actor='1';select set_config('app.assignment_write_event','',false);set app.assignment_maintenance='on';
    truncate app_users,auth_sessions,calendar_events,cards,informal_assets,buildings,units,service_sessions restart identity cascade;
    insert into app_users(id,name,role,group_name) values(1,'Admin','admin','东滩'),(2,'Leader A','leader','东滩'),(3,'Leader B','leader','新葛'),(4,'Member','user','新葛'),(5,'Partner','user','东滩'),(6,'Other','user','东滩');
    insert into calendar_events(target_groups) values(array['dongtan']),(array['singal']);
    insert into calendar_events(group_service_scope) values(false);
    set app.assignment_write_event='1';insert into event_participants(event_id,user_name) values(1,'Member'),(1,'Partner'),(1,'Other');
    set app.assignment_write_event='3';insert into event_participants(event_id,user_name) values(3,'Member');set app.assignment_write_event='';set app.assignment_maintenance='';`)
  for(let i=1;i<=6;i++)await db.query('insert into auth_sessions values($1,$2)',[token(i),i])
})
async function rev(id=1){return (await db.query<{r:number}>('select assignment_revision(e) r from calendar_events e where id=$1',[id])).rows[0].r}
const rows=[{userName:'Member',teamKey:'pair'},{userName:'Partner',teamKey:'pair'},{userName:'Other',teamKey:'other'}]
async function save(actor=2,revision:unknown=undefined,id=1,status:string|null='shared'){
  return (await db.query<{r:{ok:boolean;conflict?:boolean}}>('select save_event_assignments_versioned_tx($1,$2,$3,$4,$5,null) r',[token(actor),id,JSON.stringify(rows),revision===undefined?await rev(id):revision,status])).rows[0].r
}
test('leaders arrange all groups and congregation; schedule wrappers allow only admins',async()=>{
  for(const id of [1,2,3]){
    expect((await db.query('select private.user_can_manage_event(2,$1) arrange,private.user_can_edit_event(2,$1) edit',[id])).rows[0]).toEqual({arrange:true,edit:false})
    expect((await db.query('select update_calendar_event_tx($1,$2,\'{}\',false) allowed',[token(2),id])).rows[0]).toEqual({allowed:false})
  }
  expect((await db.query('select save_service_events_tx($1,\'[]\',$2,false) allowed',[token(2),crypto.randomUUID()])).rows[0]).toEqual({allowed:false})
  expect((await db.query('select update_calendar_event_series_tx($1,$2,current_date,\'{}\',false) allowed',[token(2),crypto.randomUUID()])).rows[0]).toEqual({allowed:false})
  expect((await save(3)).ok).toBe(true)
  expect((await save(3,undefined,3)).ok).toBe(true)
  await expect(save(4)).rejects.toThrow('permission')
  await db.exec('update app_users set is_active=false where id=3')
  await expect(save(3)).rejects.toThrow('permission')
})
test('two unpublished saves with the same revision cannot overwrite; missing revision fails closed',async()=>{
  const base=await rev()
  expect((await save(2,base,1,null)).ok).toBe(true)
  expect((await save(3,base,1,null)).conflict).toBe(true)
  expect((await save(3,null)).conflict).toBe(true)
  expect((await db.query('select distinct assigned_by from event_card_assignments')).rows).toEqual([{assigned_by:'Leader A'}])
})
test('membership changes invalidate an open draft; participant removal uses same revision',async()=>{
  await save()
  const base=await rev()
  await db.query('select manage_event_participant_versioned_tx($1,1,\'Other\',\'remove\',$2,\'신청\')',[token(3),base])
  expect(await rev()).toBe(base+1)
  expect((await save(2,base)).conflict).toBe(true)
  expect((await db.query('select manage_event_participant_versioned_tx($1,1,\'Partner\',\'remove\',$2,\'신청\') r',[token(3),base])).rows[0].r).toMatchObject({conflict:true})
  expect((await db.query("select user_name from event_participants where event_id=1 order by user_name")).rows).toEqual([{user_name:'Member'},{user_name:'Partner'}])
})
test('foreign member reads shared teammates only, never other teams or unpublished assignments',async()=>{
  await save()
  await db.exec("set test.actor='4';set role anon")
  expect((await db.query('select user_name from event_card_assignments order by user_name')).rows).toEqual([{user_name:'Member'},{user_name:'Partner'}])
  await db.exec("reset role;update calendar_events set assignment_status='confirmed' where id=1;set role anon")
  expect((await db.query('select * from event_card_assignments')).rows).toEqual([])
  await db.exec("set test.actor='2'")
  expect((await db.query('select * from event_card_assignments')).rows).toHaveLength(3)
})
test('unversioned RPCs and raw assignment writes cannot bypass the lock',async()=>{
  await db.exec("set test.actor='2';set role anon")
  await expect(db.query('select assign_team_service_bulk_tx($1,1,\'[]\',null,null)',[token(2)])).rejects.toThrow('permission')
  await expect(db.query("delete from event_card_assignments where event_id=1")).resolves.toBeDefined()
  await db.exec('reset role')
  await save()
  await expect(db.query("delete from event_card_assignments where event_id=1")).rejects.toThrow('Versioned')
})
test('new application leaves draft valid; self cancellation needs neither current nor present revision',async()=>{
  const base=await rev()
  await db.exec("set test.actor='2';insert into event_participants(event_id,user_name)values(1,'Leader A')")
  expect(await rev()).toBe(base)
  await save(2,base)
  const r=await db.query('select manage_event_participant_versioned_tx($1,1,\'Member\',\'remove\',null) r',[token(4)])
  expect(r.rows[0].r).toMatchObject({ok:true,changed:true})
  expect((await db.query("select * from event_card_assignments where user_name='Member'")).rows).toHaveLength(0)
  await expect(db.query('select manage_event_participant_versioned_tx($1,1,\'Partner\',\'remove\',null)',[token(4)])).rejects.toThrow('permission')
})
test('participant RPC enforces account versus guest identity and canonical account spelling',async()=>{
  for(const [name,role] of [['Missing','신청'],['Member','게스트']]){
    await expect(db.query('select manage_event_participant_versioned_tx($1,1,$2,\'add\',$3,$4)',[token(2),name,await rev(),role])).rejects.toThrow('identity')
  }
  await db.query('select manage_event_participant_versioned_tx($1,2,\' member \',\'add\',$2,\'신청\')',[token(2),await rev(2)])
  expect((await db.query('select user_name from event_participants where event_id=2')).rows).toEqual([{user_name:'Member'}])
  await expect(db.exec("update event_participants set role='입명' where event_id=1 and user_name='Member'")).rejects.toThrow('Versioned')
})
test('maintenance keeps existing authorization and invalidates drafts instead of blocking rename or cleanup',async()=>{
  await save();const before=await rev()
  await expect(db.query('select rename_user_name_references($1,\'Member\',\'Renamed\')',[token(2)])).rejects.toThrow('permission')
  await db.query('select rename_user_name_references($1,\'Member\',\'Renamed\')',[token(1)])
  expect((await db.query("select user_name from event_card_assignments where user_name='Renamed'")).rows).toHaveLength(1)
  expect(await rev()).toBeGreaterThan(before)
  expect((await db.query("select current_setting('app.assignment_maintenance',true) v")).rows[0].v).not.toBe('on')
  await db.query('select purge_user_name_references($1,\'Renamed\')',[token(1)])
  expect((await db.query("select user_name from event_card_assignments where user_name='Renamed'")).rows).toHaveLength(0)
  expect((await db.query("select has_function_privilege('anon','private.rename_user_name_references_before_assignment_guard(uuid,text,text)','execute') v")).rows[0].v).toBe(false)
})
test('card and schedule cascade deletion succeeds while arbitrary direct assignment deletion stays blocked',async()=>{
  await save();await db.exec("insert into cards values(20);set app.assignment_write_event='1';update event_card_assignments set assigned_card_id=20 where event_id=1;insert into event_card_assignment_cards(event_id,user_name,card_id)values(1,'Member',20);set app.assignment_write_event=''")
  const before=await rev()
  await db.exec('delete from cards where id=20')
  expect((await db.query('select * from event_card_assignments')).rows).toHaveLength(0)
  expect(await rev()).toBeGreaterThan(before)
  await save();await expect(db.exec('delete from event_card_assignments')).rejects.toThrow('Versioned')
  await db.exec('delete from calendar_events where id=1')
  expect((await db.query('select * from event_card_assignments')).rows).toHaveLength(0)
})
test('personal assignments reject stale or removed targets and resource FK cleanup remains allowed',async()=>{
  await db.exec('insert into informal_assets(id)values(10);insert into buildings values(20);insert into units values(30,20)')
  const personal=(kind:string,revision:number,name='Member')=>db.query('select mutate_personal_assignment_versioned_tx($1,1,$2,$3,\'add\',$4,$5,$6) r',[token(2),revision,kind,name,kind==='informal'?10:20,kind==='informal'?null:30])
  const base=await rev()
  expect((await personal('restaurant',base)).rows[0].r).toMatchObject({ok:true})
  expect((await personal('informal',base)).rows[0].r).toMatchObject({conflict:true})
  await expect(personal('restaurant',await rev(),'Missing')).rejects.toThrow('eligible')
  await expect(db.exec("insert into event_restaurant_assignments(event_id,user_name,building_id)values(1,'Member',20)")).rejects.toThrow('Versioned')
  await personal('informal',await rev())
  const beforeDelete=await rev()
  await db.exec('delete from informal_assets where id=10;delete from buildings where id=20')
  expect(await rev()).toBeGreaterThan(beforeDelete)
  expect((await db.query('select * from event_restaurant_assignments')).rows).toHaveLength(0)
})
test('leaders cannot rewrite or delete other people service sessions, owners and admins still can',async()=>{
  await db.exec("insert into service_sessions values(1,'Member','assigned','active',null);set test.actor='2';set role anon")
  expect((await db.query("update service_sessions set status='ended' returning *")).rows).toHaveLength(0)
  expect((await db.query('delete from service_sessions returning *')).rows).toHaveLength(0)
  await db.exec("set test.actor='4'")
  expect((await db.query("update service_sessions set status='ended' returning *")).rows).toHaveLength(1)
  await db.exec("set test.actor='1'")
  expect((await db.query('delete from service_sessions returning *')).rows).toHaveLength(1)
})

test('substitute applications enforce closing and same-event cart checks for admins and leaders',async()=>{
  const add=(actor:number,name='Leader A',role='신청')=>db.query<{r:unknown}>('select manage_event_participant_versioned_tx($1,1,$2,\'add\',$3,$4) r',[token(actor),name,0,role])
  await db.exec('update calendar_events set allow_applications=false where id=1')
  for(const actor of [1,2]){
    expect((await add(actor)).rows[0].r).toMatchObject({ok:false,reason:'applications_closed'})
    expect((await add(actor,'Guest','게스트')).rows[0].r).toMatchObject({ok:false,reason:'applications_closed'})
  }
  await db.exec('update calendar_events set allow_applications=true where id=1;insert into event_cart_applications values(1,2)')
  for(const actor of [1,2])expect((await add(actor,' leader a ')).rows[0].r).toMatchObject({ok:false,reason:'cart_application_exists'})
  expect(await rev()).toBe(0)
  expect((await db.query("select * from event_participants where user_name='Leader A'")).rows).toHaveLength(0)
  expect((await db.query('select * from event_cart_applications')).rows).toHaveLength(1)
  await db.exec('update event_cart_applications set event_id=2')
  expect((await add(2)).rows[0].r).toMatchObject({ok:true})
  await db.exec('update calendar_events set allow_applications=false where id=1')
  expect((await db.query('select manage_event_participant_versioned_tx($1,1,\'Leader A\',\'remove\',null) r',[token(2)])).rows[0].r).toMatchObject({ok:true})
})

test('building merge preserves authorization, moves restaurant assignments and invalidates drafts',async()=>{
  await db.exec("insert into buildings values(20),(21);set app.assignment_maintenance='on';insert into event_restaurant_assignments(event_id,user_name,building_id)values(1,'Member',20),(1,'Member',21),(1,'Partner',21);set app.assignment_maintenance=''")
  const before=await rev()
  await expect(db.query('select merge_duplicate_buildings_tx($1)',[token(2)])).rejects.toThrow('permission')
  await db.query('select merge_duplicate_buildings_tx($1)',[token(1)])
  expect((await db.query('select user_name,building_id from event_restaurant_assignments order by user_name')).rows).toEqual([{user_name:'Member',building_id:20},{user_name:'Partner',building_id:20}])
  expect(await rev()).toBeGreaterThan(before)
  expect((await save(2,before)).conflict).toBe(true)
  expect((await db.query("select current_setting('app.assignment_maintenance',true) v")).rows[0].v).not.toBe('on')
  expect((await db.query("select has_function_privilege('anon','private.merge_duplicate_buildings_before_assignment_guard(uuid,integer,jsonb,integer[])','execute') v")).rows[0].v).toBe(false)
})
