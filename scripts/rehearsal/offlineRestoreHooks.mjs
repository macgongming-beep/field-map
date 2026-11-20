import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { localEnv } from './localRestoreAdapter.mjs'

localEnv()
const root=resolve(fileURLToPath(new URL('../..',import.meta.url)))
const main=pathToFileURL(`${root}/scripts/restore.js`).href
const helper=pathToFileURL(`${root}/scripts/groupTerritoryBackup.mjs`).href
const adapter=new URL('./localRestoreAdapter.mjs',import.meta.url).href
assert.ok(process.env.REHEARSAL_INPUT.startsWith(`${process.env.REHEARSAL_SOCKET}/`))
globalThis.fetch=()=>{throw new Error('External network is disabled in the recovery rehearsal')}
registerHooks({
  resolve(specifier,context,next){
    if(context.parentURL===main){
      if(specifier==='@supabase/supabase-js')return {url:adapter,shortCircuit:true}
      if(specifier==='./groupTerritoryBackup.mjs')return {url:'rehearsal:owner',shortCircuit:true}
      if(specifier==='node:fs')return {url:'rehearsal:files',shortCircuit:true}
    }
    return next(specifier,context)
  },
  load(url,context,next){
    if(url==='rehearsal:owner')return {format:'module',shortCircuit:true,source:
      `export * from ${JSON.stringify(helper)};export {localOwnerConnection as ownerConnection} from ${JSON.stringify(adapter)};`}
    if(url==='rehearsal:files')return {format:'module',shortCircuit:true,source:`
      import * as fs from 'node:fs';export * from 'node:fs';
      const source=${JSON.stringify(root+'/backups')}, target=${JSON.stringify(process.env.REHEARSAL_INPUT)};
      function map(p){if(p===${JSON.stringify(root+'/.env.local')})return null;
        if(p===source||p.startsWith(source+'/'))return target+p.slice(source.length);
        throw Error('Unexpected file access in restore CLI');}
      export function existsSync(p){const m=map(p);return m!==null&&fs.existsSync(m);}
      export function readFileSync(p,...args){const m=map(p);if(m===null)throw Error('Environment file access disabled');return fs.readFileSync(m,...args);}
      export function readdirSync(p,...args){return fs.readdirSync(map(p),...args);}`}
    return next(url,context)
  },
})
