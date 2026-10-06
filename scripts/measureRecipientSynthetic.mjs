import { createServer } from 'node:http'
import { gzipSync } from 'node:zlib'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { rolldown } from 'rolldown'

// Isolated synthetic HTTP/1.1 replay. No production/demo DB or credentials are used.
const root = process.cwd()
const cards = Array.from({ length: 603 }, (_, i) => ({ id: i + 1, name: `Synthetic card ${i + 1}` }))
const buildings = Array.from({ length: 1151 }, (_, i) => ({
  id: i + 1, card_id: i % cards.length + 1, name: `Synthetic building ${i + 1}`,
  address: `Synthetic road ${Math.floor(i / 7)}-${i % 7 + 1}`, type: i % 4 ? '주택' : '상가',
  lat: 37 + i / 100000, lng: 127 + (i * 37 % 1151) / 100000, memo: '',
  warning: false, access_status: 'normal', is_restaurant: false, units_surveyed: true, building_access_events: [],
}))
const units = buildings.flatMap((b) => Array.from({ length: 4 }, (_, j) => ({
  id: (b.id - 1) * 4 + j + 1, building_id: b.id, number: `${j + 1}01`, status: j ? '미방문' : '만남',
  is_chinese: true, is_restaurant: false, usage_type: b.type, memo: '', regular_visits: [],
})))
const boundaries = cards.map((c) => ({ card_id: c.id, updated_at: '2026-10-05T00:00:00Z',
  points: Array.from({ length: 60 }, (_, j) => ({ lat: 37 + c.id / 5000 + Math.sin(j / 59 * Math.PI * 2) / 1000,
    lng: 127 + c.id / 9000 + Math.cos(j / 59 * Math.PI * 2) / 1000 })),
}))
const tables = { buildings, units, card_boundaries: boundaries, card_assignments: [{ card_id: 1, user_name: 'Synthetic volunteer' }],
  event_card_assignments: [], service_sessions: [], event_restaurant_assignments: [] }
function summary(id) {
  const bs = buildings.filter((b) => b.card_id === id)
  return { id, name: cards[id - 1].name, area: 'Synthetic', region: 'Synthetic', status: '진행중',
    buildings: bs.length, units: bs.length * 4, completed: bs.length, progress: 25, regularVisits: 0 }
}
function fields(select) {
  const result = []; let depth = 0; let start = 0
  for (let i = 0; i < select.length; i++) {
    if (select[i] === '(') depth++
    if (select[i] === ')') depth--
    if (select[i] === ',' && depth === 0) { result.push(select.slice(start, i).trim()); start = i + 1 }
  }
  result.push(select.slice(start).trim()); return result
}
function project(row, select) {
  if (select === '*') return row
  return Object.fromEntries(fields(select).map((f) => {
    const key = f.split(/[(!]/)[0]
    if (f.includes('(')) {
      const inner = f.slice(f.indexOf('(') + 1, -1)
      const value = row[key]
      return [key, Array.isArray(value) ? value.map((v) => project(v, inner)) : value == null ? null : project(value, inner)]
    }
    return [key, row[key] ?? null]
  }))
}
function query(table, url) {
  if (!(table in tables)) throw new Error(`Unknown synthetic table ${table}`)
  let rows = (tables[table] ?? []).map((r) => ({ ...r }))
  if (table === 'units') rows = rows.map((r) => ({ ...r, buildings: { card_id: buildings[r.building_id - 1].card_id } }))
  if (table === 'buildings') rows = rows.map((r) => ({ ...r, units: units.filter((u) => u.building_id === r.id) }))
  for (const [key, filter] of url.searchParams) {
    if (['select', 'order', 'offset', 'limit'].includes(key)) continue
    const [op, ...rest] = filter.split('.'); const value = rest.join('.')
    rows = rows.filter((r) => {
      const actual = key.split('.').reduce((v, k) => v?.[k], r)
      if (op === 'in') return value.slice(1, -1).split(',').includes(String(actual))
      if (op === 'eq') return String(actual) === value
      if (op === 'is') return actual == null && value === 'null'
      throw new Error(`Unsupported synthetic filter ${op}`)
    })
  }
  const offset = Number(url.searchParams.get('offset') ?? 0)
  const limit = Number(url.searchParams.get('limit') ?? 1000)
  return rows.slice(offset, offset + limit).map((r) => project(r, url.searchParams.get('select') ?? '*'))
}
const bundles = {}
for (const version of ['before', 'after']) {
  const build = await rolldown({ input: 'synthetic-entry', plugins: [{
    name: 'synthetic-reader',
    resolveId(id) {
      if (id === 'synthetic-entry') return '\0entry'
      if (id === './supabase') return '\0client'
      if (id === './authToken') return '\0token'
    },
    load(id) {
      if (id === '\0entry') return `export { createRecipientStoreReader } from ${JSON.stringify(resolve('src/lib/recipientStore.ts'))}; export { fetchCardSummaries } from ${JSON.stringify(resolve('src/lib/cardSummaries.ts'))};
        import { supabase } from './supabase';
        import { RECIPIENT_BUILDING_COLUMNS, RECIPIENT_UNIT_COLUMNS } from ${JSON.stringify(resolve('src/lib/recipientCardPrefetch.ts'))};
        export async function readFullTerritory() {
          async function pages(table,columns,order) { const rows=[]; for(let i=0;;i+=1000) { const r=await supabase.from(table).select(columns).order(order).range(i,i+999); if(r.error) throw r.error; rows.push(...r.data); if(r.data.length<1000)return rows; } }
          const [buildings,boundaries]=await Promise.all([pages('buildings',RECIPIENT_BUILDING_COLUMNS+',units('+RECIPIENT_UNIT_COLUMNS+')','id'),pages('card_boundaries','card_id,points,updated_at','card_id')]); return { buildings,boundaries };
        }`
      if (id === '\0client') return `import { createClient } from ${JSON.stringify(fileURLToPath(import.meta.resolve('@supabase/supabase-js')))}; export const supabase = createClient(location.origin+'/api','synthetic-public-key',{auth:{persistSession:false,autoRefreshToken:false}});`
      if (id === '\0token') return 'export const getAuthToken = () => "11111111-1111-1111-1111-111111111111"'
      if (version === 'before' && id.startsWith(root + '/src/')) return { code: execFileSync('git', ['show', `5e1dfdd:${id.slice(root.length + 1)}`], { encoding: 'utf8' }), moduleType: id.endsWith('.tsx') ? 'tsx' : 'ts' }
    },
  }] })
  try { bundles[version] = (await build.generate({ format: 'esm' })).output[0].code } finally { await build.close() }
}
let metrics = []
let lastReport = null
const html = `<!doctype html><meta charset="utf-8"><title>Recipient request cost</title>
<style>body{font:16px system-ui;margin:32px;max-width:1000px}pre{white-space:pre-wrap}button{padding:10px 20px}</style>
<h1>Synthetic recipient measurement</h1><p>1,151 buildings / 603 cards / 4,604 units. Local HTTP/1.1, gzip. No Supabase connection.</p>
<button id="run">Run comparison</button><pre id="result">Ready</pre>
<script type="module">
import * as before from '/before.js'; import * as after from '/after.js';
const allIds = Array.from({length:603},(_,i)=>i+1);
document.querySelector('#run').onclick = async () => {
 const button=document.querySelector('#run'), output=document.querySelector('#result'); button.disabled=true;
 try {
 const results=[]; let expected;
 await fetch('/start',{method:'POST'});
 const fullStart=performance.now(); const full=await before.readFullTerritory();
 const fullMs=Math.round(performance.now()-fullStart);const fullStats=await(await fetch('/finish')).json();
 results.push({name:'whole-territory',scenario:'initial',ms:fullMs,...fullStats});
 for(let round=0;round<3;round++) for(const [name,api] of (round%2 ? [['after',after],['before',before]] : [['before',before],['after',after]])) {
   const reader=api.createRecipientStoreReader('Synthetic volunteer');
   for(const scenario of ['initial','cached-map','scope-refresh']) {
     output.textContent='Running '+name+' '+scenario+' round '+(round+1);
     await fetch('/start',{method:'POST'});
     if(scenario==='scope-refresh') reader.refresh();
     const start=performance.now(); const details=await reader.read();
     if(scenario!=='cached-map') await api.fetchCardSummaries(allIds);
     const elapsed=performance.now()-start;
     const actual=JSON.stringify(details, (k,v)=>k==='baseline'?null:v);
     if(expected && expected!==actual) throw Error('Detail parity failed'); expected=actual;
     const subset=full.buildings.filter(b=>reader.allowsCard(b.card_id));
     if(JSON.stringify(subset)!==JSON.stringify(details.buildings)) throw Error('Full/scoped building parity failed');
     if(JSON.stringify(full.boundaries.filter(b=>reader.allowsCard(b.card_id)))!==JSON.stringify(details.boundaries)) throw Error('Full/scoped boundary parity failed');
     const stats=await (await fetch('/finish')).json();
     results.push({round:round+1,name,scenario,ms:Math.round(elapsed),...stats});
   }
   reader.dispose();
 }
 const report={parity:'passed',results,limitations:'Local synthetic response bytes including HTTP/1.1 headers, not Supabase billing, HTTP/2, complete app traffic, or actual save/foreground UI.'};
 await fetch('/report',{method:'POST',body:JSON.stringify(report)});
 output.textContent=JSON.stringify(report,null,2);
 }catch(e){output.textContent='ERROR: '+e.message}finally{button.disabled=false}
};
</script>`
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost')
  if (url.pathname === '/') { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(html); return }
  if (url.pathname === '/before.js' || url.pathname === '/after.js') { res.setHeader('content-type', 'text/javascript'); res.end(bundles[url.pathname.slice(1, -3)]); return }
  if (url.pathname === '/start') { metrics = []; res.end('{}'); return }
  if (url.pathname === '/finish') { res.end(JSON.stringify({requests:metrics.length,bodyBytes:metrics.reduce((n,r)=>n+r.body,0),wireBytes:metrics.reduce((n,r)=>n+r.wire,0)})); return }
  if (url.pathname === '/report') {
    if(req.method==='POST'){let body='';for await(const chunk of req)body+=chunk;lastReport=JSON.parse(body)}
    res.end(JSON.stringify(lastReport));return
  }
  if (!url.pathname.startsWith('/api/rest/v1/')) { res.statusCode=404;res.end();return }
  try {
    let data
    const table = url.pathname.split('/').pop()
    if (url.pathname.includes('/rpc/')) {
      let body='';for await(const chunk of req)body+=chunk
      const params=JSON.parse(body||'{}')
      if(table==='get_card_summaries') data=params.p_card_ids.map(summary)
      else if(table==='get_recipient_return_visit_card_ids') data=[2]
      else if(table==='territory_sync_clock') data='2026-10-05T00:00:00Z'
      else throw Error('Unknown RPC')
    } else data=query(table,url)
    const body=gzipSync(Buffer.from(JSON.stringify(data)))
    res.writeHead(200,{'content-type':'application/json','content-encoding':'gzip','content-length':body.length,'cache-control':'no-store'})
    const socket=res.socket;const start=socket.bytesWritten
    res.end(body)
    metrics.push({body:body.length,wire:socket.bytesWritten-start})
  } catch (error) { res.statusCode=500;res.end(JSON.stringify({message:error.message})) }
})
server.listen(0,'127.0.0.1',()=>console.log(`Synthetic harness: http://127.0.0.1:${server.address().port}`))
