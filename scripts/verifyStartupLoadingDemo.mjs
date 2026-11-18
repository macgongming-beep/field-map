// Demo-only visual checks. Hold JS before login, then inject a read failure; no business writes.
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { parseEnv } from 'node:util'
const { chromium, webkit } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright')
const config = parseEnv(readFileSync(process.env.TEST_ENV_FILE ?? '.env.test.local', 'utf8'))
assert.equal(config.VITE_SUPABASE_URL, 'https://itjlykpjmlcvanqpmkmc.supabase.co')
const base = process.env.PREVIEW_URL ?? 'http://127.0.0.1:5194'
assert.ok(['127.0.0.1', 'chinese-territory-app-demo.vercel.app'].includes(new URL(base).hostname))
const label = process.argv[2]
assert.match(label ?? '', /^[a-zA-Z0-9_-]+$/)
const actor = JSON.parse(readFileSync('scratch/group-tabs-fixture.json', 'utf8')).actors.find(a => a.role === 'leader')
const browser = await (process.env.ENGINE === 'webkit' ? webkit : chromium).launch()
const results = []
try {
  for (const [width, height, zoom, motion] of [[390, 844, 1, 'no-preference'], [320, 568, 1.5, 'reduce'], [1365, 900, 1, 'no-preference']]) {
    if (process.env.WIDTHS && !process.env.WIDTHS.split(',').includes(String(width))) continue
    const context = await browser.newContext({ viewport: { width, height }, reducedMotion: motion, serviceWorkers: 'block' })
    const page = await context.newPage(), errors = [], assetReads = []
    await context.addInitScript(() => {
      window.__startupFrames = []
      window.__startupLogos = new Set()
      new MutationObserver(records => {
        for (const record of records) for (const node of record.addedNodes) {
          if (!(node instanceof Element)) continue
          if (node.matches('.app-loading-mark')) window.__startupLogos.add(node)
          for (const logo of node.querySelectorAll('.app-loading-mark')) window.__startupLogos.add(logo)
        }
      }).observe(document, { childList: true, subtree: true })
      const sample = () => {
        const visible = selector => [...document.querySelectorAll(selector)].some(el => el.getClientRects().length)
        const usable = visible('#login-id,.bottom-nav,.desktop-sidebar-nav')
        const logo = visible('.app-loading-mark')
        window.__startupFrames.push({ logo, usable, at: performance.now() })
        if (!usable) requestAnimationFrame(sample)
      }
      requestAnimationFrame(sample)
    })
    let releaseBoot, releaseLogin, failReads = false, ready = false
    const bootGate = new Promise(resolve => { releaseBoot = resolve })
    const loginGate = new Promise(resolve => { releaseLogin = resolve })
    page.on('pageerror', error => errors.push(error.message))
    await context.route('**/*', async route => {
      const req = route.request(), url = new URL(req.url())
      if (url.hostname.endsWith('.supabase.co')) {
        assert.equal(url.origin, config.VITE_SUPABASE_URL)
        if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method())) {
          const rpc = url.pathname.replace('/rest/v1/rpc/', '')
          assert.ok(req.method() === 'POST' && url.pathname.startsWith('/rest/v1/rpc/')
            && /^(auth_|verify_session$|auto_close_stale_sessions$|get_|read_|territory_)/.test(rpc), `Unexpected write: ${url.pathname}`)
        }
        if (failReads && url.pathname === '/rest/v1/calendar_events') return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Injected startup read failure' }) })
        return route.continue()
      }
      if (url.origin !== new URL(base).origin) return route.abort()
      if (/\.(png|svg|webp|woff2?)$/.test(url.pathname)) assetReads.push(url.pathname)
      if (url.pathname.endsWith('.js')) {
        await bootGate
        if (/\/Login-[^/]+\.js$/.test(url.pathname)) await loginGate
      }
      return route.continue()
    })
    const fits = async () => assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'No horizontal overflow')
    try {
      let before
      if (process.env.ENGINE === 'webkit') {
        // WebKit can hold parsing/painting while the module request is paused.
        const bootContext = await browser.newContext({ viewport: { width, height }, javaScriptEnabled: false, serviceWorkers: 'block' })
        await bootContext.route('**/*', route => new URL(route.request().url()).origin === new URL(base).origin ? route.continue() : route.abort())
        try {
          const bootPage = await bootContext.newPage()
          await bootPage.goto(base)
          await bootPage.locator('.app-loading-brand').waitFor()
          before = await bootPage.locator('.app-loading-brand').boundingBox()
          await bootPage.screenshot({ path: `scratch/startup-${label}-${width}-boot.png` })
        } finally { await bootContext.close() }
        releaseBoot()
        await page.goto(base, { waitUntil: 'domcontentloaded' })
      } else {
        const navigation = page.goto(base, { waitUntil: 'commit' })
        await navigation
        await page.locator('.app-loading-brand').waitFor()
        before = await page.locator('.app-loading-brand').boundingBox()
        await fits()
        await page.screenshot({ path: `scratch/startup-${label}-${width}-boot.png` })
        releaseBoot()
        await page.waitForLoadState('domcontentloaded')
      }
      await page.getByRole('status', { name: '로그인 화면 불러오는 중...', exact: true }).waitFor()
      const after = await page.locator('.app-loading-brand').boundingBox()
      await page.screenshot({ path: `scratch/startup-${label}-${width}-transition.png` })
      console.log(JSON.stringify({ width, before, after, recoveryVisible: await page.locator('.app-loading-recovery').count() }))
      assert.ok(Math.abs(before.x - after.x) <= 1 && Math.abs(before.y - after.y) <= 1, 'Boot to React brand must not jump')
      assert.deepEqual(assetReads.filter(path => !path.includes('favicon')), [], 'No new loading image/font request')
      await page.evaluate(value => {
        document.documentElement.style.setProperty('--app-zoom', String(value))
        document.querySelector('#root').style.zoom = String(value)
      }, zoom)
      await fits()
      const scaledLogo = await page.locator('.app-loading-mark').boundingBox()
      assert.ok(Math.abs(scaledLogo.width - 64) < 1 && Math.abs(scaledLogo.height - 64) < 1, 'Text zoom must not resize the startup logo')
      assert.equal(await page.locator('.app-loading-spinner').count(), 0)
      assert.equal(await page.locator('.app-loading').innerText(), '')
      assert.equal(await page.locator('.app-loading-mark').evaluate(el => getComputedStyle(el).animationName), 'none')
      await page.screenshot({ path: `scratch/startup-${label}-${width}-react.png` })
      await page.getByRole('button', { name: '앱 다시 불러오기', exact: true }).waitFor({ timeout: 15000 })
      await fits()
      await page.screenshot({ path: `scratch/startup-${label}-${width}-slow.png` })
      releaseLogin()
      await page.locator('#login-id').waitFor()
      assert.equal(await page.locator('.app-loading-mark').count(), 0)
      // Once login has appeared, no later wait in this document may replay the logo.
      await page.evaluate(() => {
        window.__replayedLogos = 0
        new MutationObserver(records => {
          for (const record of records) for (const node of record.addedNodes) {
            if (node instanceof Element && (node.matches('.app-loading-mark') || node.querySelector('.app-loading-mark'))) window.__replayedLogos++
          }
        }).observe(document.querySelector('#root'), { subtree: true, childList: true })
      })
      failReads = true
      await page.locator('#login-id').fill(actor.name)
      await page.locator('#pin').fill('0000')
      await page.locator('.login-form button[type=submit]').click()
      await page.getByText('자료를 불러오지 못했습니다. 연결을 확인하고 다시 시도해 주세요.', { exact: true }).waitFor({ timeout: 45000 })
      assert.equal(await page.locator('.app-loading-spinner').count(), 0)
      await page.getByRole('button', { name: '앱 다시 불러오기', exact: true }).waitFor()
      await fits()
      await page.screenshot({ path: `scratch/startup-${label}-${width}-error.png` })
      assert.equal(await page.locator('.app-loading-mark').count(), 0, 'Post-login error must not replay startup')
      assert.equal(await page.evaluate(() => window.__replayedLogos), 0, 'No logo during sign-in/data waiting')
      failReads = false
      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.locator(width < 980 ? '.bottom-nav' : '.desktop-sidebar-nav').first().waitFor({ timeout: 45000 })
      assert.equal(await page.locator('.app-loading-mark').count(), 0)
      const frames = await page.evaluate(() => window.__startupFrames)
      const logoElements = await page.evaluate(() => window.__startupLogos.size)
      console.log(JSON.stringify({ width, logoElements }))
      assert.equal(logoElements, 1, 'Retain the original logo element through all startup stages')
      const firstLogo = frames.findIndex(frame => frame.logo)
      assert.ok(firstLogo >= 0, 'Restored session has a startup logo')
      assert.ok(frames.slice(firstLogo).every(frame => frame.logo || frame.usable), 'No painted gap between startup logo and first usable screen')
      await page.screenshot({ path: `scratch/startup-${label}-${width}-home.png` })
      assert.deepEqual(errors, [])
      ready = true
      results.push({ width, height, zoom, motion, before, after, errors, logoElements, startupFrames: frames.length, paintedGaps: 0, postLoginLogoReplays: 0, passed: true })
      console.log(JSON.stringify(results.at(-1)))
    } finally {
      if (!ready) results.push({ width, height, errors, passed: false })
      releaseBoot(); releaseLogin()
      await context.close()
    }
  }
} finally {
  await browser.close()
  writeFileSync(`scratch/startup-${label}-ui.json`, JSON.stringify({ base, engine: process.env.ENGINE ?? 'chromium', results }, null, 2))
}
