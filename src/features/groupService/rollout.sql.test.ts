// @vitest-environment node
import { PGlite } from '@electric-sql/pglite'
import { expect,test } from 'vitest'
import { buildGroupRolloutBundle, compatibilityReadinessSql } from '../../../scripts/groupServiceRolloutBundle.mjs'
import { rolloutFixture } from '../../../scripts/fixtures/groupRolloutFixture.mjs'

const token=(id:number)=>`00000000-0000-0000-0000-${String(id).padStart(12,'0')}`
const bundle=buildGroupRolloutBundle()
const rows=JSON.stringify([{userName:'Member',teamKey:'pair',cardIds:[10],cardScope:'전체',informalAssetIds:[]}])
async function actor(db:PGlite,id:number){await db.query("select set_config('test.token',$1,false)",[token(id)])}
async function transaction(db:PGlite,sql:string) {
  await db.exec('begin')
  try{await db.exec(sql);await db.exec('commit')}
  catch(error){await db.exec('rollback');throw error}
}
async function seed(db:PGlite) {
  await db.exec(`insert into app_users(id,name,role,group_name)values(1,'Admin','admin','东滩'),(2,'Leader','leader','东滩'),(3,'Other leader','leader','新葛'),(4,'Member','user','新葛'),(5,'Cart','user','东滩');
    insert into calendar_events(leader_name)values('Leader'),('Leader');insert into cards values(10);
    insert into event_participants(event_id,user_name)values(1,'Member');`)
  for(let id=1;id<=5;id++)await db.query("insert into auth_sessions values($1,$2,now()+interval '1 day')",[token(id),id])
  await actor(db,2)
}
async function revision(db:PGlite){return(await db.query<{r:number}>('select assignment_revision(e) r from calendar_events e where id=1')).rows[0].r}
async function save(db:PGlite,rev:number,who=2){return(await db.query<{r:{ok?:boolean;conflict?:boolean}}>('select save_event_assignments_versioned_tx($1,1,$2,$3,null,null) r',[token(who),rows,rev])).rows[0].r}
async function oldSave(db:PGlite){return db.query('select assign_team_service_bulk_tx($1,1,$2,null,null)',[token(2),rows])}

test.each([false,true])('full prepare -> mixed clients -> strict -> compatibility rollback (cart=%s)',async cart=>{
  const db=new PGlite()
  try{
    await db.exec(rolloutFixture(cart));await seed(db)
    expect((await db.query(compatibilityReadinessSql)).rows[0].readiness).toEqual({manifestInstalled:false,rolloutInstalled:false,compatRemovalExists:false,anonCanRemove:false,authenticatedCanRemove:false,notificationFeedExists:false,anonCanReadFeed:false,authenticatedCanReadFeed:false})
    // Install the entire generated artifact, not a special test-only migration order.
    let prepare=bundle.prepare
    if(process.env.GROUP_ROLLOUT_MUTATION==='cart')prepare=prepare.replace('if to_regclass(\'public.event_cart_applications\') is null then return; end if;','')
    if(process.env.GROUP_ROLLOUT_MUTATION==='compat')prepare=prepare.replace("select private.set_assignment_rollout_phase('compatibility','Prepare bundle: old clients retained; no strict adoption approval');",'')
    await transaction(db,prepare)
    expect((await db.query(compatibilityReadinessSql)).rows[0].readiness).toEqual({manifestInstalled:true,rolloutInstalled:true,compatRemovalExists:true,anonCanRemove:true,authenticatedCanRemove:true,notificationFeedExists:true,anonCanReadFeed:true,authenticatedCanReadFeed:true})
    await db.exec("insert into notifications(user_id,type,title) select 2,'comment','hidden' from generate_series(1,60);insert into notifications(user_id,type,title) values(2,'mention','visible'),(3,'mention','foreign')")
    await db.exec('set role anon')
    expect((await db.query('select title from get_my_notification_feed($1,50)',[token(2)])).rows).toEqual([{title:'visible'}])
    await db.exec('reset role')
    expect((await db.query('select phase from private.assignment_rollout')).rows).toEqual([{phase:'compatibility'}])
    await expect(transaction(db,bundle.prepare)).rejects.toThrow('unconverted')
    await db.exec('set role anon')
    await expect(db.query("select private.set_assignment_rollout_phase('strict','untrusted caller cannot switch stages')")).rejects.toThrow('permission')
    await expect(db.query('select * from private.assignment_rollout')).rejects.toThrow('permission')
    await expect(db.query('select * from private.service_cart_user_ids(array[1])')).rejects.toThrow('permission')
    await oldSave(db)
    const before=await revision(db)
    // Old writes bump the version, making a newer editor's stale save fail.
    await oldSave(db)
    expect(await revision(db)).toBeGreaterThan(before)
    expect(await save(db,before,3)).toMatchObject({conflict:true})
    expect(await save(db,await revision(db),3)).toMatchObject({ok:true})
    await db.exec("reset role;begin;insert into service_sessions(id,calendar_event_id,user_name,source,status)values(100,1,'Member','assigned','active'),(101,1,'Member','manual','active')")
    await actor(db,3);await db.exec('set role anon')
    expect((await db.query('delete from service_sessions returning id')).rows).toEqual([])
    await actor(db,2)
    expect((await db.query('delete from service_sessions returning id')).rows).toEqual([{id:100}])
    await db.exec('reset role;rollback')
    await actor(db,4);await db.exec('set role anon')
    expect((await db.query('select apply_service_activity_tx($1,2,\'return_visit\') r',[token(4)])).rows[0].r).toMatchObject({ok:true})
    await expect(db.query('select apply_service_activity_tx($1,2,\'service\')',[token(4)])).rejects.toThrow('Cancel existing')
    await db.exec('reset role;update calendar_events set allow_applications=false where id=2')
    await expect(db.query('select apply_service_activity_tx($1,2,\'service\')',[token(5)])).rejects.toThrow('closed')
    // Late staff/guest additions are allowed, but a real cart duplicate is not.
    if(cart)await db.exec('insert into event_cart_applications values(2,5)')
    const substitute=(await db.query('select manage_event_participant_versioned_tx($1,2,\'Cart\',\'add\',0) r',[token(3)])).rows[0].r
    expect(substitute).toMatchObject(cart?{ok:false,reason:'cart_application_exists'}:{ok:true})
    expect((await db.query('select manage_event_participant_versioned_tx($1,2,\'Guest\',\'add\',0,\'게스트\') r',[token(3)])).rows[0].r).toMatchObject({ok:true})
    await db.exec('update calendar_events set allow_applications=true where id=2')
    if(cart)await expect(db.query('select apply_service_activity_tx($1,2,\'service\')',[token(5)])).rejects.toThrow('cart application')
    // Ordinary schedule notifications must work without either cart table or columns.
    await db.exec("truncate test_notices;update calendar_events set end_time='16:45' where id=2")
    expect((await db.query('select distinct recipient from test_notices order by recipient')).rows).toEqual([{recipient:2},{recipient:4},{recipient:5}])
    const series=crypto.randomUUID()
    await db.query('update calendar_events set series_id=$1 where id=2',[series])
    await db.query('select update_calendar_event_series_tx($1,$2,\'2099-11-01\',\'{"end_time":"16:50"}\',true)',[token(1),series])
    expect((await db.query('select end_time from calendar_events where id=2')).rows).toEqual([{end_time:'16:50'}])
    // Existing notify_on_comment body is preserved, including target/mention split.
    await db.exec("truncate test_notices;insert into comments(target_type,target_id,author_id,author_name,content,mention_ids)values('calendar_event',2,1,'Admin','Test',array[4])")
    expect((await db.query('select recipient,kind from test_notices order by recipient')).rows).toEqual(cart?[{recipient:2,kind:'comment'},{recipient:4,kind:'mention'}]:[{recipient:2,kind:'comment'},{recipient:4,kind:'mention'},{recipient:5,kind:'comment'}])

    // Atomic generic removal cannot partially clean sessions/cards on a later failure.
    await db.exec("insert into service_sessions(calendar_event_id,user_name,source,status)values(1,'Member','assigned','active');create function public.test_stop_delete() returns trigger language plpgsql as $$begin raise exception 'injected failure';end$$;create trigger z_test_stop_delete after delete on event_participants for each row execute function public.test_stop_delete();")
    await expect(db.query('select remove_service_participant_compat_tx($1,1,\'Member\',false,null)',[token(3)])).rejects.toThrow('injected failure')
    expect((await db.query('select status from service_sessions')).rows).toEqual([{status:'active'}])
    expect((await db.query('select user_name from event_card_assignments')).rows).toEqual([{user_name:'Member'}])
    await db.exec('drop trigger z_test_stop_delete on event_participants')

    await expect(transaction(db,bundle.strict)).rejects.toThrow('rollout_evidence')
    await db.exec("set app.rollout_evidence='isolated fixture: mixed clients and backup reviewed'")
    await transaction(db,bundle.strict)
    expect((await db.query(compatibilityReadinessSql)).rows[0].readiness).toEqual({manifestInstalled:true,rolloutInstalled:true,compatRemovalExists:true,anonCanRemove:false,authenticatedCanRemove:false,notificationFeedExists:true,anonCanReadFeed:true,authenticatedCanReadFeed:true})
    await actor(db,2);await db.exec('set role anon')
    await expect(oldSave(db)).rejects.toThrow('permission')
    await expect(db.query('select remove_service_participant_compat_tx($1,1,\'Member\',false,null)',[token(2)])).rejects.toThrow('permission')
    expect((await db.query("delete from event_card_assignments where event_id=1 returning id")).rows).toHaveLength(0)
    expect((await db.query('select user_name from event_card_assignments')).rows).toEqual([{user_name:'Member'}])
    await db.exec('reset role')
    await expect(db.exec('delete from event_card_assignments where event_id=1')).rejects.toThrow('Versioned')
    await db.exec('set role anon')
    const current=await revision(db)
    expect(await save(db,current)).toMatchObject({ok:true})
    expect(await save(db,current,3)).toMatchObject({conflict:true})
    expect((await db.query("delete from service_sessions where calendar_event_id=1 returning id")).rows).toHaveLength(0)
    await actor(db,4)
    expect((await db.query('select manage_event_participant_versioned_tx($1,1,\'Member\',\'remove\',null) r',[token(4)])).rows[0].r).toMatchObject({ok:true})
    await db.exec('reset role')
    expect((await db.query('select * from event_card_assignments')).rows).toHaveLength(0)
    expect((await db.query('select id,status from service_sessions')).rows).toEqual([{id:1,status:'ended'}])
    await transaction(db,bundle.compatibility)
    expect((await db.query('select phase from private.assignment_rollout')).rows).toEqual([{phase:'compatibility'}])
    await db.exec("insert into event_participants(event_id,user_name)values(1,'Member')")
    await actor(db,2);await db.exec('set role anon')
    const shared=(await db.query<{t:string}>('select assignment_shared_at::text t from calendar_events where id=1')).rows[0].t
    expect((await db.query('select assign_team_service_bulk_tx($1,1,$2,null,$3) r',[token(2),rows,shared])).rows[0].r).toMatchObject({ok:true})
    expect((await db.query('select remove_service_participant_compat_tx($1,1,\'Member\',false,$2) r',[token(2),shared])).rows[0].r).toMatchObject({ok:true})
    await db.exec('reset role')
    expect((await db.query('select id,status from service_sessions')).rows).toEqual([{id:1,status:'ended'}])
  }finally{await db.close()}
},60000)

test('prepare failure rolls back schema and grants rather than exposing a half-installed strict stage',async()=>{
  const db=new PGlite()
  try{
    await db.exec(rolloutFixture(false));await seed(db)
    await expect(transaction(db,bundle.prepare+"\ndo $$begin raise exception 'injected install failure';end$$;")).rejects.toThrow('injected install failure')
    expect((await db.query("select to_regclass('public.service_groups') g,to_regclass('private.assignment_rollout') r")).rows).toEqual([{g:null,r:null}])
    await db.exec('set role anon');await oldSave(db)
    expect((await db.query('select user_name from event_card_assignments')).rows).toEqual([{user_name:'Member'}])
  }finally{await db.close()}
},60000)
