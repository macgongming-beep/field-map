import assert from 'node:assert/strict'
import {readFileSync,writeFileSync} from 'node:fs'
import {parseEnv} from 'node:util'
import {spawnSync} from 'node:child_process'
const config=parseEnv(readFileSync(process.env.DEMO_ENV_FILE,'utf8'))
const project='itjlykpjmlcvanqpmkmc',db=new URL(config.SUPABASE_DB_URL)
assert.equal(config.VITE_SUPABASE_URL,`https://${project}.supabase.co`)
assert.equal(decodeURIComponent(db.username),`postgres.${project}`)
assert.ok(db.hostname.endsWith('.pooler.supabase.com'));assert.equal(db.port,'5432')
const f=JSON.parse(readFileSync('scratch/group-tabs-fixture.json','utf8'))
assert.ok(f.actors.every(a=>a.name.startsWith('gt_demo_')))
const response=await fetch(`${config.VITE_SUPABASE_URL}/rest/v1/rpc/auth_login`,{method:'POST',headers:{apikey:config.VITE_SUPABASE_ANON_KEY,'Content-Type':'application/json'},body:JSON.stringify({p_login_id:config.TEST_LOGIN_ID,p_pin:config.TEST_LOGIN_PIN})})
assert.ok(response.ok);const [admin]=await response.json()
const q=s=>`'${String(s).replaceAll("'","''")}'`,[leader,, , ,member,partner,,newMember]=f.actors
const headers=a=>`set local request.headers=${q(JSON.stringify({'x-session-token':a.token}))};`
const rows=JSON.stringify([member,partner].map(a=>({userName:a.name,teamKey:'pair',cardIds:[f.cardIds[0]],cardScope:'전체',informalAssetIds:[]})))
// All fixture mutations, including account deactivation and FK cascades, roll back.
const setup=`begin;
set local app.suppress_notifications='on';${headers(admin)}
create function pg_temp.expect(value boolean,label text) returns void language plpgsql as $$begin
 if value is distinct from true then raise exception 'FAILED: %',label;end if;raise notice 'PASS: %',label;end$$;
create temp table test_context(event_id integer,session_id integer,revision bigint,asset_id integer,building_id integer);
with e as (
 insert into calendar_events(event_date,time,title,leader_name) values('2099-11-18','14:30','assignment_followup_transaction',${q(leader.name)}) returning id)
 insert into test_context(event_id) select id from e;
set local app.assignment_maintenance='on';
insert into event_participants(event_id,user_name,role) select event_id,n,'신청' from test_context cross join unnest(array[${q(member.name)},${q(partner.name)}]) n;
set local app.assignment_maintenance='';
select pg_temp.expect((save_event_assignments_versioned_tx(${q(leader.token)},event_id,${q(rows)},0,null,null)->>'ok')::boolean,'seed real bulk assignment') from test_context;
insert into service_sessions(user_name,calendar_event_id,time_slot,source) select ${q(member.name)},event_id,'오후','assigned' from test_context;
update test_context set session_id=(select id from service_sessions where calendar_event_id=test_context.event_id limit 1),revision=(select assignment_revision(e) from calendar_events e where e.id=test_context.event_id);
grant select on test_context to anon;
savepoint maintenance;
update app_users set name=${q(member.name+'_renamed')} where name=${q(member.name)};
select rename_user_name_references(${q(admin.token)},${q(member.name)},${q(member.name+'_renamed')});
select pg_temp.expect((select count(*)=1 from event_card_assignments a where a.event_id=c.event_id and a.user_name=${q(member.name+'_renamed')}) and (select count(*)=1 from event_card_assignment_cards a where a.event_id=c.event_id and a.user_name=${q(member.name+'_renamed')}) and (select assignment_revision(e)>c.revision from calendar_events e where e.id=c.event_id),'actual rename preserves both assignment tables and increments revision') from test_context c;
select pg_temp.expect(coalesce(current_setting('app.assignment_maintenance',true),'')='','maintenance flag restored');
rollback to maintenance;
select deactivate_app_user_tx(${q(admin.token)},(select id from app_users where name=${q(member.name)}),'Synthetic rollback verification');
select pg_temp.expect(not exists(select 1 from event_card_assignments a where a.event_id=c.event_id and a.user_name=${q(member.name)}) and exists(select 1 from service_sessions s where s.id=c.session_id),'actual deactivation cleans assignments, preserves session ID') from test_context c;
rollback to maintenance;
delete from cards where id=${Number(f.cardIds[0])};
select pg_temp.expect(not exists(select 1 from event_card_assignments a where a.event_id=c.event_id) and (select assignment_revision(e)>c.revision from calendar_events e where e.id=c.event_id),'card cascade succeeds and invalidates draft') from test_context c;
rollback to maintenance;
${headers(newMember)}
select apply_service_activity_tx(${q(newMember.token)},event_id,'service') from test_context;
select pg_temp.expect((select assignment_revision(e)=c.revision from calendar_events e where e.id=c.event_id),'new application leaves open draft valid') from test_context c;
select pg_temp.expect((manage_event_participant_versioned_tx(${q(newMember.token)},event_id,${q(newMember.name)},'remove',null)->>'ok')::boolean,'self cancellation needs no revision') from test_context;
rollback to maintenance;
${headers(leader)}
set local role anon;
with changed as (update service_sessions set memo='forbidden' where id=(select session_id from test_context) returning id) select pg_temp.expect(count(*)=0,'leader cannot change another persons session') from changed;
with changed as (delete from service_sessions where id=(select session_id from test_context) returning id) select pg_temp.expect(count(*)=0,'leader cannot delete another persons session') from changed;
reset role;${headers(member)}set local role anon;
with changed as (update service_sessions set memo='own' where id=(select session_id from test_context) returning id) select pg_temp.expect(count(*)=1,'member can edit own session') from changed;
reset role;${headers(admin)}set local role anon;
with changed as (update service_sessions set memo='admin' where id=(select session_id from test_context) returning id) select pg_temp.expect(count(*)=1,'admin can edit session') from changed;
reset role;rollback to maintenance;
${headers(leader)}
do $$declare eid integer;r bigint;rejected boolean:=false;begin
 select event_id,revision into eid,r from test_context;
 begin perform manage_event_participant_versioned_tx(${q(leader.token)},eid,'no_such_followup_user','add',r);exception when check_violation then rejected:=true;end;
 perform pg_temp.expect(rejected,'unknown applicant rejected by real RPC');rejected:=false;
 begin perform manage_event_participant_versioned_tx(${q(leader.token)},eid,${q(member.name)},'add',r,'게스트');exception when check_violation then rejected:=true;end;
 perform pg_temp.expect(rejected,'real user cannot be impersonated as guest');
 perform manage_event_participant_versioned_tx(${q(leader.token)},eid,${q(member.name)},'remove',r);
 select assignment_revision(e) into r from calendar_events e where id=eid;
 rejected:=false;
 begin perform save_event_assignments_versioned_tx(${q(leader.token)},eid,${q(rows)},r,null,(select assignment_shared_at::text from calendar_events where id=eid));exception when others then rejected:=true;end;
 perform pg_temp.expect(rejected,'even a fresh revision cannot restore a removed member');
end$$;
rollback to maintenance;
update calendar_events set assignment_team_informal=null where id=(select event_id from test_context);
with a as(insert into informal_assets(name,image_url,image_path) values('assignment_followup_transaction','','') returning id) update test_context set asset_id=(select id from a);
with b as(insert into buildings(card_id,name,address,type,lat,lng) values(${Number(f.cardIds[0])},'assignment_followup_transaction','synthetic','상가',0,0) returning id) update test_context set building_id=(select id from b);
select pg_temp.expect((mutate_personal_assignment_versioned_tx(${q(leader.token)},event_id,revision,'informal','add',${q(member.name)},asset_id)->>'ok')::boolean,'personal informal assignment checks revision') from test_context;
select pg_temp.expect((mutate_personal_assignment_versioned_tx(${q(leader.token)},event_id,revision,'restaurant','add',${q(member.name)},building_id)->>'conflict')::boolean,'stale personal assignment cannot overwrite') from test_context;
update test_context set revision=(select assignment_revision(e) from calendar_events e where id=test_context.event_id);
select pg_temp.expect((mutate_personal_assignment_versioned_tx(${q(leader.token)},event_id,revision,'restaurant','add',${q(member.name)},building_id)->>'ok')::boolean,'restaurant assignment uses same lock and revision') from test_context;
delete from informal_assets where id=(select asset_id from test_context);
delete from buildings where id=(select building_id from test_context);
select pg_temp.expect(not exists(select 1 from event_informal_assignments where event_id=c.event_id) and not exists(select 1 from event_restaurant_assignments where event_id=c.event_id),'asset and building FK cleanup remains available') from test_context c;
rollback to maintenance;
${headers(admin)}
update calendar_events set allow_applications=false where id=(select event_id from test_context);
select pg_temp.expect(manage_event_participant_versioned_tx(${q(leader.token)},event_id,${q(newMember.name)},'add',revision)->>'reason'='applications_closed','substitute leader respects application closing') from test_context;
select pg_temp.expect(manage_event_participant_versioned_tx(${q(admin.token)},event_id,${q(newMember.name)},'add',revision)->>'reason'='applications_closed','admin substitute respects application closing') from test_context;
select pg_temp.expect((manage_event_participant_versioned_tx(${q(member.token)},event_id,${q(member.name)},'remove',null)->>'ok')::boolean,'self cancellation still works after closing') from test_context;
rollback to maintenance;
${headers(admin)}
insert into event_cart_applications(event_id,user_id) select event_id,${Number(newMember.id)} from test_context;
select pg_temp.expect(manage_event_participant_versioned_tx(${q(leader.token)},event_id,${q(newMember.name)},'add',revision)->>'reason'='cart_application_exists','substitute checks same-event cart application') from test_context;
select pg_temp.expect(manage_event_participant_versioned_tx(${q(admin.token)},event_id,${q(newMember.name)},'add',revision)->>'reason'='cart_application_exists','admin cannot bypass cart duplicate') from test_context;
select pg_temp.expect(exists(select 1 from event_cart_applications a where a.event_id=c.event_id and a.user_id=${Number(newMember.id)}) and not exists(select 1 from event_participants p where p.event_id=c.event_id and p.user_name=${q(newMember.name)}) and (select assignment_revision(e)=c.revision from calendar_events e where e.id=c.event_id),'denied addition preserves cart application and revision') from test_context c;
delete from event_cart_applications where event_id=(select event_id from test_context);
select pg_temp.expect((manage_event_participant_versioned_tx(${q(leader.token)},event_id,${q(newMember.name)},'add',revision)->>'ok')::boolean,'substitute succeeds once duplicate is removed') from test_context;
rollback to maintenance;
${headers(admin)}
create temp table merge_fixture(id integer);
with b as(insert into buildings(card_id,name,address,type,lat,lng) values
 (${Number(f.cardIds[0])},'merge_review_keep','경기도 용인시 데모검증로 99999','상가',0,0),
 (${Number(f.cardIds[0])},'merge_review_absorb','경기도 용인시 데모검증로 99999','상가',0,0) returning id) insert into merge_fixture select id from b;
set local app.assignment_maintenance='on';
insert into event_restaurant_assignments(event_id,user_name,building_id,assigned_by)
 select c.event_id,${q(member.name)},b.id,${q(leader.name)} from test_context c cross join merge_fixture b;
insert into event_restaurant_assignments(event_id,user_name,building_id,assigned_by)
 select event_id,${q(partner.name)},(select max(id) from merge_fixture),${q(leader.name)} from test_context;
set local app.assignment_maintenance='';
update test_context set revision=(select assignment_revision(e) from calendar_events e where e.id=test_context.event_id);
savepoint before_merge;
do $$declare rejected boolean:=false;begin
 begin perform merge_duplicate_buildings_tx(${q(leader.token)},${Number(f.cardIds[0])},'{}',array[(select min(id) from merge_fixture)]);exception when others then rejected:=true;end;
 perform pg_temp.expect(rejected,'real merge remains administrator-only');end$$;
select merge_duplicate_buildings_tx(${q(admin.token)},${Number(f.cardIds[0])},'{}',array[(select min(id) from merge_fixture)]);
select pg_temp.expect((select count(*)=2 and bool_and(building_id=(select min(id) from merge_fixture)) from event_restaurant_assignments a where a.event_id=c.event_id) and not exists(select 1 from buildings where id=(select max(id) from merge_fixture)),'actual merge deduplicates and moves restaurant assignments') from test_context c;
select pg_temp.expect((select assignment_revision(e)>c.revision from calendar_events e where e.id=c.event_id) and (save_event_assignments_versioned_tx(${q(leader.token)},c.event_id,${q(rows)},c.revision,null,null)->>'conflict')::boolean,'merge invalidates open assignment draft') from test_context c;
select pg_temp.expect(coalesce(current_setting('app.assignment_maintenance',true),'')='','real merge restores maintenance flag');
rollback to before_merge;
select merge_selected_duplicate_buildings_tx(${q(admin.token)},${Number(f.cardIds[0])},'{}',array[(select min(id) from merge_fixture)],'{}');
select pg_temp.expect((select count(*)=2 and bool_and(building_id=(select min(id) from merge_fixture)) from event_restaurant_assignments a where a.event_id=c.event_id),'selected-candidate merge also uses guarded core') from test_context c;
rollback;`
const result=spawnSync('psql',['-X','-qAt','-v','ON_ERROR_STOP=1'],{input:setup,encoding:'utf8',env:{...process.env,PGHOST:db.hostname,PGPORT:db.port,PGUSER:decodeURIComponent(db.username),PGDATABASE:db.pathname.slice(1),PGPASSWORD:decodeURIComponent(db.password),PGSSLMODE:'require',PGCONNECT_TIMEOUT:'15'}})
if(result.error||result.status){let error=result.stderr;for(const actor of [admin,...f.actors])error=error.replaceAll(actor.token,'[redacted]');throw result.error??Error(error)}
const checks=result.stderr.split('\n').filter(s=>s.includes('PASS:')).map(s=>s.split('PASS: ')[1])
assert.equal(checks.length,30)
writeFileSync('scratch/assignment-maintenance-smoke.json',JSON.stringify({project,checks,rolledBack:true},null,2),{mode:0o600})
console.log(JSON.stringify({project,passed:checks.length,rolledBack:true}))
