# Chinese Territory App — 프로젝트 컨텍스트

> **AI 에이전트 인수인계용. 작업 전 반드시 이 파일을 읽을 것.**
> 마지막 업데이트: 2026-09-06 — 전출자 정기방문 기록 보존·재배정 계약 추가

---

## 🆕 최근 변경 사항 (2026-08-29)

### 전출·계정 삭제 후 정기방문 기록을 보존한다 (2026-09-06)

계정이 없어져도 과거의 좋은 반응과 방문 이력은 없었던 일이 되지 않는다.
`return_visits`·`return_visit_logs`는 보존하고, 관리 화면에서 `담당자 재지정 필요`로
표시한 뒤 관리자가 새 담당자를 고른다. 재배정은 `return_visits`와 `regular_visits`를
한 트랜잭션에서 함께 맞춘다. **사용자 삭제 정리라는 이유로 방문 기록을 지우지 말 것.**

결정 이유·불변 계약·운영 사례: `docs/decisions/0001-preserve-orphaned-return-visits.md`

정기방문 종료는 장소 삭제와 분리한다. 종료 시 건물·세대·방문 기록은 보존하고 현재
`regular_visits`만 해제한다. 철거·중복·오기입은 `place_change_requests`로 관리자에게
보낸다. 결정 이유와 불변 계약: `docs/decisions/0002-end-return-visits-and-report-place-changes.md`

### 보안 — anon 쓰기 차단 **완료** ✅ (2026-08-31 재잠금)

**앱 주소만 알면 회중 자료를 고치고 지울 수 있던 문이 닫혔다.**

```
EMERGENCY_open_*        0개  ← 2026-08-31 재잠금으로 전부 제거
세션 관문 정책         86개  (TEMP_session_gate_*)
SELECT 재현            26개
열린 쓰기 정책          0개
역할 상승 차단 트리거   있음
```

밖에서 anon 키로 확인: `visit_histories` · `units` · `regular_visits` ·
`event_participants` · `event_card_assignments` 전부 **401 거부**.

**중간에 한 번 되돌렸던 이유** (같은 실수를 반복하지 않기 위해 남긴다):
8/30 봉사 중 **62명 중 38명이 저장을 못 했다.** 세션은 30일 뒤 만료되는데 앱은
localStorage 만 보고 로그인 상태로 뒀다 — **토큰이 만료된 줄도 모르고 쓰고 있었다.**
전환 전에 "새 앱을 받았나" 만 봤고 **"토큰이 있나" 를 안 셌다.**
`select count(distinct user_id) from auth_sessions where expires_at > now()` 한 줄이면 보였다.

고쳤다: **슬라이딩 만료**(쓰면 30일 연장) + **토큰 없으면 로그인 화면**.
→ 새 전도인은 로그인하면 토큰이 생기므로 이 문제는 다시 안 생긴다.
⚠ 아직 다시 로그인 안 한 사람은 **첫 저장 때 실패**한다. "앱에서 다시 로그인" 안내.

**다시 잠글 일이 생기면** (도구는 그대로 있다):
```bash
npm run status:security       # 토큰 범위·정책·최근 cron 읽기
npm run backup                # 30분 이내 백업이 없으면 apply:relock 이 거부한다
npm run apply:relock -- --confirm <project-ref>
```
급히 되돌려야 하면 `npm run apply:emergency-open -- --confirm <project-ref>`.
복구는 `app_users` 를 **절대 열지 않고** 나머지 26개만 연다.

이 단계는 당시 1차 봉쇄였다. 이후 `20260907_*_finalize_*` 마이그레이션으로
역할별 권한 전환을 마쳤다. **2026-09-22 운영·데모 실측은 TEMP 정책 0개**이며,
`app_users` 전체표 SELECT 권한도 0개다. 새 회중은 `_VERIFY_new_project.sql`에서
같은 조건이 모두 `ok`인지 확인한다.

⚠⚠ **Supabase SQL Editor 는 `begin; … commit;` 을 지키지 않는다.** 실측했다 —
마지막 검증만 실패했는데 앞의 정책 112개는 그대로 남았다. 되돌리기 어려운
마이그레이션은 **반드시 `psql --single-transaction`** 으로. 그래서 파일 안에
`begin/commit` 을 **넣지 않는다** (같이 있으면 파일의 commit 이 중간에 커밋해
원자성이 오히려 깨진다).

⚠ **비밀번호를 명령줄에 쓰지 않는다** — `~/.zsh_history` 와 `ps` 에 남는다.
`.env.local` 의 `SUPABASE_DB_URL` 에서 읽고 psql 에는 `PGPASSWORD` 로만 넘긴다.
접속은 **Session pooler(5432)**. 직접연결(`db.<ref>.supabase.co`)은 IPv6 전용이라 안 닿는다.
⚠ `supabase` CLI 의 `--linked` 는 **운영에 링크돼 있다.** 쓰지 말 것.

역할별 권한 전환은 2026-09-07 완료했고 2026-09-22 운영·데모에서
**TEMP 정책 0개**를 다시 확인했다. 이 조건은 새 회중 설치 검증에도 포함돼 있다.

### ⚠⚠ definer RPC 는 RLS 를 우회한다 — 표만 막으면 뒷문이 열려 있다

**"표를 못 지운다" 와 "자료를 못 지운다" 는 다른 말이다.** 2026-08-29 에 크게 데었다.
표 쓰기를 다 막고 "닫혔다" 고 했는데, anon 이 부를 수 있는 `security definer`
함수가 **65개** 남아 있었다. 그중엔 **회중 전원에게 푸시를 쏘는 것**과
**방문기록을 날짜로 지우는 것**이 권한 검사 없이 열려 있었다.

9개를 먼저 닫았고, 이후 필요한 관리 함수를 서버 권한 검사와 함께 다시 열었다.
2026-08-30 운영 실측은 **anon 이 실행 가능한 definer 함수 62개**다. 이 숫자는
보안 판정값이 아니다. 트리거 함수와 권한을 검사하는 공개 wrapper가 포함되므로,
새 함수마다 실행권한과 본문 검사를 함께 감사한다.

```bash
# **새 security definer 함수를 만들 때마다 돌릴 것**
supabase/tools/_AUDIT_anon이_부를수있는_definer.sql
```

임시로 회수했던 관리 함수에는 서버 권한 검사를 넣고 운영에 다시 열었다:
`delete_old_visit_histories` · `cleanup_old_data` · `manual_reset_met_units` ·
`update_daily_service_settings` · `update_global_push_quiet_settings`.
`get_login_logs`와 `auto_close_stale_sessions`의 서버 검사도 같은 배포에 포함했다.
`20260830_1700`, `1710`, `1720`은 **2026-08-30 운영 적용 완료**.
테스트 DB 권한 매트릭스·API smoke와 운영 읽기 검증(네 결과 집합 모두 0행)이 통과했다.
이 과정에서 방문기록 날짜 컬럼을 text와 비교해 미리보기·삭제·자동 초기화가 실패하던
기존 버그도 date 비교로 수정했다. 파괴적 관리 작업은 smoke 목적으로 실행하지 않는다.

운영 적용 도구: `npm run apply:security-followup -- --confirm <project-ref>`.
이미 적용됐으므로 같은 마이그레이션을 다시 실행할 이유는 없다.

⚠ `SECURITY DEFINER` 함수 안의 `current_user`는 호출자가 아니라 함수 소유자다.
cron과 HTTP를 이 값으로 구분하면 anon도 통과한다. 공유 작업은 비공개 core와 권한을
검사하는 public wrapper로 나눈다.

`cleanup-chat-images`는 운영 v8 배포 완료. 비밀키 존재와 무인증 HTTP 401을 확인했다.

### 지도 핀 — 색=성격 / 채움=진행 (2026-08-31)

**"완료로 보여서 안 가던" 문제를 고쳤다.** 104·105호만 등록된 건물에서 둘 다
방문하면 100% 가 되어 초록(완료)이 됐다. 실제로는 호수가 더 있는데.
정기방문도 같았다 — 세대 하나만 정기방문이면 **건물 전체가 금색**이라
미방문 10세대가 있어도 지나쳤다.

원인은 하나다. **색 하나에 성격과 진행을 우겨넣어 하나가 다른 하나를 가렸다.**

```
파랑              아직 갈 곳이 있다
속 빔 + 초록 테두리  등록된 건 다 갔다. **세대를 다 파악했는지는 모른다**
꽉 찬 초록         다 갔고 파악됨 — 안 가도 됨
속 빔 + 금색 테두리  정기방문인데 갈 곳이 남았다
꽉 찬 금색         정기방문만 남고 끝
```

`buildings.units_surveyed` 를 사람이 켠다 ('세대 확인 완료').
모바일은 건물 `⋯` 메뉴, PC 는 **세대 추가·일괄 추가 옆**(다 넣은 직후가 누를 때).
PC 건물 목록엔 `세대 확인` 필터(`전체/확인필요/확인됨`)가 있다 — 몰아서 정리하는 자리.

⚠ **판정은 `utils/buildingPin` 한 곳에 있다.** 예전에 지도 핀과 선택된 핀을
  두 곳에서 따로 그려서(`markerIconUrl`/`markerHtml`) 누를 때만 색이 달라졌고,
  PC 지도의 범례·목록도 옛 판정을 써서 지도와 어긋났다.
  **같은 판정을 두 곳에서 쓰면 반드시 어긋난다.**

⚠ 테두리를 얇게(2px) 했더니 **실제 크기에서 안 보였다.** 지도 핀은 26px 쯤이다.
  그래서 **속을 비운다** — 색보다 형태가 먼저 눈에 들어온다.

### 글씨 크기 설정 (2026-08-29 배포)

나이 드신 분들이 글씨가 작아 못 보신다. **기본 화면은 그대로 두고** 설정에서
보통/크게/아주 크게. `#root` 에 `zoom` 을 건다 — 글씨 크기를 정하는 곳이
**2,515곳이고 전부 px** 이라 다 바꾸는 대신 통째로 확대한다.

⚠ **`zoom` 안에서는 화면높이 단위가 그만큼 커진다** (실측: 100svh 가 812 → 1015).
`vh/svh/dvh` **43곳**을 `calc(… / var(--app-zoom, 1))` 로 나눠 두었다.
**새로 vh 를 쓸 때도 그렇게 할 것** — `src/lib/fontScaleGuard.test.ts` 가 잡는다.

⚠ **`document.body` 로 포털하지 말 것.** zoom 은 `#root` 에 걸리므로 body 로 붙인
알림·채팅·확인창은 **큰 글씨로 설정한 분에게 그것만 작게** 보인다.
`src/lib/overlayRoot.ts` 를 쓴다 (감시 시험이 잡는다).

### 점검 공지 팝업

`app_settings` 로 **배포 없이** 켜고 끈다 (`supabase/tools/_점검공지_켜고끄기.sql`).
체크박스를 눌러야 닫히고, 확인 기억은 **사용자별·공지별**이다.
본문은 언어별 칸이 따로 있고 없으면 한국어로 떨어진다.

### PWA — 새 버전은 기다리고, 사용자 버튼으로 적용한다 (2026-09-05)

`registerType: 'prompt'`. 최상위 skipWaiting과 activate의 강제 navigate를 쓰지 않는다.
20초 자동 적용도 제거했다. 새 버전 알림에서 입력을 저장한 뒤 적용한다.
SKIP_WAITING 전송 후 실제 controllerchange를 확인하고 창당 한 번만 새로고침한다.
같은 origin의 다른 앱 창도 함께 갱신되므로 안내에 명시한다. clientsClaim은 유지한다.
waiting 동안 옛 precache가 살아 있어 배포 후에도 옛 lazy 청크를 읽을 수 있다.
첫 전환에서는 옛 앱의 업데이트 UI가 동작하지 않을 수 있어 한 번 종료가 필요할 수 있다.

로딩 12초 뒤 수동 복구 버튼, 데이터 로딩 45초 뒤 오류 표시. 로그인 저장소·푸시 등록·
Cache Storage 전체를 지우지 않는다. DB 변경은 구버전 호환을 별도로 유지해야 한다.
`scripts/smokePwaUpdate.mjs`: 실제 SW와 UI로 두 배포·두 창·오프라인·수동 적용 시험.
`PLAYWRIGHT_MODULE`에 설치된 Playwright 모듈 경로를 지정할 수 있다.

### 로그인 기록 — 자동 로그인도 남긴다 (하루 한 번)

예전에는 `auth_record_auto_login` 이 `last_login_at` 만 갱신하고 `login_logs` 에는
안 넣어서, **자동 로그인만 하는 사람은 기록이 옛 날짜에 멈춰 보였다**
(2026-08-29 실측: 45명 접속 · 기록 4건. 어떤 분은 8월 10일에 멈춰 있었다).

고쳤다 (`20260829_2330_auto_login_record.sql`, 운영 적용).
⚠ **하루 한 번만** 남긴다 — 이 함수는 앱을 열 때마다 불려서, 그대로 넣으면
한 사람이 하루 열 번씩 쌓여 목록이 쓸모없어진다. 날짜는 **한국 시간** 기준
(UTC 로 하면 아침 9시 전 접속이 '어제' 로 잡혀 하루에 두 번 남는다).
⚠ 기록에 실패해도 **로그인을 막지 않는다** (함수 안에서 삼킨다).
⚠ 이 함수는 `revoke` 하지 않는다 — **anon 이 불러야 하는** 함수다.

---

## 이전 변경 사항 (2026-08-27~28)

### 알림 개편 (운영 적용 완료)

반복 일정을 한 번 고쳤더니 **알림 92건이 6명에게** 나갔다. 고친 것:

- 반복 수정은 묶어서 **한 번만** 보낸다 (`update_calendar_event_series_tx`)
- 단일·반복·공지 모두 **"알림 보낼까요?"** 를 묻는다 — 단 *실제로 나갈 변경일 때만*
  (트리거가 보는 여섯 칸: 날짜·시간·장소·지도링크·인도자·제목. 메모만 고치면 안 묻는다)
- **보낼지는 서버가 정한다.** 화면 판단(`utils/eventNotify`)은 '물어볼지' 만 정한다
- **알림 끈 사람에게 푸시가 가던 것**을 막았다 — `insert_notifications` 만 걸렀고
  `dispatch_push_notification` 은 원본 목록을 받았다. 여덟 경로가 전부 그랬다
- ⚠ **실제 보안 구멍이었다**: 그 두 함수는 `security definer` 인데 revoke 가 없어
  **anon 키만으로 회중 전원에게 임의 푸시를 쏠 수 있었다.**

### 오늘 생긴 규칙 (어기면 조용히 샌다)

| | |
|---|---|
| **`security definer` 함수를 만들면 반드시 `revoke`** | PostgreSQL 은 만들 때 PUBLIC 에 실행권한을 준다 |
| **알림 종류를 새로 만들면 `filter_notification_recipients` 도 고친다** | 모르는 종류는 `else false` 로 **아무한테도 안 간다** (fail-closed). 안 고치면 조용히 안 감 |
| **사용자 이름을 FK 대신 문자열로 담는 칸을 만들면 `rename_user_name_references` 에 추가** | 이 앱은 사람을 이름 문자열로 들고 있다 (22칸). 안 넣으면 이름 바꿀 때 옛 이름이 남는다. **건물명·카드명 같은 다른 이름은 해당 없다** |
| **`app_users.role`·`approval_status`·`is_active` 를 쓰는 `security definer` 함수를 만들면 그 안에서 권한을 직접 확인한다** | 역할 상승 차단 트리거는 `current_user='postgres'` 를 통과시키는데, **definer 함수 안이 바로 그 상태**다. 트리거가 안 막아 준다 |
| **행별 트리거가 한 작업에 중복 알림을 낼 때만 억제한다** | `set_config('app.suppress_notifications','on',true)` (트랜잭션 안에서만 유효). 끄고 끝내지 말고 **작업 뒤 요약 알림을 한 번 보낸다** — 무조건 억제하면 필요한 알림까지 조용히 사라진다 |
| **`storage.objects` 정책은 `alter ... rename` 이 안 된다** | 소유자가 `supabase_storage_admin` 이라 `postgres` 는 42501 을 받는다. **대시보드 SQL Editor 도 똑같이 실패한다** (거기도 postgres 다). `create`/`drop` 은 되므로 **지우고 다시 만든다** — 한 트랜잭션 안에서 |
| **쓰기 뒤에는 `.select()` 로 바뀐 행이 있는지 본다** | PostgREST 는 RLS 로 막힌 UPDATE/DELETE 에 **오류가 아니라 0행**을 준다. `error` 만 보면 앱이 "저장했습니다" 를 띄우고 아무것도 안 바뀐다. `ensureAffectedRows` 를 쓰고, Storage 의 `remove` 도 같은 이유로 **지워진 개수**를 본다 (막혀도 빈 배열을 준다). `writeResultGuard.test.ts` 가 감시한다 |

### 검증 도구 (새로 생김 — 다음에도 쓸 것)

```
supabase/tools/_TEST_알림권한_매트릭스.sql   17칸. 권한·알림건수·본인제외·DB 롤백
npm run smoke:notify                        API 경유 (스키마 캐시·실행권한·진짜 토큰)
npm run smoke:headers                       request.headers 가 정책에 오는지
```

⚠ 알림 건수는 **id 물길**로 센다. `now()` 는 트랜잭션 **시작** 시각이라
`clock_timestamp()` 기준 비교는 아무것도 못 잡는다.

⚠ 매트릭스는 열일곱 칸이 **한 트랜잭션**에서 돈다. 운영은 호출마다 트랜잭션이 다르다.
칸마다 `app.suppress_notifications` 를 초기화한다.

### 구조 정리 (진행 중)

`DesktopTerritory.tsx` 2815 → 2346줄. 뺀 것:

```
utils/csvBuildingImport   parseBuildingCsv(파서 300줄) · parseBuildingCsvFile(안 던진다)
utils/filterTerritoryCards · filterBuildings · buildPointRows   필터 삼형제
utils/territoryTableSort · chooseCardForBuilding · visibleSelection
components/CsvImportModal(props 7) · DuplicateBuildingMergeModal(5) · TerritoryDetailPane(8)
```

**떼기 전에 의존성을 센다.** 카드 표는 335줄에 바깥 값 61개라 아직 안 뗐다
(기준: 자식이 쓰는 값 10개 이하). "689줄 74개" 를 통째로 보면 답이 없는데
경계를 나누니 상세 패널(13→8개)이 떨어졌다.

### 시험 습관 (오늘 다섯 번 데었다)

**통과하는 시험과 무는 시험은 다르다.** 오늘 헛돌던 시험:

- '대상외' 를 시험하며 상태를 안 줘서 **어느 쪽이든 false** 라 통과
- '본인 제외' 를 관리자로 시험 — 관리자는 수신자 후보가 아니라 **저절로 참**
- '한 명이 받았다' 만 봐서 **엉뚱한 한 명**이어도 통과
- 대상자를 안 붙여 **아무한테도 안 갔는데** 통과
- '취소 버튼 클릭' — `disabled` 라 **클릭이 안 들어가** 잠금을 빼도 통과

→ **시험을 쓴 뒤 반드시 코드를 일부러 망가뜨려 그 시험만 실패하는지 본다.**
→ **검사를 다른 검사의 성공 안에 넣지 말 것** (칸 14 가 깨지자 16·17 이 통째로 안 돌았다).

---

## 이전 변경 사항 (요약)

- **2026-08-25~26**: 중복 건물 병합 트랜잭션 RPC, 비공식 봉사만 맡은 팀 처리
  (`event_card_assignments.assigned_card_id` null 허용), 게스트 참가,
  이름 바꾸기·사용자 삭제 시 이름 잔재 정리 RPC
- **2026-08-24**: 운영 스키마 baseline 확보 (`supabase/baseline.sql` + `baseline-extras.sql`),
  테스트 Supabase 프로젝트(`field-map-test`) 신설, `scripts/testEnvGuard.js` 로
  테스트가 운영을 못 건드리게 막음
- **2026-06-03**: 전역 Confirm/Alert, `getCurrentVisitor()` 의 이름 fallback 제거,
  PC 일정 편집 권한을 모바일과 통일, Realtime 재연결 시 catch-up refetch, lint 0, vitest 도입
- **2026-05-14**: PWA 자동 갱신 + 풀-투-리프레시, 채팅/배정 Realtime 구독,
  카톡식 알림 그룹화, PWA 업데이트 버튼

⚠ **Vercel 프로젝트 이름·주소를 바꾸지 말 것.** 현재: https://chinese-territory-app.vercel.app/
주소가 바뀌면 80명의 홈화면 PWA 가 옛 주소를 가리킨 채 남고, **로그인 세션과
푸시 구독이 전부 무효가 된다** (둘 다 origin 에 묶여 있다).

---

## 0. 프로젝트 개요

- **목적**: 80명 규모 한 회중의 중국인 봉사 구역 관리 (PC + 모바일)
- **사용자**: 단일 회중 내부 사용 (외부 배포 X)
- **앱 이름**: 필드맵 (Field Map) — 사용자에게 보이는 이름 (PWA manifest)
- **배포 주소**: https://chinese-territory-app.vercel.app/ (바꾸지 말 것 — 위 메모 참고)
- **GitHub**: https://github.com/macgongming-beep/field-map

---

## 1. 스택 / 빌드 / 배포

| | |
|---|---|
| 프론트엔드 | React 19 + TypeScript + Vite |
| 백엔드 | Supabase (PostgreSQL + REST + RPC) |
| 지도 | 네이버 지도 API |
| 라우팅 | react-router-dom 7 |
| 호스팅 | Vercel (GitHub `main` 브랜치 자동 배포) |

```bash
npm run dev        # 개발 서버 (Vite, --host 로 LAN 접근 가능)
npm run build      # 빌드 검증 (tsc -b && vite build)
npm run lint       # ESLint (0 유지)
npm test           # vitest run (순수 로직 단위 테스트 49개)
npm run test:watch # vitest watch 모드
npm run backup     # Supabase 전체 백업 (scripts/backup.js)
```

**환경변수 (`.env.local`, gitignore 됨)**:
```
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
VITE_NAVER_MAP_CLIENT_ID=...
SUPABASE_SERVICE_ROLE_KEY=...   # 백업 스크립트용 (RLS 우회)
```

배포 흐름: `git push origin main` → Vercel 자동 빌드 → 라이브.

---

## 2. 인증 / 보안 (현재 상태)

### 자체 인증 (Supabase Auth 사용 안 함)
- 사용자가 `app_users` 테이블에 저장됨 (`login_id`, `name`, `pin`, `role`, `phone`)
- 로그인은 **`auth_login` RPC** 호출 (서버 측 bcrypt 검증)
- 세션은 `localStorage.auth_session` 에 저장 (단순 사용자 정보)
- `useAuth.ts` 훅이 모든 인증 로직 담당

### 비밀번호 보호 ✅ 완료
- `app_users.pin` 은 **bcrypt 해시**로 저장 (cost=10)
- 트리거 `hash_pin_if_plain` 이 INSERT/UPDATE 시 평문 → 해시 자동 변환
- 클라이언트는 PIN 컬럼을 **SELECT 할 수 없음** (REVOKE)
- 로그인 검증은 `auth_login(login_id, pin)` RPC 에서만 가능

### 로그인 기록 보호 ✅ 완료
- `login_logs` 테이블: 로그인 시각 (초단위) 기록
- 직접 SELECT 차단, **`get_login_logs` RPC** 로만 조회 가능
- 본인 기록은 누구나, 다른 사람 기록은 developer 만 (클라이언트 측 체크)

### RLS 현 상태 (2026-09-22 실측)
- TEMP 정책은 운영·데모 모두 **0개**다. 쓰기는 역할·소유권 정책으로 전환했다.
  Realtime 때문에 공개 SELECT가 필요한 표는 쓰기 정책과 별도로 관리한다.
- `app_users`: PIN 컬럼 SELECT 차단 ✅ · INSERT 는 관리자만 · UPDATE 는 **본인 또는 관리자** ·
  role·approval_status·is_active 는 트리거가 한 겹 더 막는다
- `login_logs`: 직접 SELECT 차단 ✅
- 열린 `FOR ALL` 은 `app_private_settings_deny_all` **하나뿐**

새 회중에서도 `supabase/tools/_VERIFY_new_project.sql`로 TEMP 정책 0개와
`app_users` 전체표 SELECT 권한 0개를 확인해야 한다.

### 백업 ✅ 완료
- `npm run backup` → `backups/YYYY-MM-DD/*.json` 18개 테이블 저장
- `backups/` 는 gitignore 됨 (민감 정보 보호)
- macOS launchd 자동 실행 가이드는 `scripts/README.md` 참고

---

## 3. 역할(Role) 구조

```
developer → admin 의 모든 권한 + 다른 사용자의 로그인 기록/방문 통계 조회
admin     → 전체 관리, 사용자 추가/삭제, 카드 인도자 배정
leader    → 담당 카드 관리, 봉사 인도
user      → 방문 기록, 일정 신청
```

- DB `role` 컬럼: `'user' | 'leader' | 'admin' | 'developer'`
- 다른 사용자에게 developer 는 admin 으로 표시됨 (`fetchAllUsers` 에서 마스킹)
- 권한 체크 함수: `isAdminLike(role)` (admin OR developer)

---

## 4. 아키텍처

### 데이터 흐름
```
Supabase DB
    ↓ fetchAll() (useStore.ts)
useStore (cards, buildings, calendarEvents, notices, ...)
    ↓ props (App.tsx 에서 분기)
DesktopApp (PC)  /  MobileHome (모바일)
    ↓ 콜백 (onCreateXxx, onDeleteXxx)
useStore mutate → Supabase write → fetchAll() 재호출
```

### PC 라우팅 (React Router)

| 경로 | 탭 | 컴포넌트 |
|---|---|---|
| `/` | 홈 | `DesktopHome` |
| `/notices` | 공지 | `DesktopNotices` |
| `/calendar` | 캘린더 | `DesktopCalendar` |
| `/zone` | 구역 | `DesktopTerritory` (관리자/인도자) |
| `/territory` | 나의봉사 | `DesktopTerritory` (개인 시점) |
| `/map` | 지도 | `DesktopMap` |
| `/assignment` | 배정 | `DesktopLeaderAssignment` / `DesktopAdminAssignment` |
| `/users` | 사용자 | `DesktopUsers` |
| `/stats` | 통계 | `DesktopStats` |
| `/settings` | 설정 | `DesktopSettings` |

### 모바일 탭 (`MobileHome.tsx`)
역할별 5탭: 홈 / 캘린더 / 구역(또는 내 카드) / 공지 / 설정

---

## 5. 핵심 파일 맵

```
src/
├── App.tsx                  # 최상위 wiring (useStore → Desktop+Mobile 분기)
├── App.css                  # 전체 스타일 (모바일 → 760px → 980px PC)
├── index.css                # 디자인 토큰 (CSS 변수)
├── main.tsx                 # BrowserRouter 래핑
├── types.ts                 # 공유 타입 + Role/PERIOD_COLORS 등 상수
├── i18n.ts                  # 다국어 (현재 한국어만)
├── hooks/
│   ├── useStore.ts          # ⚠️ 2300+ 줄 — 모든 상태 + Supabase fetch/mutate
│   └── useAuth.ts           # 인증 + 사용자 관리 + 로그인 기록
├── lib/
│   ├── supabase.ts          # Supabase 클라이언트
│   └── toast.ts             # 전역 토스트 이벤트 버스
├── utils/                   # ⚠️ 중복 정의 금지 — 아래 공용 유틸 재사용할 것
│   ├── visitStrategy.ts     # 방문 전략 파생 (재시도/정기방문)
│   ├── cardSearch.ts        # 카드 검색/정렬
│   ├── koreanSearch.ts      # matchesName (이름 부분일치 + 초성 검색)
│   ├── dateUtils.ts         # getLocalDateString (로컬 YYYY-MM-DD)
│   ├── specialPeriod.ts     # findActivePeriod / findActivePeriodId (특별봉사 기간 판정)
│   └── mapUtils.ts          # 지도 좌표 유틸 + getBuildingStatus
├── locales/                 # i18n 번역 사전 (ko/zh/en, i18n.ts 에서 분리)
│   ├── ko.ts / zh.ts / en.ts          # 화면 문구 (키 기반: t(lang, 'map.save'))
│   ├── messages.zh.ts / messages.en.ts # 토스트·오류 문구 (한국어 원문이 열쇠)
├── data/
│   ├── territoryStructure.ts  # 지역/동 데이터
│   ├── territoryBoundary.ts   # 행정구역 폴리곤
└── components/
    ├── DesktopApp.tsx          # PC 레이아웃 + Routes
    ├── DesktopHome.tsx         # PC 홈
    ├── DesktopCalendar.tsx     # PC 캘린더
    ├── DesktopTerritory.tsx    # PC 구역 관리 (2346줄 — 정리 진행 중)
    ├── DesktopMap.tsx          # PC 지도 (2752줄)
    ├── DesktopMyService.tsx    # PC 나의 봉사
    ├── DesktopSettings.tsx     # PC 설정
    ├── DesktopStats.tsx        # PC 통계
    ├── DesktopTerritoryRegions.tsx  # 지역 관리
    ├── DesktopAdminAssignment.tsx / DesktopLeaderAssignment.tsx
    ├── MobileHome.tsx          # 모바일 메인 (탭 라우팅)
    ├── UserMobileHome.tsx      # 일반 사용자용 모바일 홈
    ├── MobileTerritory.tsx / MobileMap.tsx / MobileNotices.tsx / MobileUsers.tsx
    ├── MobileAdminAssignment.tsx / MobileProfileSettings.tsx
    ├── admin/                  # 관리자 전용 화면
    │   ├── AdminMobileCalendar.tsx  (1862줄)
    │   ├── AdminEventDetailSheet.tsx / AdminMobileHome.tsx
    │   ├── AdminMobileZone.tsx / AdminSuggestions.tsx
    │   └── sharedAssignmentTeams.ts  # 팀 묶기 (teamKey 기준)
    ├── assignment/             # 팀 구성 & 구역 배분
    │   ├── AssignmentEditor.tsx / TeamBuildScreen.tsx / ZoneAssignScreen.tsx
    ├── MapCanvas.tsx           # 네이버/Mock 지도 (2133줄)
    ├── CsvImportModal.tsx           # CSV 업로드 (상태 6개를 여기서 들고 있다)
    ├── DuplicateBuildingMergeModal.tsx  # 중복 주소 합치기 (카드 병합과 **다른 기능**)
    ├── TerritoryDetailPane.tsx      # 구역 카드 상세 (오른쪽 패널)
    ├── ServiceSuggestionsSection.tsx # 대화 방법 제안 (링크 자동 인식)
    ├── SpecialPeriodBanner.tsx / SpecialPeriodSettings.tsx
    ├── Login.tsx + Login.css
    └── Toast.tsx               # 전역 토스트 렌더러

⚠ 이 목록은 자주 낡는다. **의심되면 `ls src/components/` 를 먼저 볼 것.**
(옛 문서에 없어진 파일 다섯 개가 남아 있었다: MobileCalendar · DesktopNotices ·
DesktopUsers · MobileLeaderAssignment · sampleData)
```

**거대 파일** (2026-08-28 실측):
```
DesktopMap.tsx            2752   ← 다음 후보
MobileMap.tsx             2406
DesktopTerritory.tsx      2346   진행 중 (2815 에서 줄임)
MapCanvas.tsx             2133
AdminMobileCalendar.tsx   1862
MobileTerritory.tsx       1686
MobileHome.tsx            1521
```
`useStore.ts` 는 934줄로 이미 쪼개졌다 (옛 문서에 2300줄이라 적혀 있었다).

⚠ **떼기 전에 의존성을 센다.** 자식이 쓰는 값이 10개 이하일 때만 뗀다.
20개 이상이면 떼지 말고 **경계를 다시 잡는다** — 구획 하나를 통째로 보면
답이 없어도 나누면 떨어지는 것이 나온다.

---

## 6. Supabase 테이블

```sql
-- 사용자/인증
app_users           id, login_id, name, pin (bcrypt), role, phone, last_login_at, created_at
login_logs          id, user_id, logged_in_at

-- 구역/카드
cards               id, name, area, region, type, status, leader_name
card_assignments    card_id, user_name
card_leader_assignments  card_id, leader_name
card_boundaries     card_id, points (GeoJSON), updated_at

-- 건물/세대
buildings           id, card_id, name, address, type, lat, lng, warning, memo
units               id, building_id, number, status, is_chinese, memo

-- 방문/봉사
visit_histories     id, unit_id, visitor, result, time_slot, memo, visited_at,
                    special_period_id, invitation_left
regular_visits      id, unit_id, visitor_name
service_sessions    id, user_name, role, calendar_event_id, primary_card_id, ...

-- 캘린더/일정
calendar_events     id, event_date, time, title, type, place, leader_name,
                    card_name, has_meeting, memo, series_id, allow_applications
event_participants  event_id, user_name, role
event_card_assignments  event_id, user_name, ...
event_card_assignment_cards  assignment_id, card_id

-- 기타
notices             id, title, content, priority, author, created_at
special_periods     id, label, start_date, end_date, color
review_tasks        id, title, content, status, completed_at, created_at
```

### 명명 규칙
- DB 는 **snake_case**, TS 타입은 **camelCase** → `useStore.ts` transform 함수에서 변환
- 예: `calendar_events.event_date` → TS `.date`
- `notices.priority`: DB 영어 (`normal`) → `PRIORITY_MAP` 으로 한국어 변환

### RPC 함수 (Supabase)

**인증**
- `auth_login(p_login_id, p_pin)` — bcrypt 검증 + last_login_at + login_logs. **세션 토큰을 돌려준다**
- `signup_tx(p_login_id, p_name, p_pin)` — 가입. **역할·승인상태를 서버가 강제** (user/pending)
- `verify_session(p_token)` — 검증 + last_used_at 갱신 + 비활성/미승인이면 세션 삭제.
  ⚠ **부작용이 있어 RLS 정책에서 쓰면 안 된다**
- `private.request_session_user_id()` — 요청 헤더의 토큰으로 사람을 찾는다. **읽기 전용**.
  정책에서는 `(select …)` 로 감싼다. `request_session_role()` · `request_is_admin()` 도 있다

**알림** (전부 관리자/권한 검사 있음)
- `update_calendar_event_tx` / `update_calendar_event_series_tx` — 일정 수정 + 알림 보낼지
- `create_notice_tx` — 공지. 관리자만
- `filter_notification_recipients(ids, type)` — 수신자 필터. **anon 에 안 열려 있다**

**자료**
- `import_building_tx` — CSV 건물 하나를 통째로 (건물+세대+정기방문+방문기록)
- `assign_cards_bulk_tx` — 인도자 배정 (충돌 감지)
- `merge_duplicate_buildings_tx` — 중복 주소 건물 병합
- `rename_user_name_references` / `purge_user_name_references` — 이름 바꾸기·사용자 삭제 뒷정리

**트리거 함수** (직접 호출 X)
- `hash_pin_if_plain`, `notify_on_*` 여덟 개, `dispatch_push_notification`, `insert_notifications`
  ⚠ 뒤의 둘은 **anon 에 안 열려 있다** (열려 있으면 아무나 임의 푸시를 쏜다)

### SQL 파일 위치 (2026-08-25 개편)
- `supabase/baseline.sql` + `baseline-extras.sql` — 빈 DB 를 세우는 사진.
  `schema.sql` 은 12/39 테이블짜리 옛 것이라 쓰지 않는다
- `supabase/migrations/` — **baseline 뒤에 DB 를 바꾸는 것은 전부 여기.**
  이름은 `YYYYMMDD_HHMM_무엇.sql`. 운영에 적용한 뒤에도 **여기 남긴다.**
  빈 DB 를 세울 때 이름 순서대로 전부 실행하기 때문이다
- `supabase/applied/` — baseline 이전의 옛 기록. 설치 때 실행하지 않는다
- `supabase/tools/` — 읽기 전용 점검·추출

⚠️ **적용했다고 `migrations/` 밖으로 옮기지 말 것.** 옮기면 새 회중 설치에서
그 변경이 통째로 빠진다. 실제로 그럴 뻔했다 — 중복 병합 RPC 를 운영에 넣고
`applied/` 로 옮겼더니, 빈 프로젝트를 세우면 병합이 안 되는 상태가 됐다.

---

## 7. CSS 구조 (App.css + index.css)

```
index.css        디자인 토큰 (CSS 변수: --primary-*, --gray-*, --radius-*, --shadow-*)
App.css          [모바일 공통] 0px~
                 @media 760px   탭 레이아웃
                 @media 980px   PC (.desktop-*, .home-*, .cal-*, .map-*)
```

- 모바일 바텀시트: `.mobile-sheet`, `.mobile-sheet-backdrop`, `.mobile-form-field`
- PC 모달: `.cal-modal-backdrop`, `.cal-modal`
- 모바일 하단탭: `.bottom-nav` (grid `repeat(5, 1fr)`)
- 구역 테이블: `.tbl`, `.tbl-seg-tab`, `.tbl-chip`, `.tbl-filter-layer`
- 지도: `.map-toolbar`, `.map-panel-head`, `.map-card-item`, `.map-legend-card`

---

## 8. 구현 완료 / 미완료

### PC ✅
- 홈: 공지/봉사/구역 요약
- 캘린더: 월뷰, 일정 추가/수정/삭제, 반복일정, 참가자 배정
- 구역: 카드 목록/필터 (지역/동/배정), KPI, 인도자 배정, 지도 연동
- 지도: 건물 마커, 구역선 그리기/수정/삭제, 방문 기록, 정기방문, 운영 필터
- 공지: 목록/상세/작성/삭제
- 사용자 관리: 정렬, 사용자 추가 모달, 비밀번호 초기화/재설정, 권한 변경, 개발자 전용 로그인 기록 조회
- 설정: 특별봉사 시즌 관리, 나의 로그인 기록 (최근 7일)

### 모바일 ✅
- 홈, 캘린더, 구역, 공지, 지도 — 모두 동작
- 역할별 탭/기능 분기

### 미완료 / 향후 과제 (급한 순)
1. 구조 정리 이어가기 — DesktopMap · MobileMap · 카드 표
2. chat_messages SELECT 를 더 좁은 RLS 로 (지금은 `using (deleted_at is null)` open)
3. 정기방문 시작일이 날짜가 아니라 **ISO 시각**으로 저장된다 (`2026-01-01T03:00:00Z`).
   날짜 경계에서 하루가 밀릴 수 있다
- [x] CSV import — 건물 하나가 한 트랜잭션 (`import_building_tx`)
- [x] 자동화 테스트 — **984개** (vitest, 2026-09-22). 순수 로직 + 모달 조립 시험

---

## 9. 협업 규칙 (Claude / Codex / 기타 AI)

1. **이 파일을 먼저 읽기**
2. `git status --short` 로 다른 에이전트 변경사항 확인
3. 파일 수정 전 **반드시 Read** 후 Edit
4. 빌드 검증: `npm run build` (TS 에러 0 유지)
5. 작업 단위마다 commit + push (Vercel 자동 배포)
6. **DB 스키마 변경** 시: `supabase/*.sql` 파일 추가 + 사용자가 SQL Editor 에서 실행
7. **민감 작업** (PIN/RLS/마이그레이션): 사용자에게 백업 안내 후 진행
8. **거대 파일 수정** 시 부분 Read (offset/limit 사용)
9. 데이터 삭제·권한·자동 병합·화면 의미를 바꾸기 전에 `docs/decisions/README.md`를 읽는다.
   기존 결정을 바꾸면 문서를 지우지 말고 새 결정 기록으로 대체 이유를 남긴다.

### 문구 다국어 규칙
- **화면 문구**: `t(language, 'key')` — 컴포넌트는 `language` prop 을 받아 쓴다.
  props 로 못 받는 곳(이벤트 핸들러·모듈 상수)은 `t(currentLang(), 'key')`.
  ⚠️ `currentLang()` 은 i18n 모듈이 들고 있는 값이다. localStorage 를 직접 읽지 말 것
  (언어는 사용자별 키 `chsLanguage:<userId>` 에 저장된다).
- **토스트·오류 문구**: `showToast(msg('저장했습니다'))` — 한국어 원문이 그대로 열쇠다.
  번역은 `locales/messages.{zh,en}.ts` 에 추가한다. 사전에 없으면 한국어로 표시되므로
  번역을 빠뜨려도 화면이 깨지지 않는다. 값 끼워넣기는 `msg('{n}개 삭제', { n })`.
- **감시 테스트**: `src/locales/mobileKorean.test.ts` 가 모바일 화면에 번역 안 된
  한국어가 남아 있으면 실패한다. 새 문구는 `msg()` 로 감싸고, 번역하면 안 되는
  값은 그 파일의 `VALUE_WORDS` 에 추가한다. (`npm test` 로 확인)
- ⚠️ **번역된 문자열을 값 비교에 쓰지 말 것.** 라벨은 표시 전용이고, 판단은 코드 내부
  값(행 번호·상태 코드)으로 한다. (요일 라벨을 '주말' 과 비교해 생긴 버그 있었음)

### 데이터 접근 규칙 (2026-08-23 ~ ESLint 가 강제)

**화면 컴포넌트에서 `lib/supabase` 를 직접 import 하지 않는다.**
`src/components/**` 에 `no-restricted-imports` 가 걸려 있어 lint 가 실패한다.

```
데이터 읽기/쓰기 → hooks/storeMutations/* 또는 feature api 모듈
```

왜: 화면마다 실패 처리가 갈리고(어디는 토스트, 어디는 조용히), 저장한 뒤
다른 화면이 갱신되지 않고(fetchAll 을 안 부르니까), 테이블 이름이 화면에
흩어져 스키마를 바꿀 때 다 찾아야 한다.

**기존 위반 9개는 `eslint.config.js` 의 allowlist 에 사유와 함께 있다.**
⚠ **여기에 파일을 추가하지 말 것.** `scripts/check-supabase-allowlist.js` 가
개수를 지키고 `npm run lint` 에 물려 있어서, 늘리면 CI 가 실패한다.
파일을 옮길 때마다 그 스크립트의 `MAX` 를 **줄인다.**

### 시험 규칙 (2026-08-27 ~ 하루에 다섯 번 데었다)

**시험을 쓴 뒤 반드시 코드를 일부러 망가뜨려 그 시험만 실패하는지 본다.**
통과하는 시험과 무는 시험은 다르다. 헛돌던 예:
조건을 안 줘서 어느 쪽이든 참 · 검사 대상이 수신자 후보에 없어서 저절로 참 ·
'한 명이 받았다' 만 봐서 엉뚱한 한 명이어도 통과 · `disabled` 라 클릭이 안 들어감.

**검사를 다른 검사의 성공 안에 넣지 말 것.** 하나가 깨지면 여럿이 조용히 안 돈다.

**부모가 걸러 주기를 믿지 말 것.** 잎이 스스로 걸러야 부모가 잊어도 안 샌다
(다른 일정 배정이 팀에 붙어 보인 것, 푸시가 필터를 안 거친 것 모두 같은 모양이다).

### 절대 하지 말 것
- ❌ `.env.local` 커밋
- ❌ `backups/` 커밋
- ❌ Service Role Key 를 클라이언트 코드에 포함
- ❌ PIN 평문 저장 (트리거가 있지만 명시적으로도 해싱 의도 표현)

---

## 10. 디버깅 / 운영 메모

### 자주 만나는 문제
- **"왜 이 카드가 목록에 없지"**: `대상없음`(건물도 세대도 0개)은 '진행중' 으로 걸러도
  빠진다. `utils/filterTerritoryCards.test.ts` 가 규칙을 말해 준다
- **저장이 안 된다**: 오류 문구가 이유를 말해 준다 (`utils/dbError`).
  "서버 기능이 아직 준비되지 않았습니다" 면 마이그레이션을 안 넣은 것이다
- **알림이 안 온다**: 종류가 `filter_notification_recipients` 에 있는지 본다.
  없으면 `else false` 로 **아무한테도 안 간다**
- **`pbcopy` 는 이 환경에서 안 먹는다** (클립보드가 빈다). 파일로 주고받을 것
- **로그인 안 됨**: 브라우저 Console 에서 `[login] auth_login RPC failed` 확인. RPC 미등록 또는 `extensions.crypt` 권한 문제일 수 있음
- **사용자 목록 빈 화면**: anon 키로 PIN 컬럼 SELECT 시도 → REVOKE 됐는지 확인
- **백업 실패**: `.env.local` 의 `SUPABASE_SERVICE_ROLE_KEY` 누락
- **빌드 에러 (Role 타입)**: developer 추가 후 `Record<Role, ...>` 객체에 `developer` 키 누락 가능

### 모니터링
- Supabase Dashboard → Logs (에러 발생 시각/메시지)
- 사용자 관리 → 로그인 기록 (개발자 계정으로 봐야 보임)
- Vercel Dashboard → Deployments (배포 로그)
