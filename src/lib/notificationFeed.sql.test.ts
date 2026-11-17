// @vitest-environment node
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, expect, test } from 'vitest'

let db: PGlite
const original = readFileSync('supabase/migrations/20261110_1600_notification_feed_without_comments.sql', 'utf8')
const migration = process.env.NOTIFICATION_FEED_MUTATION === 'filter'
  ? original.replace("AND n.type <> 'comment'", '')
  : process.env.NOTIFICATION_FEED_MUTATION === 'owner'
    ? original.replace('n.user_id = v_user_id', 'true') : original
const token = '00000000-0000-0000-0000-000000000001'
beforeAll(async () => {
  db = new PGlite()
  await db.exec(`
    create role anon; create role authenticated;
    create table notifications(id serial primary key, user_id int, type text not null,
      title text, body text, link text, related_id int, is_read boolean default false,
      created_at timestamptz default now());
    create function verify_session(p_token uuid) returns int language plpgsql as $$
    begin
      if p_token = '${token}' then return 1; end if;
      if p_token is null then return null; end if;
      raise exception 'Invalid session';
    end; $$;
    insert into notifications(user_id,type,title,created_at)
      select 1,'comment','hidden','2026-11-10' from generate_series(1,60);
    insert into notifications(user_id,type,title,created_at) values
      (1,'mention','mention','2026-11-09'),(1,'event_change','event','2026-11-09'),
      (1,'assignment','assignment','2026-11-08'),(1,'notice','notice','2026-11-08'),
      (1,'chat','chat','2026-11-08'),(2,'mention','someone else','2026-11-11');
    create table app_users(id int primary key, name text);
    insert into app_users values(1,'reader'),(2,'writer'),(3,'mentioned');
    create table calendar_events(id int primary key, leader_name text);
    insert into calendar_events values(1,'reader');
    create table event_participants(event_id int, user_name text);
    create table comments(id serial primary key, target_type text, target_id int,
      author_id int, author_name text, content text, mention_ids int[]);
    create table push_calls(user_ids int[], type text, link text, related_id int);
    create function get_comment_target_author_id(text,int) returns int language sql as $$select null::int$$;
    create function insert_notifications(int[],text,text,text,text,int) returns void language sql as $$
      insert into notifications(user_id,type,title,body,link,related_id)
      select unnest($1),$2,$3,$4,$5,$6;
    $$;
    create function dispatch_push_notification(int[],text,text,text,text,int) returns void language sql as $$
      insert into push_calls values($1,$2,$5,$6);
    $$;
  `)
  const baseline = readFileSync('supabase/baseline.sql', 'utf8')
  const start = baseline.indexOf('CREATE OR REPLACE FUNCTION public.get_my_notifications(')
  expect(start).toBeGreaterThan(-1)
  await db.exec(baseline.slice(start, baseline.indexOf('\nCREATE OR REPLACE FUNCTION', start + 1)))
  await db.exec(readFileSync('supabase/migrations/20260826_2500_comment_notify_participants.sql', 'utf8'))
  await db.exec('create trigger notify_comment after insert on comments for each row execute function notify_on_comment()')
  await db.exec(migration)
}, 30_000)
afterAll(async () => { await db?.close() })

test('filters before LIMIT; preserves mentions and all other types, isolates owner and orders ties', async () => {
  await db.exec('set role anon')
  try {
    const result = await db.query<{ title: string }>(`select title from get_my_notification_feed('${token}',2)`)
    expect(result.rows.map(r => r.title)).toEqual(['event', 'mention'])
    const all = await db.query<{ type: string }>(`select type from get_my_notification_feed('${token}')`)
    expect(all.rows.map(r => r.type).sort()).toEqual(['assignment', 'chat', 'event_change', 'mention', 'notice'])
    await expect(db.query('select * from notifications')).rejects.toThrow(/permission denied/)
  } finally { await db.exec('reset role') }
})

test.each(['null', "'00000000-0000-0000-0000-000000000099'"])('rejects missing/invalid session %s', async input => {
  await expect(db.query(`select * from get_my_notification_feed(${input})`)).rejects.toThrow('Invalid session')
})

test('old RPC is intact and new reads do not delete or mark hidden rows', async () => {
  const before = (await db.query('select * from notifications order by id')).rows
  expect((await db.query(`select * from get_my_notifications('${token}',50)`)).rows).toHaveLength(50)
  await db.query(`select * from get_my_notification_feed('${token}')`)
  expect((await db.query('select * from notifications order by id')).rows).toEqual(before)
  expect((await db.query(`select * from get_my_notification_feed('${token}',0)`)).rows).toHaveLength(0)
})

test('actual comment trigger still creates ordinary/mention alerts and dispatches both push types', async () => {
  await db.exec('begin')
  try {
    await db.exec(`insert into comments(target_type,target_id,author_id,author_name,content,mention_ids)
      values('calendar_event',1,2,'writer','hello',array[3])`)
    const pushes = await db.query('select user_ids,type,link from push_calls order by type')
    expect(pushes.rows).toEqual([
      { user_ids: [1], type: 'comment', link: '/calendar?openEvent=1' },
      { user_ids: [3], type: 'mention', link: '/calendar?openEvent=1' },
    ])
    expect((await db.query('select user_id,type from notifications where related_id is not null order by type')).rows)
      .toEqual([{ user_id: 1, type: 'comment' }, { user_id: 3, type: 'mention' }])
    expect((await db.query(`select * from get_my_notification_feed('${token}') where type='comment'`)).rows).toEqual([])
  } finally { await db.exec('rollback') }
})

test('caps reads at 100 and handles null and negative limits', async () => {
  await db.exec('begin')
  try {
    await db.exec("insert into notifications(user_id,type) select 1,'mention' from generate_series(1,120)")
    expect((await db.query(`select * from get_my_notification_feed('${token}',1000)`)).rows).toHaveLength(100)
    expect((await db.query(`select * from get_my_notification_feed('${token}',null)`)).rows).toHaveLength(50)
    expect((await db.query(`select * from get_my_notification_feed('${token}',-1)`)).rows).toHaveLength(0)
  } finally { await db.exec('rollback') }
})
