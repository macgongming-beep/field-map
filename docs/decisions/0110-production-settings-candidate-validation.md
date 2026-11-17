# 실제 운영 설정을 사용한 후보 화면 검증

- 날짜: 2026-11-17
- 상태: 로컬 후보 검증, 운영 미적용.
- 검사 대상 앱 커밋: `bddf0ad` (`codex/group-service-release-candidate`).
- 선행 기록: [0108](0108-main-based-group-service-candidate.md), [0109](0109-candidate-comment-notification-agreement.md).
- 사용자 범위: 운영 설정은 읽기 전용, 실제 설정과 새 기능 OFF 조합의 화면 확인. 운영 변경 금지.

**판정:** ON/OFF 동작 검사는 통과했다. 다만 추가 스크린샷 검사에서 좁은 PC 화면의 상세 패널 잘림을 확인했으므로, 화면 전체가 문제없다거나 운영 전환 준비가 끝났다고 판정하지 않는다. 이번 변경은 검증 기록뿐이며 앱/SQL 코드를 바꾸지 않았다.

## 설정 확인과 격리

Vercel의 `chinese-territory-app` 운영 프로젝트에서 `env pull --environment=production`과 `env ls production`만 실행했다. CLI 작업 디렉터리는 별도의 로컬 reader이며 후보의 데모 프로젝트 연결을 바꾸지 않았다. 환경변수 추가/수정, 배포, main 병합, 운영 DB 접속은 하지 않았다.

내보낸 `VITE_*` 50개 중 기능 설정 41개의 실제 값을 확인했다. 40개는 true이고 `VITE_CALENDAR_EVENT_REFRESH_ENABLED`만 false다. 이전 후보 검사는 이 값을 true로 두었으므로 이번에는 false 그대로 검사했다. `VITE_CHAT_DISABLED=true`도 확인했다. 채팅을 새로 켜거나 사용하는 검사가 아니다.

`VITE_GROUP_SERVICE_ENABLED`, `VITE_ASSIGNMENT_REVISION_ENABLED`, `VITE_DEMO_MODE`는 운영에 등록되어 있지 않다. 새 기능 두 개는 현재 운영 설정으로 첫 빌드 시 OFF다.

DB URL/anon key, 네이버 지도 키, Sentry DSN, VAPID 공개 키 다섯 값은 CLI 내보내기에서 비어 있었다. **실제 운영 값이 비어 있다는 판정이 아니라 이 경로로 값 자체를 확인하지 못한 것이다.** DB 연결은 확인된 데모 URL/키로 대체했고, Sentry와 푸시 키는 비워서 운영 오류 보고나 기기 구독을 만들지 않았다. 지도 인증 및 실제 푸시 전달은 이번 검사의 범위가 아니다.

빌드 시 운영의 나머지 `VITE_*` 값을 그대로 사용하고 상속된 로컬 VITE/Sentry 값을 제거했다. 앱 URL만 데모 주소로 바꾸고 `VITE_DEMO_MODE=false`를 명시했다. 이로써 데모 기본값이 누락된 운영 설정을 몰래 켜지 않는다. 새 기능 두 값을 true/false로 바꾼 ON/OFF 빌드를 따로 생성했다. OFF의 명시적 false와 운영의 미등록 값은 DEMO_MODE가 false일 때 같은 분기다.

두 빌드의 자산에서 운영 Supabase URL과 운영 앱 URL이 없음을 확인했다. 브라우저는 데모 이외 Supabase 요청을 차단했고, OFF 검사는 로컬 앱과 데모 외 외부 요청을 모두 차단했다. 서비스 워커는 검증 브라우저에서 막아 다른 빌드의 캐시를 사용하지 않았다. 실제 기기의 업데이트/캐시 전환 검사를 대신하지 않는다.

## 실제 기능 설정

아래에서 `VITE_` 접두어를 생략했다. false 한 개를 제외한 아래 값은 모두 true다.

```text
BOUNDARY_DEVICE_CACHE_ENABLED
BUILDING_CREATE_REFRESH_ENABLED
BUILDING_DEMAND_ENABLED
BUILDING_MOVE_REFRESH_ENABLED
CALENDAR_APPLICATION_REFRESH_ENABLED
CALENDAR_CACHED_SCREEN_ENABLED
CALENDAR_EVENT_REFRESH_ENABLED=false
CALENDAR_NAVIGATION_RECOVERY_ENABLED
CALENDAR_NAVIGATION_REUSE_ENABLED
CALENDAR_WINDOW_ENABLED
CALENDAR_ZONE_BUILDING_DEMAND_ENABLED
CARD_COMPACT_READ_ENABLED
CHAT_BADGE_ONLY_ENABLED
CHAT_DISABLED
CHINESE_FLAG_REFRESH_ENABLED
HOME_MEETING_META_REUSE_ENABLED
HOME_SUGGESTION_BODY_ENABLED
HOME_SUGGESTION_REUSE_ENABLED
INFORMAL_GROUP_REFRESH_ENABLED
LAZY_RETURN_VISIT_LOGS_ENABLED
LEGACY_NOTICES_SKIP_ENABLED
MAP_CHINESE_FILTER_ENABLED
NOTIFICATION_BADGE_ONLY_ENABLED
PERSONAL_SESSIONS_ENABLED
PRIVATE_USER_READS_ENABLED
RECENT_SESSIONS_ENABLED
RECIPIENT_CARD_SCOPE_ENABLED
RECIPIENT_STORE_ENABLED
RESTAURANT_BROWSE_ENABLED
RESTAURANT_VISIT_REFRESH_ENABLED
RETURN_DETAIL_RETENTION_ENABLED
RETURN_MAP_RETENTION_ENABLED
RETURN_VISIT_ADDRESS_REFRESH_ENABLED
SCOPED_HISTORY_RECOVERY_ENABLED
SCOPED_VISIT_HISTORY_ENABLED
SERVICE_MEETING_NOTES_ENABLED
SETTINGS_CALENDAR_RETENTION_ENABLED
TEAM_SERVICE_ENABLED
TERRITORY_REALTIME_ENABLED
VISIT_REALTIME_QUEUE_ENABLED
VISIT_SIGNAL_DEDUP_ENABLED
```

## ON 검증

실제 운영 기능 설정 + 새 기능 두 개 ON, 데모 DB의 strict 단계에서 실행했다.

- 집단 화면 12항목 통과. PC/모바일, 320px 확대, 집단 탭, 다른 집단 배정, 신청/취소 실시간 반영, 공유 결과 펼침, 모임 정보 없는 경우 숨김을 확인했다.
- 두 인도자의 동시 저장 충돌과 초안 보존, 편집 중 새 신청이 들어와도 불필요하게 충돌하지 않는 것을 확인했다.
- 일정 명단에 없는 인도자의 회중 봉사 배정, 마감 뒤 대신 신청/게스트 추가를 확인했다.
- 댓글/알림/조회량 34항목 통과. 댓글 첫 20개/추가 20개, 수정·삭제된 ID만 재조회, 비활성 집단 댓글 미조회, 본인/타 집단 멘션 링크, 같은 알림 다시 열기, 만료 세션 안내와 기존 행 보존을 포함한다.
- 댓글 변경에 의한 캘린더 전체 재조회는 0건이었다. 앱 복귀는 이미 불러온 20개 또는 40개 분량만 다시 읽었다. 소켓 재연결 때의 기존 캘린더 복구 조회는 별도 발생했다. 측정한 바이트는 응답 본문/소켓 payload이지 청구 사용량이나 월간 추정치가 아니다.
- 실제 휴대폰에 푸시를 보내지 않았다. 일반 댓글/멘션 발송 요청 생성은 외부 전송되지 않는 트랜잭션 대기열 검사로만 확인했다.

첫 댓글 실행은 비활성 탭 조회 횟수 단언에서 실패했다. 앱 코드를 바꾸지 않은 재실행은 34개 통과했다. 검사 코드의 `.comment-empty`는 로딩 문구에도 붙으므로, 선택한 집단의 실제 응답과 빈 목록 문구를 기다리도록 보강했고 그 다음 34개도 통과했다. 첫 실패의 세부 응답 기록이 없으므로 원인을 확정했다고 주장하지 않는다.

## OFF 검증

실제 운영 기능 설정 + 새 기능 두 개 OFF. 첫 배포에 필요한 준비된 호환 DB 조합을 데모에서 검증한다. 데모의 기존 strict 상태/확인 기록/시각과 다섯 RPC 실행권한을 먼저 저장하고, 검사 동안만 compatibility로 바꾼다. 성공/실패와 관계없이 finally에서 정확한 원래 값과 실행권한을 복구하고 대조한다. 기존 데모에 준비 묶음을 재설치하지 않는다.

최종 13항목 통과, 브라우저 실행 오류 0건이다. PC 1365px와 모바일 430px에서 다음을 확인했다.

- 일반/팀 배정 일정 각각 참가자를 화면에서 제외한다. 일반은 `remove_service_participant_compat_tx`, 팀은 `remove_team_event_participant_tx`를 한 번 호출한다. 신청/두 카드 배정 표의 본인 행은 사라지고 상대 팀원의 행은 남는다.
- 자동 봉사 세션은 삭제하지 않고 기존 행의 status/ended_at을 종료 상태로 바꾼다. 과거 기록을 보존하는 기존 계약이다.
- 제외한 신청자를 화면에서 다시 추가한다.
- 기존 공유된 팀 배정을 편집기에서 읽고 `assign_team_service_bulk_tx`로 다시 공유한다.
- 일반 성원이 신청하고 본인 신청을 취소한다.
- 집단 탭은 표시되지 않는다. 배정/참가자 versioned RPC는 호출하지 않고, 알림함은 설정과 무관하게 `get_my_notification_feed`를 호출한다. 옛 알림 조회 RPC는 호출하지 않는다.

임시 일정 5개와 테스트 세션은 제거했다. 데모의 phase/evidence/changed_at과 다섯 RPC의 실행권한을 저장본과 정확히 대조해 원상 복구를 확인했다. 마지막 저장본은 `backups/candidate-settings-20261117/off-1794903825684/phase-before.json`, 복구 파일은 같은 폴더의 `restore.sql`이다.

최종 정리 감사에서 이번 `candidate_off_` 시험 제목이 들어간 합성 계정 알림 26건도 백업 후 제거했다. 임시 일정 0건, 해당 시험 알림 0건, phase=strict, 다섯 옛/호환 RPC의 anon/authenticated 실행권한 0건을 확인했다. 결과는 `scratch/candidate-settings-final-audit.json`에 남겼다. 원격 main은 최종 읽기 확인에서도 `f8ccae4`로 유지되어 있었다.

검사 준비 과정에서 칼럼명, 세션 보존 계약, 시험 자료의 고유 제약, 공유 상태, 화면 확인창과 신청 취소 문구의 선택자를 바로잡았다. 이 실패들은 앱 코드 변경의 근거로 사용하지 않았으며 매번 데모 단계/권한을 복구했다. OFF에서는 공유 전 서버 행을 기존 편집기가 공유본으로 간주하지 않으므로 실제 공유 상태로 만든 fixture를 사용했다.

## 추가로 발견한 화면 문제

ON/OFF 모두 관리자 PC 폭 1365px에서 `.detail-pane`의 오른쪽 좌표가 1446px로, 화면 밖으로 81px 나간다. 한글 기본 제목으로 다시 열어도 같은 결과다. `src/App.css:11280`의 기존 `.desktop-content`는 `minmax(680px,1fr) 430px` 두 열, 간격 28px, 좌우 여백 96px를 요구하고 사이드바 260px가 더해진다. 이 파일은 기준 main `f8ccae4`와 검사 후보 `bddf0ad` 사이에 변경이 없다. 기준 main을 별도로 실행한 비교 시험은 하지 않았다.

문서/body의 scrollWidth는 화면 폭과 같아도 내부 패널은 잘릴 수 있다. 따라서 전체 페이지 overflow 숫자만으로 통과시키면 안 된다. 이후 보완 시험은 상세 패널과 핵심 버튼의 실제 좌표가 화면 안에 들어오는지도 검사해야 한다.

모바일 430px의 일반 제목은 화면 안에 들어온다. 다만 공백 없는 긴 영문 시험 제목은 기존 상세 제목에서 잘림이 보였다. 좁은 PC 열 너비와 긴 제목 줄바꿈을 운영 전환 전 UI 보완 항목으로 남긴다. 기능 검사 12/34/13항목의 성공을 이 화면 문제까지 해결됐다는 뜻으로 쓰지 않는다.

## 근거와 한계

- ON/OFF 각각 TypeScript/Vite 빌드 통과. 기존 큰 청크 경고는 남아 있다.
- 설정 분기·권한·생성 준비 묶음 전환·알림 필터 회귀 시험: 5파일 / 16개 통과.
- 이전 0109의 전체 2,531개 시험은 같은 앱 커밋의 기록이다. 이번에 전체 시험을 다시 실행했다고 합산하지 않는다.
- 비밀 원본은 git에서 제외한 `backups/candidate-settings-20261117/production.env.local`에 권한 0600으로 보관한다. 문서에는 키/토큰을 남기지 않는다.
- 로컬 재현 도구: `scratch/build-production-settings.mjs`, `scratch/check-candidate-off.mjs`, `scratch/candidate-harness/scripts/checkGroupTabsUi.mjs`, `scratch/candidate-harness/scripts/checkGroupCommentsDemo.mjs`.
- 결과: `scratch/production-settings-{on,off}.json`, `scratch/group-tabs-ui-results.json`, `scratch/group-comments-results.json`, `scratch/candidate-off-results.json`. 테스트 계정/세션이 든 fixture와 원본 환경 파일은 커밋하지 않는다.
- 추가 화면 좌표/스크린샷: `scratch/check-candidate-off-layout.mjs`, `scratch/candidate-off-layout.json`, `scratch/candidate-{on,off}-normal-{430,1365}.png`.

## 전환 결정

운영 환경변수를 미리 바꾸는 대신 **준비 DB + 기능 OFF 첫 배포**를 검증하는 경로를 선택한다. 여전히 준비 DB 적용과 `--require-compat-ready` 확인 전 main 병합은 금지다. OFF 배포 확인 이후 별도 승인된 설정 변경으로 새 배정 보호와 집단 화면을 켜고, 기기 업데이트 확인 후 strict로 전환한다. strict 이후 리비전 설정을 OFF로 돌리지 않는다.

남은 관문은 위 PC/긴 제목 화면 보완과 재검사, 운영 DB의 선행 함수/정책/권한/본문 읽기 전용 대조, 백업·복구 준비, 후보의 데모 호스팅 배포와 실제 기기 재확인, 사용자 앱 업데이트 확인이다. 이번 화면 검증은 운영 적용 승인이 아니다.
