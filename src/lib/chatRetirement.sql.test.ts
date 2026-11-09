// @vitest-environment node
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, expect, test } from 'vitest'

let db: PGlite
const original = readFileSync('supabase/migrations/20261109_2100_retire_chat_writes.sql', 'utf8')
const source = process.env.CHAT_RETIREMENT_MUTATION === 'writes'
  ? original.replaceAll("RAISE EXCEPTION '채팅이 종료되었습니다';", 'RETURN 1;')
  : process.env.CHAT_RETIREMENT_MUTATION === 'mentions'
    ? original.replace("type = 'chat'", "type IN ('chat','mention')")
    : process.env.CHAT_RETIREMENT_MUTATION === 'upload'
      ? original.replace('DROP POLICY IF EXISTS chat_attachments_upload ON storage.objects;', '') : original
beforeAll(async () => {
  db = new PGlite()
  await db.exec(`create role anon; create role authenticated; create schema storage;
    create table storage.objects(id int, bucket_id text);
    alter table storage.objects enable row level security;
    grant usage on schema storage to anon; grant select,insert on storage.objects to anon;
    create policy chat_attachments_upload on storage.objects for insert to anon with check(bucket_id='chat-attachments');
    create policy chat_attachments_public_read on storage.objects for select to anon using(bucket_id='chat-attachments');
    insert into storage.objects values(1,'chat-attachments');
    create function verify_session(uuid) returns int language sql as $$select 1$$;
    create table notifications(id int, type text, link text);
    insert into notifications values
      (1,'chat',null),(2,'mention','/calendar?openChat=1'),(3,'mention','/calendar/events/1/chat'),
      (4,'mention','/calendar?openEvent=1'),(5,'comment','/calendar?openEvent=1'),
      (6,'event_change','/calendar?openChat=1'),(7,'assignment','/territory?assignmentEvent=1'),
      (8,'mention','/calendar?openChat=1bad');`)
  await db.exec(source)
}, 30_000)
afterAll(async () => { await db?.close() })
test.each([
  "send_chat_message(null,1,'hello')", "send_chat_image(null,1,'https://image.invalid/test')",
  "create_system_chat_message(null,1,'hello')",
])('old app write is denied: %s', async (call) => {
  await db.exec('set role anon')
  try { await expect(db.query(`select ${call}`)).rejects.toThrow('채팅이 종료되었습니다') }
  finally { await db.exec('reset role') }
})
test('only chat notifications are deleted, never comments or comment mentions or event changes', async () => {
  expect((await db.query('select id from notifications order by id')).rows).toEqual([4,5,6,7,8].map(id => ({ id })))
})
test('upload is denied but old photo reads remain permitted', async () => {
  await db.exec('set role anon')
  try {
    expect((await db.query('select id from storage.objects')).rows).toEqual([{ id: 1 }])
    await expect(db.query("insert into storage.objects values(2,'chat-attachments')")).rejects.toThrow(/row-level security/)
  } finally { await db.exec('reset role') }
})
