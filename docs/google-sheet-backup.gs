/**
 * 봉사 구역 — 구글 시트 비상 사본 (읽기 전용)
 *
 * 사용 중단 (2026-11-10): 아래 코드는 과거 참고용이며 실행하지 않는다.
 * 방문기록·재방문 비로그인 읽기 차단 후에는 200/빈 배열을 받아 기존 시트를
 * 빈 값으로 덮을 수 있다. 확인된 시트는 2026-06-02 사본, 자동 트리거 0개다.
 * 다시 만들 때는 인증된 최소 자료 경로와 실패 시 기존 사본 보존을 먼저 설계한다.
 * 공개 앱 키 대신 service-role 키를 이 코드에 붙여넣는 것으로 해결하지 않는다.
 * 상세: docs/decisions/0082-production-private-visit-reads.md
 *
 * 목적: 앱(Supabase)이 막혀도 시트만 보고 봉사 나갈 수 있도록
 *       건물·세대·정기방문·구역배정을 시트에 매일 자동 복사.
 *
 * ⚠️ 이 시트는 "읽기 전용 사본"입니다.
 *    시트에서 직접 수정해도 앱에 반영되지 않고, 다음 갱신 때 덮어써집니다.
 *    실제 입력은 항상 앱에서 하세요.
 *
 * ── 설정 방법 ──────────────────────────────────────────────
 * 1. 구글 시트 새로 만들기 (drive.google.com → 새로 만들기 → 스프레드시트)
 * 2. 상단 메뉴: 확장 프로그램 → Apps Script
 * 3. 기본 코드 다 지우고 이 파일 전체를 붙여넣기
 * 4. 아래 SUPABASE_URL / SUPABASE_ANON_KEY 두 줄을 본인 값으로 교체
 *    (앱의 .env.local 에 있는 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY 와 동일)
 * 5. 저장(💾) → 함수 선택 "refreshAll" → 실행(▶)
 *    → 첫 실행 시 권한 허용 팝업 1회 (본인 구글 계정 → 허용)
 * 6. 시트로 돌아가면 [건물][세대][정기방문][구역배정] 탭이 채워짐
 *
 * ── 매일 자동 갱신 (선택) ──────────────────────────────────
 * Apps Script 좌측 시계 아이콘(트리거) → 트리거 추가
 *   - 실행할 함수: refreshAll
 *   - 이벤트 소스: 시간 기반
 *   - 시간 기반 트리거: 일 단위 타이머 → 새벽 4~5시
 *
 * ── 수동 갱신 ──────────────────────────────────────────────
 * 시트 상단에 "🔄 데이터 갱신" 메뉴가 생깁니다 (onOpen). 거기서 실행.
 * ===========================================================
 */

// ★ 본인 값으로 교체 ★
const SUPABASE_URL = 'https://YOUR-PROJECT.supabase.co'
const SUPABASE_ANON_KEY = 'YOUR-ANON-KEY'

// ── Supabase REST 조회 헬퍼 ──────────────────────────────────
function sbSelect(table, query) {
  const url = SUPABASE_URL + '/rest/v1/' + table + '?' + (query || 'select=*')
  const res = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: 'Bearer ' + SUPABASE_ANON_KEY,
    },
    muteHttpExceptions: true,
  })
  const code = res.getResponseCode()
  if (code !== 200) {
    throw new Error(table + ' 조회 실패 (' + code + '): ' + res.getContentText().slice(0, 200))
  }
  return JSON.parse(res.getContentText())
}

// 시트에 2차원 배열 쓰기 (탭 없으면 생성, 기존 내용 비우고 덮어쓰기)
function writeSheet(tabName, headers, rows) {
  const ss = SpreadsheetApp.getActiveSpreadsheet()
  let sheet = ss.getSheetByName(tabName)
  if (!sheet) sheet = ss.insertSheet(tabName)
  sheet.clear()

  const data = [headers].concat(rows)
  if (data.length > 0 && data[0].length > 0) {
    sheet.getRange(1, 1, data.length, headers.length).setValues(data)
  }
  // 헤더 스타일
  sheet.getRange(1, 1, 1, headers.length)
    .setFontWeight('bold')
    .setBackground('#1a1a18')
    .setFontColor('#ffffff')
  sheet.setFrozenRows(1)
  sheet.autoResizeColumns(1, headers.length)
}

// ── 메인: 전체 갱신 ──────────────────────────────────────────
function refreshAll() {
  const cards = sbSelect('cards', 'select=*')
  const buildings = sbSelect('buildings', 'select=*')
  const units = sbSelect('units', 'select=*')
  const leaderAssign = sbSelect('card_leader_assignments', 'select=*')
  const returnVisits = sbSelect('return_visits', 'select=*')
  // 방문기록은 많을 수 있어 최근 6개월만 (세대 마지막 방문 계산용)
  const sinceISO = new Date(Date.now() - 183 * 24 * 60 * 60 * 1000).toISOString()
  const visits = sbSelect('visit_histories', 'select=unit_id,result,visited_at,visitor_name&visited_at=gte.' + sinceISO + '&order=visited_at.desc')

  // 인덱스
  const cardById = {}
  cards.forEach(function (c) { cardById[c.id] = c })
  const buildingById = {}
  buildings.forEach(function (b) { buildingById[b.id] = b })

  // 카드별 담당 인도자 (여러명 가능)
  const leadersByCard = {}
  leaderAssign.forEach(function (a) {
    if (!leadersByCard[a.card_id]) leadersByCard[a.card_id] = []
    leadersByCard[a.card_id].push(a.user_name)
  })
  function cardLeaders(cardId) {
    const arr = leadersByCard[cardId]
    if (arr && arr.length) return arr.join(', ')
    const c = cardById[cardId]
    return (c && c.leader_name) || ''
  }

  // 세대별 마지막 방문 (visits가 visited_at desc 정렬이라 첫 등장이 최신)
  const lastVisitByUnit = {}
  visits.forEach(function (v) {
    if (!lastVisitByUnit[v.unit_id]) {
      lastVisitByUnit[v.unit_id] = { date: v.visited_at, result: v.result, visitor: v.visitor_name }
    }
  })

  // ── 탭1: 건물 ──
  const buildingRows = buildings
    .map(function (b) {
      const c = cardById[b.card_id] || {}
      const unitCount = units.filter(function (u) { return u.building_id === b.id }).length
      return {
        region: c.region || '', area: c.area || '', card: c.name || '',
        name: b.name, address: b.address, type: b.type,
        units: unitCount, leader: cardLeaders(b.card_id),
        sortKey: (c.name || '') + '|' + b.name,
      }
    })
    .sort(function (a, b) { return a.sortKey.localeCompare(b.sortKey, 'ko') })
  writeSheet('건물',
    ['지역', '동', '카드', '건물명', '주소', '유형', '세대수', '담당 인도자'],
    buildingRows.map(function (r) { return [r.region, r.area, r.card, r.name, r.address, r.type, r.units, r.leader] }))

  // ── 탭2: 세대 ──
  const unitRows = units
    .map(function (u) {
      const b = buildingById[u.building_id] || {}
      const c = cardById[b.card_id] || {}
      const last = lastVisitByUnit[u.id]
      return {
        card: c.name || '', building: b.name || '', number: u.number,
        status: u.status, chinese: u.is_chinese ? '중국어' : '',
        lastDate: last ? last.date : '', lastResult: last ? last.result : '',
        visitor: last ? last.visitor : '',
        sortKey: (c.name || '') + '|' + (b.name || '') + '|' + u.number,
      }
    })
    .sort(function (a, b) { return a.sortKey.localeCompare(b.sortKey, 'ko') })
  writeSheet('세대',
    ['카드', '건물', '호수', '상태', '중국어', '마지막 방문일', '마지막 결과', '방문자'],
    unitRows.map(function (r) { return [r.card, r.building, r.number, r.status, r.chinese, r.lastDate, r.lastResult, r.visitor] }))

  // ── 탭3: 정기방문 ──
  const rvRows = returnVisits
    .map(function (rv) {
      const b = rv.building_id ? buildingById[rv.building_id] : null
      return {
        name: rv.nickname || rv.display_name || '',
        address: rv.address || (b ? b.address : '') || '',
        assignee: rv.assigned_user_name || '',
        lastDate: rv.last_visited_at || '',
        lastResult: rv.last_result || '',
      }
    })
    .sort(function (a, b) { return a.name.localeCompare(b.name, 'ko') })
  writeSheet('정기방문',
    ['대상', '주소', '담당자', '마지막 방문일', '마지막 결과'],
    rvRows.map(function (r) { return [r.name, r.address, r.assignee, r.lastDate, r.lastResult] }))

  // ── 탭4: 구역배정 (카드별 담당) ──
  const cardRows = cards
    .map(function (c) {
      const bCount = buildings.filter(function (b) { return b.card_id === c.id }).length
      return {
        region: c.region || '', area: c.area || '', card: c.name,
        leader: cardLeaders(c.id), buildings: bCount,
        sortKey: c.name,
      }
    })
    .sort(function (a, b) { return a.sortKey.localeCompare(b.sortKey, 'ko') })
  writeSheet('구역배정',
    ['지역', '동', '카드', '담당 인도자', '건물수'],
    cardRows.map(function (r) { return [r.region, r.area, r.card, r.leader, r.buildings] }))

  // 갱신 시각 기록
  const ss = SpreadsheetApp.getActiveSpreadsheet()
  let info = ss.getSheetByName('갱신정보')
  if (!info) info = ss.insertSheet('갱신정보')
  info.clear()
  info.getRange(1, 1, 2, 2).setValues([
    ['마지막 갱신', new Date()],
    ['안내', '이 시트는 앱(Supabase)의 읽기 전용 사본입니다. 시트 직접 수정은 앱에 반영되지 않습니다.'],
  ])
}

// 시트 열 때 메뉴 추가 (수동 갱신용)
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🔄 봉사 데이터')
    .addItem('지금 갱신', 'refreshAll')
    .addToMenu()
}
