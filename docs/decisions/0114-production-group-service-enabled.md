# 운영 집단 신청 및 새 배정 저장 활성화

- 날짜: 2026-11-17.
- 승인: 사용자가 OFF 첫 배포를 아이폰에서 업데이트한 뒤 홈/캘린더/상세 정상 진입을 확인했고, "집단별 신청이랑 새 배정 저장 켜서 운영 배포해줘"라고 요청했다.
- 범위: 운영 Vercel production 설정 두 개 ON 및 검증된 커밋 재배포. DB 변경/strict 전환/업무 자료 변경은 하지 않는다.

## 설정과 배포

- 운영 프로젝트 `prj_cdo2L78J2YEEaBgxMMnNDfA5BDZs`임을 확인했다.
- `VITE_ASSIGNMENT_REVISION_ENABLED=true`, `VITE_GROUP_SERVICE_ENABLED=true`를 production 대상에만 추가했다. 두 키는 원래 없었다.
- 전체 기존 환경변수 레코드를 적용 전후 대조해 다른 키/값/대상이 그대로임을 확인했다. 환경변수를 다시 내려받아 두 값이 true이고 DEMO_MODE가 true가 아님을 확인했다.
- 이전 OFF 배포 `dpl_7x6VBaKH1JuaQ4M7hRhCVSFVhvUM`를 재빌드했다. 다른 작업 폴더의 미커밋 코드를 업로드하지 않았다.
- ON 배포: `dpl_7EhxvJXFWS7RWpxSAaxV1KfMgLUY`, READY.
- Git SHA: `3b848dd6d0d17528ee01ecf863cf1c9cd7f84086`, 이전 OFF 배포와 동일.
- 대표 주소 `https://chinese-territory-app.vercel.app` 연결 확인. 배포 메타데이터에 두 새 환경변수 키도 포함되어 있다.
- 앱 진입 파일은 OFF의 `index-Br-bK2gD.js`에서 ON의 `index-BwqawQtc.js`로 변경됐다.

## 확인 범위

- 켜기 전/후 운영 DB를 읽기 전용으로 대조했다. compatibility, 첫 배포 준비 검사 8개, production/compatibility 배정 함수 12개 및 실행권한 검사가 통과했다.
- PC 1365px/모바일 390px에서 운영 `/calendar`의 비로그인 화면, 200 응답, 앱 파일 로딩을 확인했다. 런타임 오류/실패한 앱 파일/DB 쓰기 요청 0건, 가로 넘침 없음.
- 실제 운영 성원의 신청/배정 저장을 시험 목적으로 변경하지 않았다. ON의 상세 기능 검증은 앞서 운영 설정을 사용한 데모/로컬 검사(0110/0111)에 근거하며, 이번 로그인 화면 검사를 인증 후 기능 전체 시험이라고 부르지 않는다.
- 아이폰의 기존 OFF 버전 확인과 이번 ON 버전 적용은 별개다. 사용자에게 이번 버전도 업데이트 후 일정 추가의 집단 선택 및 상세를 확인하도록 안내한다.
- 최종 strict 전환은 하지 않았다. 구버전 저장 경로가 열려 있는 호환 기간이므로 모든 기기의 동시 저장 보호가 완료됐다고 표현하지 않는다.

## 근거와 복귀

- 설정/배포 전후 기록: `backups/group-enable-production-1794917035172/` (0600 파일, 0700 폴더, Git 제외).
- 화면: `scratch/production-group-enabled-ui.json`, `scratch/production-group-enabled-{390,1365}.png`.
- 같은 화면 검사 스크립트를 재사용하면서 0113의 최초 OFF scratch 화면 파일은 덮어써졌다. 최신 결과는 위 ON 이름으로 옮겼다. OFF의 당시 확인 결과는 0113/대화 기록으로 보존하며 최신 파일을 OFF 증거로 사용하지 않는다.
- 되돌려야 하면 두 설정을 false로 바꾸고 검증된 커밋을 재배포한다. 현재 DB는 compatibility라 유지할 수 있다. 과거 배포 주소만 되돌리고 다음 빌드의 ON 설정을 남겨 두지 않는다.
- 기록만 후보 브랜치에 커밋한다. 문서 때문에 운영을 다시 빌드하지 않는다.
