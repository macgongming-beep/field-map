// @vitest-environment node
import {readFileSync} from 'node:fs'
import {PGlite} from '@electric-sql/pglite'
import {beforeAll,beforeEach,afterAll,expect,test} from 'vitest'
let db:PGlite
const token=(id:number)=>`00000000-0000-0000-0000-${String(id).padStart(12,'0')}`
const cleanup=readFileSync('supabase/migrations/20260930_1600_atomic_team_participant_removal.sql','utf8').split('create or replace function public.remove_team_event_participant_tx')[0]
let migration=readFileSync('supabase/migrations/20261117_1000_assignment_and_schedule_permissions.sql','utf8')+readFileSync('supabase/migrations/20261117_1010_assignment_revisions.sql','utf8')
if(process.env.ASSIGNMENT_REVIEW_MUTATION==='revision')migration=migration.replaceAll('p_expected_revision is null or p_expected_revision<>rev','false')
if(process.env.ASSIGNMENT_REVIEW_MUTATION==='permission')migration=migration.replace("and u.role in ('admin','developer'));","and u.role in ('leader','admin','developer'));")
beforeAll(async()=>{
  db=new PGlite()
  await db.exec(`create role anon;create role authenticated;create schema private;
    create table app_users(id int primary key,name text unique,role text,group_name text,is_active boolean default true,approval_status text default 'approved');
    create table auth_sessions(token uuid,user_id int);
    create table service_groups(code text primary key,label_ko text,label_zh text,legacy_name text);
    insert into service_groups values('dongtan','동탄','东滩','东滩'),('singal','신갈','新葛','新葛');
    create table calendar_events(id serial primary key,event_date date default '2099-11-18',time text default '14:30',end_time text default '16:30',title text default 'Test',group_service_scope boolean default true,target_groups text[] default array['dongtan'],assignment_status text,assignment_shared_at timestamptz,assignment_team_scopes jsonb default '{}',assignment_team_informal jsonb);
    create table event_participants(id serial primary key,event_id int references calendar_events on delete cascade,user_name text,role text default '신청',unique(event_id,user_name));
    ${['event_card_assignments','event_card_assignment_cards','event_informal_assignments','event_restaurant_assignments'].map(t=>`create table ${t}(id serial primary key,event_id int references calendar_events on delete cascade,user_name text,team_key text,assigned_by text);alter table ${t} enable row level security;create policy existing_read on ${t} for select using(true);create policy group_service_scoped_read on ${t} as restrictive for select using(true);grant select,insert,update,delete on ${t} to anon;`).join('')}
    create table service_sessions(calendar_event_id int,user_name text,source text,status text,ended_at timestamptz);
    create function private.request_session_user_id() returns int language sql stable as $$ select nullif(current_setting('test.actor',true),'')::int $$;
    create function public.verify_session(t uuid) returns int language sql set search_path=public as $$select u.id from app_users u join auth_sessions s on s.user_id=u.id where s.token=t and u.is_active and u.approval_status='approved'$$;
    create function private.user_can_manage_event(integer,integer) returns boolean language sql as $$select true$$;
    create function public.can_read_group_service_row(integer,text default null) returns boolean language sql as $$select true$$;
    create function public.save_service_events_tx(p_token uuid,p_rows jsonb,p_request_id uuid,p_notify boolean) returns boolean language sql as $$select private.user_can_manage_event(public.verify_session(p_token),1)$$;
    create function public.update_calendar_event_tx(p_token uuid,p_event_id integer,p_payload jsonb,p_notify boolean) returns boolean language sql as $$select private.user_can_manage_event(public.verify_session(p_token),p_event_id)$$;
    create function public.update_calendar_event_series_tx(p_token uuid,p_series_id uuid,p_from_date date,p_payload jsonb,p_notify boolean) returns boolean language sql as $$select private.user_can_manage_event(public.verify_session(p_token),1)$$;
    create function public.assign_cards_bulk_tx(uuid,integer,jsonb,text,text) returns jsonb language sql as $$select '{}'::jsonb$$;
    create function public.assign_scoped_cards_bulk_tx(uuid,integer,jsonb,text,text) returns jsonb language sql as $$select '{}'::jsonb$$;
    create function public.remove_team_event_participant_tx(uuid,integer,text,boolean,text) returns jsonb language sql as $$select '{}'::jsonb$$;
    create function public.assign_team_service_bulk_tx(p_token uuid,p_event_id integer,p_assignments jsonb,p_status text,p_expected_shared_at text) returns jsonb language plpgsql security definer set search_path=public as $$declare a jsonb;begin
      if not private.user_can_manage_event(public.verify_session(p_token),p_event_id) then raise exception 'permission';end if;
      delete from event_card_assignments where event_id=p_event_id;
      for a in select value from jsonb_array_elements(p_assignments) loop insert into event_card_assignments(event_id,user_name,team_key,assigned_by) values(p_event_id,a->>'userName',a->>'teamKey',(select name from app_users where id=public.verify_session(p_token)));end loop;
      update calendar_events set assignment_team_informal='{}',assignment_status=p_status where id=p_event_id;
      return jsonb_build_object('ok',true);
    end$$;
    ${cleanup}
    ${migration}
    grant usage on schema private to anon;
  `)
},30000)
afterAll(async()=>{await db.close()})
beforeEach(async()=>{
  await db.exec(`reset role;set test.actor='1';select set_config('app.assignment_write_event','',false);
    truncate app_users,auth_sessions,calendar_events restart identity cascade;
    insert into app_users(id,name,role,group_name) values(1,'Admin','admin','东滩'),(2,'Leader A','leader','东滩'),(3,'Leader B','leader','新葛'),(4,'Member','user','新葛'),(5,'Partner','user','东滩'),(6,'Other','user','东滩');
    insert into calendar_events(target_groups) values(array['dongtan']),(array['singal']);
    insert into calendar_events(group_service_scope) values(false);
    insert into event_participants(event_id,user_name) values(1,'Member'),(1,'Partner'),(1,'Other'),(3,'Member');`)
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
