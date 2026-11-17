import assert from 'node:assert/strict'
export function expectedCommentNotificationPatch(before,migration){
  const matches=[...before.matchAll(/v_body\s*:=\s*new\.author_name/g)]
  assert.equal(matches.length,1,'Expected exactly one notification body assignment')
  assert.ok(!before.includes('&comment='),'Already patched notification')
  const replacement=migration.match(/\$link\$([\s\S]*?)\$link\$/)?.[1]
  assert.ok(replacement,'Missing exact link replacement')
  return before.replace(matches[0][0],replacement).trim()
}
