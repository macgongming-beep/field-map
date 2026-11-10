# 방문 메모·재방문 주소의 비로그인 읽기 차단

- 상태: 승인·운영 적용 완료 (운영 기록: [0082](0082-production-private-visit-reads.md))
- 결정일: 2026-11-10
- 관련 기능: 방문기록, 재방문 목록·상세, 지도 변경 신호, 통계

## 배경

읽기 전용 점검에서 `visit_histories`, `return_visits`, `return_visit_logs`의
직접 SELECT가 세션 없이 허용되는 것을 확인했다. 메모와 주소를 담는 세 표부터
로그인 경계를 세운다. 연락처·로그인 아이디 조회 분리와 숨긴 댓글 알림 조회 제외는
별도 작업이다. 전화 걸기, 댓글 푸시, 알림 데이터는 이번에 변경하지 않는다.

## 결정

`20261110_1000_private_visit_reads.sql`은 세 표에 `AS RESTRICTIVE FOR SELECT`
정책을 추가한다. `anon`, `authenticated` DB 역할 모두 기존
`private.request_session_user_id()`가 유효한 사용자 번호를 반환해야 읽을 수 있다.
기존 permissive 정책이 여러 개 있어도 새 제한과 AND로 결합된다.

- 세션 없음·잘못된 토큰·만료·폐기·비활성·승인대기 계정은 결과가 0행이다.
- 로그인한 봉사자·인도자·관리자·개발자의 기존 조회 범위는 그대로다.
- 본인 기록만 허용하는 변경이 아니다. 통계·지도·공유 배정의 기존 범위를 보존한다.
- 기존 쓰기 정책, 함수, 자료, 권한 부여는 바꾸지 않는다.
- 기존 helper는 세션을 연장하거나 다른 행을 쓰지 않는다. `verify_session`을
  SELECT 정책에서 호출하지 않는다.
- 별도 앱 빌드 플래그가 없는 DB 보안 변경이다. 적용한 DB에서 즉시 작동한다.

## 실시간 계약

데모에서 세 표는 `supabase_realtime` 발행 대상이 아님을 확인했다.
지도는 `territory_change_signals`를 구독하고, 그 뒤 HTTP로 상세를 읽는다.
HTTP에는 `fetchWithSessionToken`이 세션 헤더를 붙인다. 변경 신호 표는 건드리지 않는다.

마이그레이션은 세 표 중 하나라도 직접 발행 중이면 예외로 중단한다.
WebSocket에는 이 HTTP 헤더가 붙지 않기 때문이다. 이 중단을 지우고 적용하지 말고
해당 환경의 구독 소비처부터 다시 검토해야 한다.

## 검증

### SQL 자동 시험

`src/lib/privateVisitReads.sql.test.ts`는 실제 마이그레이션과 기존 세션 helper를
PGlite에 적용한다. 열린 정책 두 개를 둔 상태에서 차단을 확인한다.

- 세 표의 무세션·잘못된/없는/만료된/폐기된 토큰·비활성·승인대기 차단
- 네 앱 역할과 두 DB 역할의 조회 행·집계 보존
- 기존 소유자 쓰기와 `RETURNING` 유지, 타인·무세션 쓰기 거부
- 조인 읽기 차단, 재적용 후 행과 정책 보존

망가뜨리기 결과:

| 변형 | 실패 |
| --- | --- |
| RESTRICTIVE를 PERMISSIVE로 변경 | 4개 |
| visit_histories 보호 정책 제거 | 1개 |
| return_visits 보호 정책 제거 | 1개 |
| return_visit_logs 보호 정책 제거 | 1개 |

전체 시험: 232파일, 2,317개 통과. lint와 TypeScript/Vite 빌드 통과.
빌드의 기존 `inlineDynamicImports` deprecated 경고는 남아 있다.

### 실제 데모 DB / API / Realtime

대상은 `itjlykpjmlcvanqpmkmc`만 허용하는
`scripts/privateVisitReadsDemo.mjs`로 확인했다. 토큰·PIN은 결과에 기록하지 않는다.

```sh
DEMO_ENV_FILE=../chinese-territory-app/.env.test.local node scripts/privateVisitReadsDemo.mjs apply --confirm-demo
DEMO_ENV_FILE=../chinese-territory-app/.env.test.local node scripts/privateVisitReadsDemo.mjs smoke --confirm-demo
```

`apply`는 기존 정책이 없을 때만 실행되며, 백업 후 `psql --single-transaction`으로
적용한다. 이미 적용한 데모에서는 `smoke`만 실행한다.

- 백업: `backups/private-visit-reads-demo-1794317538781/before.dump`
  (`public`·`private` 스키마, pg_restore 목록 검사 완료, git 제외)
- 세 표의 행 수·내용 해시와 기존 쓰기 정책이 적용 직전/직후 동일했다.
- 2026-11-10 실제 검증 38항목 통과, 대상 건물의 실시간 신호 3건 수신.
- 무세션·잘못된/없는/만료된 토큰의 세 표 직접 읽기 0행.
- 무세션의 `units -> visit_histories` 중첩 읽기도 상세 0행.
- 일회용 네 역할 각각 세 표의 HTTP exact count가 DB 전체 count와 동일.
- 방문 메모 저장과 반환, 다른 계정의 신호 수신 후 메모 조회, 세대 상태 반영 확인.
- 방문 취소 후 다른 계정의 유효 기록에서 제외, 세대 상태 복원 확인.
- 건물·세대 연결 재방문 생성, 주소·연결 유지, 기록 추가·수정·취소 확인.
- `get_recipient_return_visit_card_ids` 호출에 연결 카드가 포함됨을 확인.
- 연결 건물 좌표와 세대를 봉사자 토큰으로 읽을 수 있음을 확인.
- 테스트 계정 네 개와 테스트 카드·건물·세대·기록을 정리했다.
- 로컬 결과: `scratch/private-visit-reads-demo-results.json` (git 제외).

### 브라우저 확인과 한계

로그인된 데모 봉사자로 앱 업데이트/새로 읽기 후 설정, 나의 봉사, 지난 봉사,
홈 이동이 정상임을 확인했다. 저장·취소 및 두 연결 반영 검증은 위 실제 API와
WebSocket 시험으로 했다. 두 휴대폰 화면, 지도 핀, 통계 UI의 시각적 전후 비교를
새로 수행한 것으로 주장하지 않는다. 기존 지도·재방문·통계 관련 자동 시험도 통과했다.

## 운영 전 확인

아래는 최초 데모 검증 시 정한 운영 전 확인사항이다. 승인 후 적용 결과는 0082에 기록했다.

1. 최근 사용자들의 유효 세션 토큰 보급, HTTP 헤더 전달, 세 표의 발행 여부 확인.
2. 운영 백업 및 정책/함수 차이 검토 후 단일 트랜잭션으로 적용.
3. 일회용 계정으로 저장·취소·재방문·통계 읽기·다른 연결 갱신 확인.

만료 토큰은 결과가 비어 보일 수 있으므로 정상 로그인 상태 확인을 생략하면 안 된다.
앱 코드는 별도 동작 변경이 없어 기존 번들도 같은 DB 정책을 적용받는다.

## 되돌림과 범위 밖

백업 디렉터리의 `rollback.sql`은 이번에 추가한 세 정책만 제거한다.
실행은 `psql --single-transaction`으로 하지만, 이는 비로그인 공개를 다시 여는
보안 후퇴다. 자동 fallback이나 일반 기능 스위치처럼 사용하지 않는다.

이 작업은 세 표의 직접·중첩 읽기 경계다. 모든 테이블·뷰·SECURITY DEFINER RPC의
개인정보 안전성을 전부 보증하는 감사가 아니다. 로그인 사용자 사이의 역할별
열람 최소화, 연락처·아이디 분리, 숨긴 댓글 알림 조회 최적화는 후속으로 남긴다.
