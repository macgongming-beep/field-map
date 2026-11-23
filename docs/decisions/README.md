# 결정 기록

코드만으로 알기 어려운 데이터·권한·운영 결정을 남기는 곳이다. 다음 작업자와 AI는
관련 기능을 바꾸기 전에 이 목록에서 결정 기록을 먼저 찾는다.

## 작성 기준

- 단순 구현 설명이 아니라 **왜 이 선택을 했는지** 기록한다.
- 데이터 삭제, 권한, 자동 병합, 사용자에게 보이는 의미가 바뀌는 결정은 반드시 남긴다.
- 결정이 바뀌면 옛 문서를 지우지 말고 상태를 `대체됨`으로 바꾼 뒤 새 기록을 연결한다.
- 구현 전이면 `제안`, 합의·구현됐으면 `승인`, 운영 적용까지 끝났으면 `운영 적용`으로 표시한다.
- 관련 마이그레이션, 화면, smoke와 실제 운영 자료의 사례를 함께 적는다.

## 목록

속도 개선 운영 반영: [0159 검토 완료 개선과 조회 최적화 설정 운영 적용](0159-reviewed-performance-production-release.md).

리뷰와 후속 작업 인계: [2026-11-22 클로드 속도 개선 리뷰 인계](../performance-review-handoff-2026-11-22.md).

홈 현황/제안 지연 읽기: [0156 홈 구역 진행률 제거와 제안 열 때 읽기](0156-demo-home-progress-and-suggestion-demand.md).

나의 봉사 첫 진입: [0157 개인 구역 복구 조회 대기 단축](0157-demo-my-service-entry-recovery.md).
나의 봉사 일정 읽기: [0158 공유 팀 배정 병렬화](0158-demo-service-calendar-parallel-assignments.md).
모바일 캘린더 첫 진입: [0160 달력은 구역 자료를 기다리지 않음](0160-demo-calendar-month-without-territory-wait.md).
건물 전체 읽기: [0161 페이지 동시 읽기](0161-demo-concurrent-building-pages.md).
봉사자 홈 첫 실행: [0162 사용자 조회·카드 요약 앞당김](0162-demo-volunteer-home-first-launch.md).
0160~0162 운영 반영: [0163](0163-demo-perf-0160-0162-production-release.md).
나의 봉사 식당 색인: [0164 오늘 이후 일정만](0164-demo-service-restaurant-index-from-today.md).
인도자 나의 봉사 건물 전체 조회: [0165 분리 보류](0165-leader-my-service-full-buildings-deferred.md).

봉사자·관리 화면 조회 데모 재검증: [0155 개인 구역 ID 재사용과 경량 관리 조회](0155-demo-section-read-reuse.md).

봉사자 홈 코드 데모 선로딩: [0154 자료 대기와 홈 코드 로딩 병렬화](0154-demo-volunteer-home-code-preload.md).

지도 축소 성능 데모 검증: [0153 중간 배율 표시 생성과 동일 스타일 갱신 절감](0153-demo-map-zoom-reconciliation.md).

인도자 구역·지도 운영 반영: [0152 검토한 인도자 구역 탐색 운영 배포](0152-leader-territory-production-release.md).

인도자 구역 탐색: [0151 내 집단·전체 구역과 지도 경계선](0151-leader-own-group-territory-browse.md).

집단 지도·배정 운영 반영: [0149 검토한 집단 지도 화면 운영 배포](0149-reviewed-group-map-production-release.md).

집단 구역 관리 화면 정리: [0148 간결한 지도와 큰 목록](0148-compact-group-territory-browse.md).

집단 일정의 구역 후보와 지도 배정: [0147 집단 일정의 구역 범위와 지도 선택](0147-event-group-territory-map.md).

운영 백업 복구 준비: [0142 격리 복구 리허설과 남은 중단 지점](0142-offline-production-backup-rehearsal.md).
후속 보완: [0143 원자적 복원·누락 업무 백업·중간 실패와 재시도](0143-atomic-restore-rehearsal.md).
실제 누락 자료 확보: [0144 운영 읽기 전용 재백업과 파일 검증](0144-production-readonly-business-rebackup.md).

데모 주요 화면 속도 개선: [0140 모바일 주요 화면의 조회와 대기 개선](0140-demo-section-loading.md).

최신 운영 반영: [0067 달 이동 복구와 홈 재사용](0067-production-navigation-home-reads.md)

운영 미반영 후보: [0108 최신 main 기반 집단 봉사 후보](0108-main-based-group-service-candidate.md).
이전 데모 결정/검증은 0093~0107, 전환 절차는 [0105](0105-group-service-staged-rollout.md).
이전 데모 시험 결과를 운영 후보의 결과로 재사용하지 않는다.
후속 합의 반영: [0109 일반 댓글은 푸시만, 멘션은 알림함에도](0109-candidate-comment-notification-agreement.md).
설정 대조: [0110 실제 운영 기능 설정으로 후보 ON/OFF 화면 검증](0110-production-settings-candidate-validation.md).
화면 보완: [0111 좁은 PC 상세와 긴 제목 줄바꿈](0111-candidate-calendar-responsive-layout.md).
운영 사전 대조: [0112 운영 DB 선행 함수·권한 읽기 전용 확인](0112-production-db-readonly-candidate-audit.md).
운영 전환: [0113 준비 DB와 기능 OFF 호환 첫 배포](0113-production-group-service-compatibility-release.md).
운영 활성화: [0114 집단 신청·새 배정 저장 ON](0114-production-group-service-enabled.md).

| 번호 | 상태 | 결정 |
| --- | --- | --- |
| [0001](0001-preserve-orphaned-return-visits.md) | 운영 적용 | 전출·계정 삭제 후에도 정기방문 기록을 보존하고 관리자가 재배정한다 |
| [0002](0002-end-return-visits-and-report-place-changes.md) | 운영 적용 | 정기방문 종료와 장소 수정 요청을 분리한다 |
| [0003](0003-unit-usage-and-building-access.md) | 운영 적용 | 건물은 기본 용도, 세대는 예외 용도를 갖고 출입불가는 건물에 기록한다 |
| [0004](0004-skip-existing-units-and-prevent-duplicates.md) | 운영 적용 | 같은 건물의 중복 세대를 막되 일괄 추가는 기존 호수를 제외하고 계속한다 |
| [0005](0005-canonical-unit-display.md) | 운영 적용 | 순수 호수는 `호` 없이 저장하고 자유 이름은 보존한다 |
| [0006](0006-demo-team-card-scope.md) | 데모 검증 중 | 팀별 카드 봉사 형태를 공유하고 나의 봉사 지도를 좁힌다 |
| [0007](0007-demo-team-informal.md) | 데모 검증 중 | 비공식 배정을 개인 복제 대신 일정의 팀에 저장한다 |
| [0008](0008-scoped-territory-realtime.md) | 운영 적용 | 지도 범위 안의 건물·방문 기록만 실시간 동기화한다 |
| [0009](0009-territory-recovery-watermark.md) | 운영 적용 | 실시간 복구를 서버 시각 이후로 제한하고 겹친 조회를 공유한다 |
| [0010](0010-building-recovery-egress.md) | 운영 적용 | 자동 복구의 전체 건물 본문 대신 변경 신호와 ID 목록을 대조한다 |
| [0011](0011-boundary-recovery-and-private-subscriptions.md) | 운영 적용 | 구역선 변경분만 복구하고 비공개 표의 실패하는 구독을 제거한다 |
| [0015](0015-recipient-territory-loading.md) | 제안 | 봉사자 카드 요약과 범위별 상세 조회를 분리한다 (요약 RPC 로컬 검증, 앱 미연결) |

## 새 기록 틀

봉사 세션 반복 조회: [0052 최근 본인 세션과 전체 통계 분리](0052-demo-recent-service-sessions.md)

아이폰 세대 상세 헤더: [0051 세대 상세 안전 영역](0051-unit-detail-safe-area.md)
모바일 홈 일정 바로 열기: [0050 데모 홈 일정 상세](0050-demo-home-event-detail.md)
재방문 상세 유지·지도 경로 운영 적용: [0049 재방문 상세 조회 유지](0049-demo-return-detail-store-retention.md)

식당 목록 지연 조회: [0019 데모 식당 탐색과 선조회 분리](0019-demo-restaurant-catalog.md)

식당 기록 저장 후 갱신: [0020 데모 식당 방문 부분 갱신](0020-demo-restaurant-save-refresh.md)

봉사 시작·종료 후 갱신: [0021 데모 세션 단독 갱신](0021-demo-session-save-refresh.md)

운영 전환: [0017 범위 조회와 구역선 기기 캐시](0017-production-recipient-and-boundary-cache.md)

구역선 재실행 비용: [0016 데모 구역선 기기 보관](0016-demo-boundary-device-cache.md)

봉사 모임 정리 준비: [0013 일정 삭제와 게시글 보존 분리](0013-service-meeting-notes.md)
후속 변경: [0014 수동 홈 표시와 모음 휴지통](0014-meeting-toggle-and-trash.md)


봉사 참석 통계: [0022 요일·시각별 참석 집계](0022-service-attendance-statistics.md)

방문기록 복귀 중복 읽기: [0058 데모 완전성 기반 복구](0058-demo-scoped-history-recovery.md)

저장·실시간 겹침 비용: [0059 데모 건물 갱신 대기열](0059-demo-visit-realtime-refresh-queue.md)

화면 왕복 로딩과 전체 일정 재사용: [0060 데모 일정 캐시 화면 유지](0060-demo-calendar-cached-screen.md)

복구·대기열·캐시 화면 운영 opt-in 준비: [0061 운영 스위치와 조합 시험](0061-recovery-and-cached-screen-production-gates.md)

운영 기록 복구와 갱신 대기열: [0063 운영 활성화와 검증](0063-production-history-recovery-queue.md)

데모 화면 이동·홈 조회 정리: [0065 범위 확인 후 복구와 홈 본문 재사용](0065-demo-navigation-recovery-home-reads.md)

화면 이동·홈 조회 운영 준비: [0066 독립 스위치와 의존 관계 시험](0066-navigation-home-production-gates.md)

연결 재방문 지도 왕복: [0068 데모 봉사자 스토어 유지](0068-demo-linked-return-map-retention.md)

주소만 있는 재방문 지도: [0070 검색 실패 처리와 핀 격리](0070-demo-address-only-return-map.md)

저장·실시간 조회 실측: [0071 데모 세 클라이언트 비교](0071-demo-mutation-fanout-audit.md)

저장 후 실시간 중복 읽기: [0072 데모 변경 번호 확인과 재사용](0072-demo-visit-signal-receipts.md)

저장 후 실시간 중복 읽기 운영 활성화: [0073 선행 스위치와 배포 검증](0073-production-visit-signal-dedup.md)

로그인 시도 제한과 비로그인 사용자 조회 차단: [0075 데모 로그인 보안](0075-demo-login-attempt-guard.md)

로그인 보안 리뷰 보완: [0076 반복 실패 안내와 관리자 초기화](0076-demo-login-guard-review-followup.md)

로그인 보안 운영 적용: [0077 백업과 일회용 계정 검증](0077-production-login-security.md)

채팅 비활성화: [0079 데모 조회·쓰기 차단과 댓글 보존](0079-demo-chat-retirement.md)

채팅 운영 종료: [0080 백업·알림 33건 삭제·댓글 검증](0080-production-chat-retirement.md)

방문 메모·재방문 주소 보호: [0081 데모 비로그인 읽기 차단](0081-demo-private-visit-reads.md)

방문 메모·재방문 주소 운영 보호: [0082 옛 시트 표시·백업·운영 검증](0082-production-private-visit-reads.md)

연락처·로그인 아이디 조회 분리: [0083 데모 일반 명단과 인도자 연락처 분리](0083-demo-private-user-directory.md)

연락처 조회 운영 전환: [0084 새 함수·앱 우선 적용, DB 제한 보류](0084-production-user-directory-transition.md)

홈 건물 상세 지연 조회: [0087 데모 홈 요약·지도·선택 건물 상세 분리](0087-demo-building-demand.md)

홈 건물 조회 운영 전환: [0088 운영 적용 범위·검증·롤백](0088-production-building-demand.md)

캘린더·구역 건물 조회: [0089 데모 이름·상태 요약과 배정 편집 전체 조회](0089-demo-calendar-zone-building-demand.md)

캘린더·구역 운영 전환: [0090 선행 스위치·검증·롤백](0090-production-calendar-zone-building-demand.md)

모바일 지도 중국어 세대 필터: [0092 표시 집계 일치와 원본 저장 보존](0092-demo-map-chinese-unit-filter.md)

모바일 일정 닫기·홈 정리·중국어 제목과 조회 점검: [0115 데모 수정 및 남은 속도 과제](0115-demo-mobile-edit-home-and-loading.md)
집단 상세 배정 결과 고정·일정 메뉴 위치: [0116 고정 결과와 헤더 메뉴](0116-group-detail-fixed-results-and-header-actions.md)
일정 상세·나의 봉사 속도: [0117 데모 조회 대기 축소 및 전후 측정](0117-demo-service-navigation-read-latency.md)
나의 봉사 요청 수 정정: [0118 전환 구간 분리 재측정과 초기 로딩 실패 시험](0118-service-navigation-request-accounting.md)
설정·캘린더 등 자주 쓰는 화면: [0119 순차 점검, 불필요한 설정 조회와 캘린더 직렬 대기 제거](0119-frequent-route-loading-audit.md)
나의 봉사 개인 배정: [0120 중복 읽기 제거와 역할별 전후 검증](0120-my-service-personal-read-reuse.md)
봉사자 앱 첫 진입: [0121 조회 범위를 유지한 대기 순서 개선과 사용량 비교](0121-recipient-initial-read-order.md)
팀 구성·구역 배정 진입: [0122 전체 화면 로딩 유지와 나의 봉사 이동 점검](0122-assignment-editor-stable-loading.md)
배정 편집 중 새로고침·재연결: [0123 초안 보존 검증과 실패 처리 보완](0123-assignment-draft-refresh-recovery.md)
첫 로딩 화면: [0124 부트·React 표시 통일과 사용량 확인](0124-startup-loading-presentation.md)
일정 메뉴 표현: [0125 회중·집단 메뉴 통일과 시간 설정 아이콘](0125-schedule-action-labels-and-icon.md)
로고 표시 범위: [0126 최초 실행에만 로고 표시](0126-startup-logo-once.md)
시작 중 로고 교체 제거: [0127 최초 로고 요소 유지](0127-persistent-startup-logo.md)
11월 18일 운영 전환: [0128 검증한 화면·속도 개선 배포](0128-nov18-evening-production-update.md)
일정 표시 변경의 구역 조회: [0129 데모 메타정보 갱신 분리와 실제 통신 전후 비교](0129-calendar-metadata-territory-refresh.md)
저장한 제목·집단명 표시: [0130 중국어 이름 보존과 PC 달력 밀도](0130-saved-service-labels-and-compact-calendar.md)
집단 추가·이름 변경: [0131 고정 식별자로 사용자 관리와 일정 연결](0131-stable-service-group-directory.md)
기존 일정에 새 집단 추가: [0132 신청·배정을 유지한 시간대 확장](0132-add-groups-from-existing-service-event.md)
모임 정보와 운영 전환: [0133 기본 펼침·线上/现场 표시와 집단 관리 배포](0133-expanded-meeting-info-production-release.md)
반복 수정과 기본 집단: [0134 이후 일정 수정 범위와 내 집단 우선 탭](0134-repeat-edit-scope-and-own-group.md)
탭 위치 후속 결정: [0135 순서는 공통으로 고정하고 내 집단만 선택](0135-fixed-group-tab-order.md)
생성/메뉴 후속: [0136 반복 생성 인도자 선택과 PC 메뉴 가시성](0136-repeat-create-leaders-and-visible-pc-menu.md)
장소/모임 표시: [0137 장소 즐겨찾기 복구와 제목 옆 모임 표시](0137-place-favorites-and-meeting-badges.md)
배포 사용량: [0138 자동 중복 배포 차단과 데모 배포 경로 통일](0138-explicit-deployment-policy.md)
배정 화면 기억: [0139 배정 중 선택 조건과 지도 위치 유지](0139-assignment-workspace-retention.md)
집단 담당 구역: [0141 공동 담당 가능한 집단 구역 데모](0141-demo-shared-group-territories.md)
집단 구역 운영 전환: [0145 공동 담당과 구역 필터 운영 배포](0145-group-territory-production-release.md)
모바일 지도 헤더: [0146 집단 선택을 통계와 같은 줄로 축소](0146-compact-mobile-group-map-header.md)

```markdown
# 제목

- 상태: 제안 / 승인 / 운영 적용 / 대체됨
- 결정일: YYYY-MM-DD
- 관련 기능:

## 배경
## 결정
## 이유
## 지켜야 할 계약
## 포기한 대안
## 결과와 비용
## 구현과 검증
## 운영 상태
```
