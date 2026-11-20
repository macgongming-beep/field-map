import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { parseEnv } from 'node:util'

const { chromium, webkit } = await import(process.env.PLAYWRIGHT_MODULE ?? '/Users/gm/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs')
const env = parseEnv(readFileSync(process.env.DEMO_ENV_FILE ?? '../chinese-territory-app/.env.test.local', 'utf8'))
const fixture = JSON.parse(readFileSync('scratch/group-tabs-fixture.json', 'utf8'))
const seed = JSON.parse(readFileSync('scratch/group-territory-demo-seed.json', 'utf8'))
const origin = 'https://itjlykpjmlcvanqpmkmc.supabase.co'
const base = process.env.PREVIEW_URL ?? 'http://127.0.0.1:5193'
assert.equal(env.VITE_SUPABASE_URL, origin)
assert.ok(['http://127.0.0.1:5193', 'https://chinese-territory-app-demo.vercel.app'].includes(base))
const engine = process.env.ENGINE ?? 'webkit'
const browser = await ({ chromium, webkit }[engine]).launch()
const results = [], failures = []
const label = process.env.LABEL ?? 'group-territory-smoke'
assert.match(label, /^[a-z0-9-]+$/)
try {
  for (const spec of (process.env.CASES ?? 'admin:390,admin:1440,leader:390,user:390,admin:320').split(',')) {
    const [role, widthText] = spec.split(':'), width = Number(widthText)
    const actor = role === 'admin' ? { name: '관리자' } : role === 'developer' ? { name: env.TEST_LOGIN_ID } : fixture.actors.find(item => item.role === role)
    assert.ok(actor)
    const context = await browser.newContext({ viewport: { width, height: 844 }, timezoneId: 'Asia/Seoul', serviceWorkers: 'block' })
    const page = await context.newPage(), errors = [], reads = [], pending = new Set()
    let last = performance.now(), actualRole
    const end = r => { pending.delete(r); last = performance.now() }
    page.on('request', r => { if (r.url().includes('/rest/v1/')) { pending.add(r); last = performance.now() } })
    page.on('requestfailed', r => { end(r); if (r.url().includes('/rest/v1/')) errors.push(new URL(r.url()).pathname + ' failed') })
    page.on('requestfinished', async r => {
      if (!r.url().includes('/rest/v1/')) return
      try {
        const response = await r.response(), body = r.method() === 'HEAD' || response.status() === 204 ? Buffer.alloc(0) : await response.body()
        const path = new URL(r.url()).pathname.slice(9)
        if (path === 'rpc/auth_login' && response.ok()) actualRole = JSON.parse(body.toString())[0]?.role
        reads.push({ path, method: r.method(), status: response.status(), bytes: body.length })
        if (!response.ok()) errors.push(`${path} ${response.status()}`)
      } finally { end(r) }
    })
    page.on('pageerror', e => errors.push(e.message))
    await context.route('**/*', route => {
      const r = route.request(), url = new URL(r.url())
      if (url.hostname.endsWith('.supabase.co')) {
        assert.equal(url.origin, origin, 'Production is forbidden')
        assert.ok(['GET', 'HEAD', 'OPTIONS'].includes(r.method()) || url.pathname.includes('/rpc/'), 'Direct writes forbidden')
      }
      if (url.origin === base || url.origin === origin || /(?:^|\.)(?:naver\.com|naver\.net|pstatic\.net|ntruss\.com)$/.test(url.hostname)) return route.continue()
      return route.abort()
    })
    await context.routeWebSocket('**/*', socket => { assert.equal(new URL(socket.url()).hostname, new URL(origin).hostname); socket.connectToServer() })
    const settle = async () => {
      const start = performance.now()
      while (pending.size || performance.now() - last < 600) {
        assert.ok(performance.now() - start < 30000, 'Requests did not settle')
        await page.waitForTimeout(60)
      }
    }
    const shot = async name => {
      await page.screenshot({ path: `scratch/${label}-${role}-${width}-${name}.png` })
      const size = await page.evaluate(() => ({ width: innerWidth, doc: document.documentElement.scrollWidth }))
      assert.ok(size.doc <= size.width + 2, `${name} horizontal overflow: ${JSON.stringify(size)}`)
      const selector = page.locator('.group-map-selector .group-territory-scope')
      if (await selector.count()) {
        const frame = await selector.boundingBox(), input = await selector.locator('select').boundingBox()
        assert.ok(Math.abs(frame.width - input.width) < 2, 'Selector arrow must stay inside the select')
      }
    }
    const nav = () => page.locator(width < 980 ? '.bottom-nav' : '.desktop-sidebar-nav')
    try {
      await page.goto(base)
      await page.locator('#login-id').fill(actor.name)
      await page.locator('#pin').fill(role === 'developer' ? env.TEST_LOGIN_PIN : '0000')
      await page.locator('.login-form button[type=submit]').click()
      await nav().waitFor({ timeout: 45000 }); await page.locator('.app-loading').waitFor({ state: 'hidden', timeout: 45000 }); await settle()
      assert.equal(actualRole, role)
      if (role === 'admin' || role === 'developer') {
        await nav().getByRole('button', { name: '배정', exact: true }).click()
        await page.locator('.group-territory-assignment').waitFor(); await settle()
        const select = page.locator('.group-territory-select select')
        await select.selectOption(seed.groups[1].code)
        const shared = page.locator('.group-territory-list li').filter({ has: page.getByText(seed.cards[0].name, { exact: true }) })
        await shared.waitFor(); assert.match(await shared.innerText(), /东滩.*新葛/)
        if (width === 390 && process.env.WRITE_TEST !== 'false') {
          await shared.getByRole('checkbox').check()
          await page.getByRole('button', { name: '배정 해제', exact: true }).click()
          await page.getByRole('button', { name: '확인', exact: true }).click()
          await shared.waitFor({ state: 'hidden' }); await settle()
          await select.selectOption(seed.groups[0].code)
          await shared.waitFor(); assert.ok(!(await shared.innerText()).includes('新葛'))
          await select.selectOption(seed.groups[1].code)
          await page.getByRole('tab', { name: /^전체 구역/ }).click()
          await shared.getByRole('checkbox').check()
          await page.getByRole('button', { name: '+ 추가', exact: true }).click()
          await page.waitForFunction(name => [...document.querySelectorAll('.group-territory-list li')].some(el => el.textContent.includes(name) && el.textContent.includes('东滩 · 新葛')), seed.cards[0].name)
          await settle()
        }
        await shot('assignment')
      }
      if (role !== 'user') {
        await nav().getByRole('button', { name: '구역', exact: true }).click()
        await page.getByRole('combobox', { name: '집단 구역 보기' }).waitFor(); await settle()
        await shot('zone')
        await page.getByRole('combobox', { name: '집단 구역 보기' }).selectOption(seed.groups[4].code)
        if (width < 980) await page.getByRole('button', { name: '지도', exact: true }).first().click()
        else await page.goto(`${base}/map?groupCode=${seed.groups[4].code}`)
        await page.getByRole('button', { name: '집단 구역만 보기' }).waitFor(); await settle()
        assert.equal(await page.getByRole('combobox', { name: '집단 구역 보기' }).inputValue(), seed.groups[4].code)
        await shot('empty-map')
        if (width < 980) {
          await page.locator('.mm-back-btn').click()
          await page.getByRole('combobox', { name: '집단 구역 보기' }).waitFor(); await settle()
          assert.equal(new URL(page.url()).searchParams.get('groupCode'), seed.groups[4].code)
          assert.equal(await page.getByRole('combobox', { name: '집단 구역 보기' }).inputValue(), seed.groups[4].code)
          await page.getByRole('button', { name: '지도', exact: true }).first().click()
          await page.getByRole('button', { name: '집단 구역만 보기' }).waitFor(); await settle()
        }
        const start = reads.length
        await page.getByRole('combobox', { name: '집단 구역 보기' }).selectOption(seed.groups[0].code)
        await settle()
        const chinese = page.getByRole('button', { name: '중국어 사용 세대만 표시' })
        if (await chinese.count()) { await chinese.click(); await page.getByRole('tooltip').waitFor({ state: 'hidden' }); assert.equal(await chinese.getAttribute('aria-pressed'), 'true') }
        await settle(); await shot('group-map')
        const filteredReads = reads.slice(start)
        assert.ok(!filteredReads.some(r => ['buildings', 'units', 'cards', 'visit_histories'].includes(r.path)), 'Filter should not refetch full territory tables')
        if (width < 980) {
          await page.getByRole('combobox', { name: '집단 구역 보기' }).selectOption(seed.groups[1].code)
          await page.getByRole('button', { name: '통합 검색' }).click()
          await page.getByPlaceholder('구역, 건물, 주소, 식당 검색').fill(seed.cards[2].name)
          await page.getByRole('button').filter({ has: page.locator('.kind-card') }).filter({ hasText: seed.cards[2].name }).click()
          await settle()
          assert.equal(new URL(page.url()).searchParams.get('groupCode'), seed.groups[1].code)
          assert.equal(await page.getByRole('button', { name: '집단 구역만 보기' }).getAttribute('aria-pressed'), 'true')
          await shot('search-keeps-group')
          await page.getByRole('button', { name: '통합 검색' }).click()
          await page.getByPlaceholder('구역, 건물, 주소, 식당 검색').fill(seed.cards[1].name)
          await page.getByRole('button').filter({ has: page.locator('.kind-card') }).filter({ hasText: seed.cards[1].name }).click()
          await settle()
          assert.equal(new URL(page.url()).searchParams.get('groupCode'), seed.groups[1].code)
          assert.equal(await page.getByRole('button', { name: '집단 구역만 보기' }).getAttribute('aria-pressed'), 'false')
          await page.getByRole('button', { name: '집단 구역만 보기' }).click()
          await settle()
          assert.equal(await page.getByRole('combobox', { name: '집단 구역 보기' }).inputValue(), seed.groups[1].code)
          assert.equal(await page.locator('.mobile-map-title-copy .group-map-selector select').inputValue(), seed.groups[1].code)
          await shot('search-restore-group')
        }
        results.push({ role, width, filterReads: filteredReads, testedWrites: role === 'admin' && width === 390 && process.env.WRITE_TEST !== 'false' })
      } else {
        assert.equal(await page.getByRole('button', { name: '집단 구역만 보기' }).count(), 0)
        await nav().getByRole('button', { name: '나의 봉사', exact: true }).click()
        await page.locator('.app-loading').waitFor({ state: 'hidden' }); await settle(); await shot('service')
        results.push({ role, width, personalScopeUnchanged: true })
      }
      assert.deepEqual(errors, [])
    } catch (error) {
      failures.push({ role, width, error: error.message, errors, url: page.url(), body: (await page.locator('body').innerText()).slice(0, 2500) })
      await page.screenshot({ path: `scratch/${label}-${role}-${width}-failure.png` })
    } finally { await context.close() }
    writeFileSync(`scratch/${label}.json`, JSON.stringify({ base, engine, results, failures }, null, 2))
  }
} finally { await browser.close() }
console.log(JSON.stringify({ base, engine, results, failures }))
assert.equal(failures.length, 0)
