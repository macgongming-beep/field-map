import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseEnv } from 'node:util'
import { createClient } from '@supabase/supabase-js'

const origin = 'https://itjlykpjmlcvanqpmkmc.supabase.co'
const app = 'https://chinese-territory-app-demo.vercel.app'
if (!process.env.DEMO_ENV_FILE || !process.env.TEST_LOGIN_ID || !process.env.TEST_LOGIN_PIN) throw new Error('Explicit demo env and test account required')
const env = parseEnv(readFileSync(process.env.DEMO_ENV_FILE, 'utf8'))
for (const key of ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY']) {
  if (process.env[key]) env[key] = process.env[key]
}
assert.equal(env.VITE_SUPABASE_URL, origin, 'Demo project only')
const db = createClient(origin, env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } })
const unwrap = ({ data, error }) => { if (error) throw error; return data }
const actor = unwrap(await db.rpc('auth_login', { p_login_id: process.env.TEST_LOGIN_ID, p_pin: process.env.TEST_LOGIN_PIN }))[0]
assert.ok(actor?.token, 'Demo login must succeed')
const args = { p_token: actor.token, p_limit: 50 }
const columns = 'id,user_id,type,link,related_id,is_read,created_at'
const full = unwrap(await db.rpc('get_my_notifications', args))
const meta = unwrap(await db.rpc('get_my_notifications', args).select(columns))
assert.deepEqual(meta, full.map(({ id, user_id, type, link, related_id, is_read, created_at }) => ({ id, user_id, type, link, related_id, is_read, created_at })))
assert.ok(meta.every((row) => !('title' in row) && !('body' in row)))
console.log(JSON.stringify({ phase: 'rpc-parity', rows: full.length, fullJsonBytes: Buffer.byteLength(JSON.stringify(full)), metadataJsonBytes: Buffer.byteLength(JSON.stringify(meta)), sameIdsAndReadState: true }))

if (!process.env.PLAYWRIGHT_MODULE) process.exit(0)
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE)
const browser = await chromium.launch({ headless: true })
try {
  const context = await browser.newContext({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, serviceWorkers: 'block' })
  await context.route('**/*.supabase.co/**', (route) => new URL(route.request().url()).origin === origin ? route.continue() : route.abort())
  await context.addInitScript(({ actor, app }) => {
    if (location.origin !== app) return
    localStorage.setItem('auth_token', actor.token)
    localStorage.setItem('auth_session', JSON.stringify({ id: actor.id, loginId: actor.login_id, name: actor.name, role: actor.role, phone: null, authToken: actor.token }))
    localStorage.setItem('currentVisitor', actor.name)
  }, { actor, app })
  const page = await context.newPage()
  const client = await context.newCDPSession(page)
  await client.send('Network.enable')
  const reads = []
  let preflights = 0
  const byRequest = new Map()
  client.on('Network.responseReceived', ({ requestId, response }) => {
    if (!response.url.includes('/rest/v1/rpc/get_my_notifications')) return
    if (response.status === 204) { preflights += 1; return }
    const read = { metadata: new URL(response.url).searchParams.get('select') === columns, status: response.status, protocol: response.protocol, encodedBytes: null }
    reads.push(read)
    byRequest.set(requestId, read)
  })
  client.on('Network.loadingFinished', ({ requestId, encodedDataLength }) => {
    if (byRequest.has(requestId)) byRequest.get(requestId).encodedBytes = encodedDataLength
  })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(app, { waitUntil: 'networkidle' })
  const bell = page.getByRole('button', { name: /^알림(?: \d+개)?$/ }).first()
  await bell.waitFor()
  assert.ok(reads.length > 0 && reads.every((read) => read.metadata), 'Closed header must only read metadata')
  const fullResponse = page.waitForResponse((response) => response.url().includes('/rpc/get_my_notifications') && !new URL(response.url()).searchParams.has('select'))
  await bell.click()
  await fullResponse
  await page.locator('.notification-row').first().waitFor()
  assert.ok(await page.locator('.notification-row__title').first().innerText(), 'Full titles must render')
  await page.screenshot({ path: '/tmp/notification-badge-demo-open.png', fullPage: true })
  const badgeResponse = page.waitForResponse((response) => response.url().includes('/rpc/get_my_notifications') && new URL(response.url()).searchParams.get('select') === columns)
  await page.getByRole('button', { name: '닫기', exact: true }).click()
  await (await badgeResponse).finished()
  await page.waitForLoadState('networkidle')
  assert.ok(reads.at(-1).metadata, 'Closing returns to metadata')
  let rejectNextFullRead = true
  await page.route(`${origin}/rest/v1/rpc/get_my_notifications*`, (route) => {
    if (rejectNextFullRead && route.request().method() === 'POST' && !new URL(route.request().url()).searchParams.has('select')) {
      rejectNextFullRead = false
      return route.abort('failed')
    }
    return route.continue()
  })
  await bell.click()
  await page.getByRole('alert').waitFor()
  await page.getByRole('button', { name: '다시 시도', exact: true }).click()
  await page.locator('.notification-row').first().waitFor()
  await page.waitForLoadState('networkidle')
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ phase: 'browser', reads, preflights, titlesVisible: true, offlineRetryPassed: true, pageErrors: errors, screenshot: '/tmp/notification-badge-demo-open.png' }))
} finally {
  await browser.close()
}
