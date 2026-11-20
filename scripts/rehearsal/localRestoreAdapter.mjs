// Offline transport for the unchanged restore CLI. Never used by the application.
import assert from 'node:assert/strict'
import { appendFileSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

export function localEnv() {
  const socket = process.env.REHEARSAL_SOCKET
  const database = process.env.REHEARSAL_DATABASE
  assert.match(socket || '', /^\/[^\n]*\/fieldmap-recovery-[^/]+$/)
  assert.ok(existsSync(`${socket}/LOCAL_REHEARSAL_ONLY`))
  assert.match(database || '', /^rehearsal_[a-z_]+$/)
  return { PATH:process.env.PATH, HOME:process.env.HOME, PGHOST:socket, PGPORT:'55442',
    PGDATABASE:database, PGUSER:'postgres', PGCONNECT_TIMEOUT:'5' }
}

export function localOwnerConnection(url, api) {
  assert.equal(url,'postgresql://rehearsal-only')
  assert.equal(api,'https://rehearsal.invalid')
  return localEnv()
}

const identifier = s => `"${s.replaceAll('"','""')}"`
const literal = s => `'${s.replaceAll("'","''")}'`
function request(table, action, sql, attempted = 0) {
  assert.match(table,/^[a-z_]+$/)
  const result = spawnSync(process.env.PSQL_BIN, ['-XqAt','--single-transaction','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose'], {
    env:localEnv(),encoding:'utf8',maxBuffer:32*1024*1024,
    input:`set local standard_conforming_strings=on;set local statement_timeout='60s';
      ${process.env.REHEARSAL_DATABASE==='rehearsal_maintenance'?"set local app.assignment_maintenance='on';":''}
      set local role service_role;set local request.jwt.claims='{"role":"service_role"}';${sql}`,
  })
  const state = result.stderr?.match(/(?:ERROR|FATAL):\s+([A-Z0-9]{5})/)?.[1] || 'unknown'
  const constraint = result.stderr?.match(/CONSTRAINT NAME:\s+([a-zA-Z0-9_]+)/)?.[1] || null
  appendFileSync(process.env.REHEARSAL_ATTEMPTS,JSON.stringify({table,action,attempted,ok:result.status===0,sqlstate:result.status===0?null:state,constraint})+'\n',{mode:0o600})
  return result.status === 0 ? {data:result.stdout.trim(),error:null} : {data:null,error:{message:`Local SQL ${state}`,code:state}}
}
export function createClient(url,key) {
  assert.equal(url,'https://rehearsal.invalid');assert.equal(key,'offline-only')
  return {from:table=>({
    select:async (_columns,options)=>{
      assert.equal(options.head,true)
      const r=request(table,'count',`select count(*) from public.${identifier(table)};`)
      return {count:r.error?null:Number(r.data),error:r.error}
    },
    upsert:async(rows,options)=>{
      const columns=[...new Set(rows.flatMap(row=>Object.keys(row)))].sort()
      const keys=options.onConflict.split(',')
      const changes=columns.filter(c=>!keys.includes(c)).map(c=>`${identifier(c)}=excluded.${identifier(c)}`)
      const action=options.ignoreDuplicates||!changes.length?'do nothing':`do update set ${changes.join(',')}`
      return request(table,'upsert',`insert into public.${identifier(table)} (${columns.map(identifier).join(',')})
        select ${columns.map(identifier).join(',')} from jsonb_populate_recordset(null::public.${identifier(table)},${literal(JSON.stringify(rows))}::jsonb)
        on conflict (${keys.map(identifier).join(',')}) ${action};`,rows.length)
    },
  })}
}
