// @vitest-environment node
import {readFileSync} from 'node:fs'
import {expect,test} from 'vitest'
import {expectedCommentNotificationPatch} from '../../../scripts/commentNotificationPatch.mjs'
const migration=readFileSync('supabase/migrations/20261117_1400_group_event_comments.sql','utf8')
test('installed-body comparison changes just the one assignment prefix and keeps cart recipients',()=>{
  const before="union all select ca.user_id from public.event_cart_applications ca;\nv_body:=new.author_name||'text';"
  const result=expectedCommentNotificationPatch(before,migration)
  expect(result).toContain('union all select ca.user_id from public.event_cart_applications ca;')
  expect(result.match(/&comment=/g)).toHaveLength(1)
  expect(result.endsWith("v_body := new.author_name||'text';")).toBe(true)
  expect(()=>expectedCommentNotificationPatch(before+'v_body := new.author_name;',migration)).toThrow('exactly one')
  expect(()=>expectedCommentNotificationPatch(result,migration)).toThrow('Already patched')
})
