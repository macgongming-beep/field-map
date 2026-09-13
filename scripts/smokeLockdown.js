// anon 쓰기 차단이 **실제로 무는지** HTTP 로 증명한다.
//
// ⚠ 이 smoke 는 최종 전환 SQL 을 **적용한 뒤** 돌린다. 적용 전에 돌리면 전부 실패한다.
// ⚠ 테스트 DB 에서만 돈다 (testEnvGuard 가 막는다).
//
// SQL Editor 의 `set local role anon` 으로는 증명이 안 된다 —
// PostgREST 를 거쳐야 request.headers 가 실제로 실린다.
import { loadTestEnv } from './testEnvGuard.js'
import { createClient } from '@supabase/supabase-js'

const env = loadTestEnv()
if (!env.allowWrites) {
  console.error('\n  ✗ 이 smoke 는 쓴다. npm run smoke:lockdown 으로 실행할 것.\n')
  process.exit(1)
}
const URL_ = env.url
const KEY = env.anonKey

let fail = 0
const check = (name, ok, detail) => {
  console.log(`  ${ok ? '✅' : '❌'} ${name}${detail ? '  — ' + detail : ''}`)
  if (!ok) fail += 1
}
const req = (path, init = {}, token) =>
  fetch(`${URL_}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: KEY, 'Content-Type': 'application/json', Prefer: 'return=representation',
      ...(token ? { 'x-session-token': token } : {}),
      ...(init.headers ?? {}),
    },
  })
const login = async (id, pin) => {
  const r = await fetch(`${URL_}/rest/v1/rpc/auth_login`, {
    method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_login_id: id, p_pin: pin }),
  })
  const d = await r.json().catch(() => null)
  return Array.isArray(d) ? d[0] : d
}
/** 막혔는가. 401/403 뿐 아니라 **0행 반영**도 막힌 것이다 (RLS 는 조용히 0행을 준다) */
const blocked = async (res) => {
  if (res.status === 401 || res.status === 403) return true
  if (!res.ok) return true
  const body = await res.json().catch(() => null)
  return Array.isArray(body) && body.length === 0
}
// ⚠ `app_users` 는 **칸 단위 권한**이다 (pin 은 SELECT 가 막혀 있다).
//   `Prefer: return=representation` 은 RETURNING * 을 만들어 pin 을 읽으려 하고,
//   그러면 정책과 무관하게 42501 "permission denied for table app_users" 가 난다.
//   → app_users 요청에는 반드시 `select=id` 로 **돌려받을 칸을 좁힌다.**
//   (실제 앱도 app_users 를 통째로 돌려받지 않는다)
const users = (q) => `app_users?select=id${q ? '&' + q : ''}`
const rowsOf = async (res) => { const b = await res.json().catch(() => null); return Array.isArray(b) ? b : [] }
/** 그 행이 아직 있는가 — HTTP 코드를 믿지 않고 **관리자 눈으로 다시 읽는다** */
const stillThere = async (path, token) => (await rowsOf(await req(path, {}, token))).length > 0

const SENTINEL = '_smoke_lockdown_' + Date.now()

// ⚠ **유효한 카드여야 한다.** cards 는 name·area·region·type 이 전부 NOT NULL 이고
//   type 은 '전체' 만 허용된다(cards_type_check). 값을 빼먹으면 INSERT 가 400 으로
//   실패하는데, 그러면 "막혔다" 로 **거짓 통과**한다 — 정책과 무관하게.
//   (fixture 가 유효한지는 아래에서 관리자 토큰으로 **한 번 만들어 보고** 확인한다)
const card = (name) => ({ name, area: '_smoke', region: '_smoke', type: '전체' })

// ⚠ 뒷정리는 **finally** 에서 한다. 중간에 던지면 테스트 DB 에 쓰레기가 남고,
//   다음 실행이 그 잔재 때문에 엉뚱하게 통과/실패한다.
const trash = []                       // [경로] — 관리자 토큰으로 지운다
const willClean = (path) => { trash.push(path); return path }

const main = async () => {
  console.log('\n── anon 쓰기 차단 smoke ──\n')

  const admin = await login(env.loginId, env.loginPin)
  if (!admin?.token) throw new Error('테스트 관리자로 로그인 못 함')
  console.log('  (관리자 토큰 확보)\n')

  // ═══ ① 헤더 없음 — 쓰기는 전부 막히고 읽기는 살아야 한다 ═══
  //   ⚠ **실제로 있는 행**을 상대로 시험한다. 없는 행을 지우려 하면
  //     열려 있어도 200+[] 이라 어느 쪽이든 통과한다 (여기서 한 번 데었다).
  console.log('  ① 헤더 없음')
  const sent = await req('cards', { method: 'POST', body: JSON.stringify(card(SENTINEL)) }, admin.token)
  const sentinelId = (await rowsOf(sent))[0]?.id
  if (sentinelId) willClean(`cards?id=eq.${sentinelId}`)
  //   ⚠ 여기가 실패하면 **정책이 아니라 fixture 가 잘못된 것**이다.
  //     그대로 두면 아래 무헤더 검사들이 전부 거짓 통과한다.
  if (!sentinelId) throw new Error(`sentinel 카드를 못 만들었다 (HTTP ${sent.status}) — fixture 가 스키마와 안 맞는다`)
  check('fixture 가 유효하다 (관리자로 카드가 만들어진다)', true)

  const noHdrIns = await req('cards', { method: 'POST', body: JSON.stringify(card(SENTINEL + '_침입')) })
  check('헤더 없이 카드 INSERT 가 막힌다', await blocked(noHdrIns), `HTTP ${noHdrIns.status}`)
  check('   정말 안 만들어졌다 (다시 읽어 확인)',
    !(await stillThere(`cards?name=eq.${SENTINEL}_침입&select=id`, admin.token)))

  const noHdrUpd = await req(`cards?id=eq.${sentinelId}`, { method: 'PATCH', body: JSON.stringify({ area: '침입' }) })
  check('헤더 없이 **있는 행**을 UPDATE 못 한다', await blocked(noHdrUpd), `HTTP ${noHdrUpd.status}`)
  check('   정말 안 바뀌었다',
    (await rowsOf(await req(`cards?id=eq.${sentinelId}&select=area`, {}, admin.token)))[0]?.area === '_smoke')

  const noHdrDel = await req(`cards?id=eq.${sentinelId}`, { method: 'DELETE' })
  check('헤더 없이 **있는 행**을 DELETE 못 한다', await blocked(noHdrDel), `HTTP ${noHdrDel.status}`)
  check('   ⚠ 그 행이 아직 살아 있다 (이게 진짜 검사다)',
    await stillThere(`cards?id=eq.${sentinelId}&select=id`, admin.token))

  //   ⚠ 읽기는 `res.ok` 로 보면 안 된다 — RLS 로 막히면 **200 + []** 가 온다.
  //     반드시 **있는 줄 알고 있는 행**이 실제로 돌아오는지 본다.
  const noHdrRead = await rowsOf(await req(`cards?id=eq.${sentinelId}&select=id`))
  check('⚠ 헤더 없어도 **읽기는 된다** (Realtime 이 이것에 달려 있다)',
    noHdrRead.length === 1, `${noHdrRead.length}행`)

  // ═══ ② 가짜 토큰 ═══
  console.log('\n  ② 가짜 토큰')
  for (const [label, tok] of [['형식이 이상한', 'not-a-uuid'],
                              ['형식은 맞지만 없는', '00000000-0000-0000-0000-000000000000']]) {
    const r = await req('cards', { method: 'POST', body: JSON.stringify(card(SENTINEL + '_가짜')) }, tok)
    check(`${label} 토큰으로 쓰기가 막힌다 (500 예외 아님)`,
      await blocked(r) && r.status !== 500, `HTTP ${r.status}`)
  }

  // ═══ ③ 정상 토큰 — 평범한 쓰기는 되어야 한다 ═══
  console.log('\n  ③ 정상 토큰 (관리자)')
  const ins = await req('cards', { method: 'POST', body: JSON.stringify(card(SENTINEL + '_정상')) }, admin.token)
  const created = await ins.json().catch(() => null)
  const cardId = Array.isArray(created) ? created[0]?.id : null
  if (cardId) willClean(`cards?id=eq.${cardId}`)
  check('로그인 상태로 카드가 만들어진다', ins.ok && Boolean(cardId), `HTTP ${ins.status}`)

  // ═══ ④ 일반 사용자가 권한을 올릴 수 있나 — 여기가 핵심 ═══
  console.log('\n  ④ 일반 사용자의 권한 상승')
  const LOGIN_ID = '_smoke_user', PIN = '4321'
  await req(users(`login_id=eq.${LOGIN_ID}`), { method: 'DELETE' }, admin.token)   // 앞선 실행 잔재
  const mk = await req(users(), {
    method: 'POST',
    body: JSON.stringify({ login_id: LOGIN_ID, name: '_smoke_일반', pin: PIN, role: 'user', approval_status: 'approved' }),
  }, admin.token)
  const mkBody = await mk.json().catch(() => null)
  const userId = Array.isArray(mkBody) ? mkBody[0]?.id : null
  if (userId) willClean(users(`id=eq.${userId}`))
  check('관리자는 사용자를 만들 수 있다', mk.ok && Boolean(userId), `HTTP ${mk.status}`)

  const u = userId ? await login(LOGIN_ID, PIN) : null
  check('그 일반 사용자로 로그인된다', Boolean(u?.token))

  if (u?.token && userId) {
    const esc = await req(users(`id=eq.${userId}`), { method: 'PATCH', body: JSON.stringify({ role: 'admin' }) }, u.token)
    check('⚠ 자기 role 을 admin 으로 못 올린다', await blocked(esc), `HTTP ${esc.status}`)

    // **정말 안 바뀌었는지 다시 읽어 확인한다** — HTTP 코드만 믿지 않는다
    const after = await req(`app_users?id=eq.${userId}&select=role`, {}, admin.token)
    const rows = await after.json().catch(() => null)
    check('   다시 읽어도 role 이 user 그대로다', rows?.[0]?.role === 'user', `role=${rows?.[0]?.role}`)

    //   ⚠ 지금 값과 **다른 값**을 넣어야 한다. approved 인 사람에게 approved 를 넣으면
    //     `is distinct from` 이 거짓이라 트리거가 볼 것도 없다 — no-op 이라 아무것도 안 무는다.
    for (const [col, val] of [['approval_status', 'pending'], ['is_active', false]]) {
      const r = await req(users(`id=eq.${userId}`), { method: 'PATCH', body: JSON.stringify({ [col]: val }) }, u.token)
      check(`${col} 을 직접 못 바꾼다`, await blocked(r), `HTTP ${r.status}`)
      const now = (await rowsOf(await req(`app_users?id=eq.${userId}&select=${col}`, {}, admin.token)))[0]?.[col]
      check(`   다시 읽어도 그대로다`, now !== val, `${col}=${now}`)
    }

    const other = await req(users('login_id=eq.test-admin'), { method: 'PATCH', body: JSON.stringify({ name: '_smoke_남의이름' }) }, u.token)
    check('남의 계정을 못 고친다', await blocked(other), `HTTP ${other.status}`)

    const mkAdmin = await req(users(), {
      method: 'POST',
      body: JSON.stringify({ login_id: '_smoke_침입admin', name: '침입', pin: '9999', role: 'admin', approval_status: 'approved' }),
    }, u.token)
    check('⚠ 자기를 admin 으로 한 줄 더 못 만든다', await blocked(mkAdmin), `HTTP ${mkAdmin.status}`)

    const own = await req(users(`id=eq.${userId}`), { method: 'PATCH', body: JSON.stringify({ phone: '010-0000-0000' }) }, u.token)
    check('   그래도 자기 전화번호는 고칠 수 있다 (과하게 막지 않았나)', own.ok, `HTTP ${own.status}`)

    const settings = await req('app_settings', { method: 'POST', body: JSON.stringify({ key: '_smoke', value: 'x' }) }, u.token)
    check('app_settings 를 일반 사용자가 못 쓴다', await blocked(settings), `HTTP ${settings.status}`)
  }

  // ═══ ⑤ 관리자는 여전히 할 수 있어야 한다 (과잉 차단 확인) ═══
  console.log('\n  ⑤ 관리자 권한은 살아 있나')
  if (userId) {
    const promote = await req(users(`id=eq.${userId}`), { method: 'PATCH', body: JSON.stringify({ role: 'leader' }) }, admin.token)
    check('관리자는 role 을 바꿀 수 있다', promote.ok, `HTTP ${promote.status}`)
  }

  // ═══ ⑥ Realtime — WebSocket 에는 x-session-token 이 **안 붙는다** ═══
  //   그래서 세션 관문을 SELECT 에 걸면 구독이 조용히 끊긴다.
  //   "연결됐다" 만 보면 안 된다 — **실제 변경 이벤트가 도착하는지** 봐야 한다.
  console.log('\n  ⑥ Realtime (헤더 없는 WebSocket)')
  //   ⚠ **앱이 실제로 구독하는 표**로 시험해야 한다. cards 는 publication 에
  //     들어 있지 않아 이벤트가 아예 안 온다 — 정책과 무관하게 실패한다
  //     (여기서 한 번 데었다). 앱이 구독하는 것: calendar_events ·
  //     event_participants · comments · chat_* · event_card_assignment*.
  const rt = createClient(URL_, KEY)
  const RT_TITLE = SENTINEL + '_rt'
  let rtStatus = '(구독 콜백 없음)', rtInsert = '(INSERT 안 함)', realtimeReceived = false
  const got = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 15000)
    let retryTimer = null
    const insertRealtime = async (suffix) => {
      const ins = await req('calendar_events?select=id', { method: 'POST',
        body: JSON.stringify({ event_date: '2030-01-01', title: `${RT_TITLE}_${suffix}` }) }, admin.token)
      const id = (await rowsOf(ins))[0]?.id ?? null
      rtInsert = `${rtInsert === '(INSERT 안 함)' ? '' : `${rtInsert} / `}HTTP ${ins.status} · id=${id ?? '없음'}`
      if (id) willClean(`calendar_events?id=eq.${id}`)
    }
    rt.channel('_smoke_lockdown')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'calendar_events' }, (p) => {
        if (p.new?.title?.startsWith(RT_TITLE)) {
          realtimeReceived = true
          clearTimeout(timer)
          if (retryTimer) clearTimeout(retryTimer)
          resolve(p.new)
        }
      })
      .subscribe(async (status, err) => {
        if (status !== 'SUBSCRIBED') { rtStatus = `${status}${err ? ' · ' + (err.message ?? err) : ''}`; return }
        rtStatus = 'SUBSCRIBED'
        // 정책 DDL 직후에는 채널 상태가 먼저 SUBSCRIBED가 되고 변경 스트림 등록이
        // 아주 잠깐 늦을 수 있다. 즉시 INSERT하면 정상 구독도 한 번 놓쳐 거짓 실패한다.
        await new Promise((ready) => setTimeout(ready, 750))
        await insertRealtime('first')
        // SUBSCRIBED 직후 첫 이벤트만 놓치는 경우 같은 채널에서 한 번 더 증명한다.
        if (!realtimeReceived) retryTimer = setTimeout(() => void insertRealtime('retry'), 3000)
        //   ⚠ INSERT 가 실패하면 이벤트가 안 오는 게 당연하다. 그걸 'Realtime 이 깨졌다'
        //     로 읽으면 엉뚱한 곳을 파게 된다 — 그래서 둘을 따로 보고한다.
      })
  })
  check('구독이 살아 있고 INSERT 이벤트가 도착한다 (15초 안)', Boolean(got),
    got ? `id=${got.id}` : `못 받음 · 구독=${rtStatus} · INSERT=${rtInsert}`)
  await rt.removeAllChannels()

  return admin.token
}

const cleanup = async (token) => {
  if (!token) { console.log('\n  ⚠ 관리자 토큰이 없어 뒷정리를 못 한다 — 테스트 DB 에 _smoke_ 자료가 남는다'); return }
  for (const path of trash) await req(path, { method: 'DELETE' }, token)
  // 이름으로 한 번 더 훑는다 (추적에서 빠진 것)
  for (const p of [`cards?name=like.${SENTINEL}*`, `calendar_events?title=like.${SENTINEL}*`, users('login_id=like._smoke_*'),
                   'app_settings?key=eq._smoke']) {
    await req(p, { method: 'DELETE' }, token)
  }
  const left = await rowsOf(await req(`cards?name=like.${SENTINEL}*&select=id`, {}, token))
  const leftU = await rowsOf(await req(users('login_id=like._smoke_*'), {}, token))
  check('뒷정리 — 남은 _smoke_ 자료 없음', left.length === 0 && leftU.length === 0,
    `카드 ${left.length} · 사용자 ${leftU.length}`)
}

let adminToken = null
main()
  .then((t) => { adminToken = t })
  .catch((e) => { console.error('\n  ✗ 도중에 죽었다:', e?.message ?? e); fail += 1 })
  .finally(async () => {
    // 죽었어도 관리자 토큰을 다시 얻어 치운다
    if (!adminToken) adminToken = (await login(env.loginId, env.loginPin).catch(() => null))?.token ?? null
    await cleanup(adminToken).catch((e) => console.error('  뒷정리 실패:', e?.message ?? e))
    console.log(`\n  ${fail === 0 ? '✅ 전부 통과' : `❌ ${fail}개 실패`}\n`)
    process.exit(fail === 0 ? 0 : 1)
  })
