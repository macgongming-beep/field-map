import { readFileSync } from 'node:fs'
import { parseEnv } from 'node:util'
import { pathToFileURL } from 'node:url'
import { strict as assert } from 'node:assert'
import { createClient } from '@supabase/supabase-js'

if (!process.env.DEMO_ENV_FILE || !process.env.DEMO_CONFIG_FILE || !process.env.PLAYWRIGHT_MODULE || !process.argv.includes('--confirm-demo')) throw Error('Explicit demo configuration required')
const config = { ...parseEnv(readFileSync(process.env.DEMO_CONFIG_FILE, 'utf8')), ...parseEnv(readFileSync(process.env.DEMO_ENV_FILE, 'utf8')) }
const origin = 'https://itjlykpjmlcvanqpmkmc.supabase.co'
const root = 'https://chinese-territory-app-demo.vercel.app'
assert.equal(config.VITE_SUPABASE_URL, origin)
const auth = { persistSession: false, autoRefreshToken: false }
const unwrap = ({ data, error }) => { if (error) throw error; return data }
const login = createClient(origin, config.VITE_SUPABASE_ANON_KEY, { auth })
const rows = unwrap(await login.rpc('auth_login', { p_login_id: config.TEST_ADMIN_ID, p_pin: config.TEST_ADMIN_PIN }))
const admin = Array.isArray(rows) ? rows[0] : rows
assert.ok(['admin', 'developer'].includes(admin.role) && admin.token)
const writer = createClient(origin, config.VITE_SUPABASE_ANON_KEY, { auth, global: { headers: { 'x-session-token': admin.token } } })
const title = `demo-home-reuse-${Date.now()}`
const text = `${title} original`, edited = `${title} edited`
const content = body => [{ type: '일반', format: 'free_text', body }]
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href)
let fixture, browser
try {
  fixture = unwrap(await writer.from('service_suggestions').insert({ title, show_title_on_home: true, tags: [], is_visible: true,
    last_used_at: new Date().toISOString(), content: content(text) }).select('id').single())
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 430, height: 932 }, isMobile: true, serviceWorkers: 'block' })
  const reads = [], errors = []
  await page.route('**/*.supabase.co/**', async route => {
    const req = route.request(), url = new URL(req.url()), endpoint = url.pathname.split('/').pop()
    assert.equal(url.origin, origin)
    if (endpoint === 'auto_close_stale_sessions') return route.fulfill({ status: 200, body: 'null', contentType: 'application/json' })
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method()) && !['auth_login', 'verify_session', 'get_card_summaries', 'get_recipient_return_visit_card_ids',
      'territory_sync_clock', 'get_my_profile', 'get_session_users', 'get_my_permissions', 'get_my_notifications', 'get_my_chat_reads', 'get_chat_message_meta'].includes(endpoint)) {
      errors.push(`Unexpected browser write ${endpoint}`); return route.abort()
    }
    if (endpoint === 'service_suggestions' && req.method() === 'GET') reads.push(url.searchParams.get('select'))
    await route.continue()
  })
  page.on('pageerror', e => errors.push(e.message))
  await page.goto(root)
  await page.locator('#login-id').fill(config.TEST_VOLUNTEER_ID)
  await page.locator('#pin').fill(config.TEST_VOLUNTEER_PIN)
  await page.locator('.login-form button[type="submit"]').click()
  await page.locator('.bottom-nav').waitFor({ timeout: 60000 })
  await page.getByText(text, { exact: true }).waitFor()
  assert.deepEqual(reads, ['id,last_used_at,created_at', '*'])
  const go = async path => {
    await page.evaluate(path => { history.pushState(null, '', path); dispatchEvent(new PopStateEvent('popstate')) }, path)
    await page.waitForTimeout(1500)
    await page.waitForFunction(() => !document.querySelector('.app-loading'), undefined, { timeout: 45000 })
  }
  await go('/calendar'); reads.length = 0; await go('/')
  await page.getByText(text, { exact: true }).waitFor()
  assert.deepEqual(reads, ['id,last_used_at,created_at'])
  const unchangedReads = [...reads]
  await go('/calendar')
  const updated = unwrap(await writer.from('service_suggestions').update({ content: content(edited), last_used_at: new Date().toISOString() }).eq('id', fixture.id).eq('title', title).select('id'))
  assert.equal(updated.length, 1)
  reads.length = 0; await go('/')
  await page.getByText(edited, { exact: true }).waitFor()
  assert.deepEqual(reads, ['id,last_used_at,created_at', '*'])
  const editedReads = [...reads]
  await page.screenshot({ path: '/tmp/demo-home-reuse-edited-0065.png' })
  await go('/calendar')
  assert.equal(unwrap(await writer.from('service_suggestions').update({ is_visible: false }).eq('id', fixture.id).eq('title', title).select('id')).length, 1)
  reads.length = 0; await go('/')
  assert.equal(await page.getByText(edited, { exact: true }).count(), 0)
  assert.equal(await page.getByText(text, { exact: true }).count(), 0)
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ project: 'demo', unchangedReads, editedReads, hiddenFixtureAbsent: true, errors }))
} finally {
  await browser?.close()
  if (fixture) {
    const deleted = unwrap(await writer.from('service_suggestions').delete().eq('id', fixture.id).eq('title', title).select('id'))
    assert.equal(deleted.length, 1)
    console.log(JSON.stringify({ fixtureCleanup: 'passed' }))
  }
  await login.removeAllChannels(); await writer.removeAllChannels()
}
