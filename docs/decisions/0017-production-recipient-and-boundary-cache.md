# 범위 조회와 구역선 기기 캐시 운영 전환

- 결정일: 2026-10-06
- 상태: 승인, DB 적용 완료 / 앱 배포 진행
- 선행 결정: 0015, 0016. 데모 전용 제한을 아래 명시적 설정으로 확장한다.

## 전환 조건

사용자가 데모의 지도 재실행/재로그인 표시 및 두 기기의 방문 기록/취소 연동을
확인하고 운영 적용을 요청했다. 최신 origin/main은 작업 브랜치의 조상이다.
운영 이전 배포는 dpl_74Q5oZxksHz5UT6GkHEFiWKwYdaQ (fc7bfb4)다.

- VITE_RECIPIENT_STORE_ENABLED=true: 실제 user 역할의 지원 화면만 범위 store 사용.
  관리자/인도자와 지원하지 않는 지도는 전체 store를 유지한다.
- VITE_BOUNDARY_DEVICE_CACHE_ENABLED=true: 전체 store의 구역선 캐시 사용.
  recipient 전용 구역선 reader까지 캐시하는 변경은 아니다.
- 설정이 없으면 기존 데모 모드를 따른다. 명시적인 false는 데모에서도 끈다.
  VITE_DEMO_MODE는 운영에서 켜지 않는다. 미리보기/데모 초기화는 계속 데모 전용이다.
- VITE_TERRITORY_REALTIME_ENABLED=true 유지. Vite 설정 변경에는 재빌드가 필요하다.

## DB 및 검증

운영 대상 qdxemvdorasoryfysuoq를 확인한 스크립트 applyRecipientProduction.mjs로
public/private 스키마와 자료를 custom pg_dump로 백업하고 pg_restore --list를 확인했다.
복원 리허설을 했다는 뜻은 아니다. 백업은 저장소 밖 공개 없이 ignored backups에 보관한다.
20261005_1200과 1500을 한 psql --single-transaction으로 적용했다.
기존 자료 수정/삭제 없이 SECURITY INVOKER 조회 함수 2개만 추가했다.
서버 함수 존재/실행 권한 확인 및 토큰 없는 HTTP 요청의 세션 검증 거부 확인.
공통 verify_session이 P0001 '세션 토큰이 없습니다'를 반환한다(42501 예상과 다름).

운영 설정 시험 추가 후 1247개/175파일, lint/build 통과.
두 설정의 활성화 분기를 제거한 변형에서 새 시험 2개만 실패, 나머지 18개 통과 후 원복.

## 복구 및 효과 판단

문제 발생 시 이전 운영 배포로 되돌린다. 추가 함수는 이전 클라이언트를 바꾸지 않으므로
긴급 복구에 함수 삭제는 필요 없다. 기능별 false 설정 후 재빌드로도 분리할 수 있다.
배포 이후 동일 길이 시간 구간의 실제 전송량을 비교한다. 작은 데모 수치나 다른 조회
경로의 절감량 합산으로 월 5GB 충족을 약속하지 않는다. Pro 결제는 사용자가 결정/진행한다.
