# 백업 / 복원

## 앱 배포 (2026-11-19)

Git push는 운영·데모 어느 쪽에도 앱을 배포하지 않는다. 문서 변경은 배포 대상이 아니다.
로컬 시험과 화면 확인을 끝낸 뒤 기존 빌드 절차로 데모 전용 prebuilt 폴더를 준비한다.
이 도구는 빌드나 환경변수 변경을 하지 않으므로, 빌드의 DB 주소·푸시 키·설정 검증은 여전히 필요하다.

```bash
npm run test:deployment-policy
npm run deploy:demo -- --artifact scratch/nov18-demo-release
# 위 검사가 통과하고, 해당 빌드의 검증까지 마친 경우에만:
npm run deploy:demo -- --artifact scratch/nov18-demo-release --publish
```

데모 프로젝트/팀 확인, 자동 배포 OFF 확인, 동일 결과물 중복 제외, 로컬 동시 업로드 잠금을 거친다.
실제 업로드는 `--publish`가 있을 때만 1회 실행하고 자동 재시도하지 않는다.
이 도구로 처음 올린 이후부터 원격 배포의 `demoArtifactSha`로 동일 결과물을 구분한다.
문서 때문에 새 빌드를 만들거나 배포하지 않는다. 재빌드로 시각/서비스워커 등이 바뀐 결과물까지
같다고 판정하는 도구는 아니다. 기존 scratch 업로드 명령을 이 경로와 병행하지 않는다.

프로세스를 강제 종료해서 Git 공통 폴더의 `demo-release.lock`이 남았다면 실행 중인 업로드가
없고 이전 요청의 성공/실패 상태를 확인한 뒤에만 빈 잠금 폴더를 제거한다.
운영 배포는 이 도구로 할 수 없다. 사용자 승인과 운영 설정 검증을 따로 거친다.
전체 결정과 복구 절차는 [0138](../docs/decisions/0138-explicit-deployment-policy.md)을 따른다.

## 권한 변경 검증

GitHub CI는 비밀값 없이 `lint + unit test + build`만 실행한다. **CI가 초록이어도
DB 정책이 맞다는 뜻은 아니다.** 역할 정책 마이그레이션을 테스트 DB에 적용한 뒤,
운영 적용 전에 별도의 수동 관문을 실행한다.

```bash
npm run smoke:all
```

이 명령은 `.env.test.local`의 등록된 테스트 프로젝트만 쓰며, 운영 ref이거나
`KNOWN_TEST_REFS`에 없는 프로젝트면 중단한다. 표별 smoke가 늘어나면
`scripts/smokeAll.js` 목록에도 추가한다.

## 백업 실행

```bash
npm run backup
```

`backups/YYYY-MM-DD/` 폴더에 `backup.js`의 백업 대상 표가 JSON으로 저장됩니다.
로그인 토큰·비밀 설정 등 의도적으로 제외하는 표도 있으며, private 건물 병합 감사
자료는 별도 SQL 파일로 보존합니다. 같은 날 다시 실행하면 같은 파일을 덮어씁니다.

`.env.local`에 다음 **세 변수**와 PostgreSQL 클라이언트 도구가 필요합니다.
집단 구역 기능이 설치되지 않은 대상도 `SUPABASE_DB_URL`과 `psql`이 필수입니다.

```dotenv
VITE_SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
SUPABASE_DB_URL=...
# 기본 설치 위치가 아닌 경우 절대 경로로 지정
PSQL_BIN=/opt/homebrew/opt/libpq/bin/psql
PG_DUMP_BIN=/opt/homebrew/opt/libpq/bin/pg_dump
```

`SUPABASE_DB_URL`은 같은 프로젝트의 DB 소유자 연결 주소입니다. Session pooler
(5432) 또는 직접 연결을 사용하고, 암호는 `.env.local`에만 둡니다. URL의 추가 옵션은
`sslmode=require`만 허용합니다. API 주소와 DB 프로젝트가 다르면 중단합니다.
`.env.local`과 백업 파일은 공개하거나 커밋하지 않습니다.

- `psql`: 집단·사용자·설정·구역·공동 담당과 화상 접속 정보·장소 변경 요청·공유 보고서를
  **한 시점의 읽기 전용 조회**로 받습니다. 접속 정보처럼 REST 읽기가 닫힌 표도 포함합니다.
  미설치 표는 제외하지만, 접속 정보나 psql이 없으면 표별 백업을 시작하기 전에 중단합니다.
- `pg_dump`: private 병합 감사 SQL을 백업합니다. 대상 서버에 호환되는 버전이 필요합니다.
- 도구 탐색 순서: `PSQL_BIN`/`PG_DUMP_BIN` → Homebrew libpq의 Apple Silicon/Intel
  기본 경로 → PATH. 실제 경로에서 `--version`이 성공해야 합니다.
- 평상시 백업에는 PostgreSQL **서버**가 필요 없습니다. libpq 클라이언트면 됩니다.
  반면 격리 복원·동시 저장 시험에는 `postgres`, `initdb`, `pg_ctl`도 필요합니다.

### 변경 후 첫 운영 백업 확인

운영 접속 승인을 받은 뒤 한 번 수동 실행해 읽기 전용 스냅샷이 성공하는지 확인합니다.
이 절차는 DB 쓰기나 복원 명령이 아닙니다. 문서를 수정한 것만으로 확인 완료로 보지 않습니다.

1. 세 환경변수와 도구 경로를 확인합니다. 비밀번호나 URL 전체를 로그에 출력하지 않습니다.
2. `npm run backup`의 종료 코드가 0인지 확인합니다. `백업 완료` 문구만으로 판단하지 않습니다.
3. `_meta.json`의 실행 시각이 이번 실행이고, `tablesFailed=0`, `privateAuditBackedUp=true`인지 봅니다.
4. `groupSnapshotTables`와 해당 JSON 파일을 대조합니다. 집단 구역이 설치됐다면
   `service_groups`·`card_group_assignments`도 있어야 합니다. 아직 미설치라면 공동 담당 표는 제외됩니다.
5. 자동 백업도 같은 작업 폴더·환경·도구로 성공하는지 별도로 확인합니다.

이 스냅샷은 위 관련 표만 한 시점으로 맞춥니다. 전체 백업의 모든 표가 같은 시점이라는
뜻은 아니며, 전체 복구 가능 여부는 격리 사본 복구 리허설로 확인합니다.

## 자동 백업 (macOS launchd, 매일 새벽 3시)

⚠️ **아래 명령을 실행하면 등록된다.** 문서 보완 과정에서는 실제 등록 상태를 확인하거나
변경하지 않았습니다. 기존 등록이 있다면 먼저 내용을 확인하고 중복 등록하지 않습니다.
작업 폴더는 백업 도구가 업데이트된 체크아웃을 지정해야 합니다. 아래 경로는 예시입니다.
해당 폴더의 `.env.local`에 세 변수를 두고, 비밀값을 plist에 넣지 않습니다.

```bash
cat > ~/Library/LaunchAgents/com.fieldmap.backup.plist <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.fieldmap.backup</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/opt/homebrew/opt/libpq/bin:/usr/bin:/bin</string>
    <key>PSQL_BIN</key>
    <string>/opt/homebrew/opt/libpq/bin/psql</string>
    <key>PG_DUMP_BIN</key>
    <string>/opt/homebrew/opt/libpq/bin/pg_dump</string>
  </dict>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>-lc</string>
    <string>cd "/Users/gm/Documents/New project/chinese-territory-app" &amp;&amp; /opt/homebrew/bin/npm run backup</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key><integer>3</integer>
    <key>Minute</key><integer>0</integer>
  </dict>
  <key>StandardOutPath</key>
  <string>/tmp/fieldmap-backup.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/fieldmap-backup-error.log</string>
</dict>
</plist>
PLIST
launchctl unload ~/Library/LaunchAgents/com.fieldmap.backup.plist 2>/dev/null
launchctl load ~/Library/LaunchAgents/com.fieldmap.backup.plist
launchctl list | grep fieldmap
```

`node`·`npm`·`psql`·`pg_dump` 경로에 주의할 것. 예시의 npm은 `/opt/homebrew/bin/npm` 이다
(예전 안내문에 적혀 있던 `/usr/local/bin/npm` 은 인텔 맥 경로라, 그대로
등록했으면 **오류도 없이 조용히 아무 일도 안 일어났을 것이다**).

### ⚠️ 처음 등록하면 십중팔구 조용히 실패한다 — 권한

프로젝트가 `~/Documents` 안에 있어서 macOS 가 접근을 막는다. 터미널에서
`npm run backup` 은 잘 되는데(터미널 앱에는 권한이 있다) 자동 실행은 안 된다.
**`launchctl list` 에 줄이 떠도 실제로는 안 돌 수 있다.**

증상은 `/tmp/fieldmap-backup-error.log` 에 이렇게 남는다:

```
Error: EPERM: operation not permitted, uv_cwd
```

**시스템 설정 → 개인 정보 보호 및 보안 → 전체 디스크 접근 권한** 에서
`[+]` → `⌘⇧G` 로 아래 **둘 다** 넣고 스위치를 켜야 한다.

```
/bin/bash                                          폴더로 들어가는 쪽
/opt/homebrew/Cellar/node@22/22.22.1_3/bin/node    실제로 파일을 읽고 쓰는 쪽
```

bash 만 주면 안 된다 — 2026-08-23 에 실제로 겪었다. macOS 는 파일을 만지는
프로그램에 권한을 묻는데, 백업하는 것은 node 다.

**node 를 새 버전으로 올리면 경로가 바뀌어 권한이 풀리고 백업이 조용히 멈춘다.**
(`node@22/22.22.1_3` → `node@22/22.23.0_1` 같은 식) 아래 확인을 가끔 해야 하는
이유가 이것이다.

### 등록한 뒤에는 반드시 한 번 돌려 볼 것

```bash
launchctl start com.fieldmap.backup && sleep 30 && tail -5 /tmp/fieldmap-backup.log
```

로그의 완료 문구만 보지 말고 오류 로그, 마지막 종료 상태, 이번 `_meta.json`의
시각·실패 0건·private 감사 성공을 함께 확인합니다. 수동 터미널의 PATH와
자동 실행의 PATH는 다를 수 있으므로 수동 성공만으로 자동 백업 성공을 판단하지 않습니다.

### 잘 돌고 있는지 보기

```bash
ls -1 backups/ | tail -5          # 날짜 폴더가 매일 늘어나는지
cat /tmp/fieldmap-backup.log      # 마지막 실행 결과
npm run restore                   # 최신 백업의 파일·대상 검사 (실제 복구 성공 보장 아님)
```

맥이 꺼져 있으면 그 시각은 건너뛴다. 다음에 켜져 있을 때 돈다.

### 그만두려면

```bash
launchctl unload ~/Library/LaunchAgents/com.fieldmap.backup.plist
rm ~/Library/LaunchAgents/com.fieldmap.backup.plist
```

## 복원 (수동)

전체 복원은 위험하므로 신중히 진행. 일반적으로 특정 테이블 일부만 복원합니다.

**2026-11-20 후속 보완은 한 트랜잭션 복원 도구로 격리 검증했습니다.**
0142에서 확인한 ID·보호 트리거·자동 봉사 기록 생성 충돌을 복원 전용 경로로 해결했습니다.
기존 운영 백업은 새로 포함한 업무 표 3개의 실제 자료가 없으므로 그대로 전체 복원하면 거절됩니다.
시험 자료로 추가 항목의 복구를 검증했을 뿐, 빠진 운영 자료를 복구했다는 뜻은 아닙니다.
결과와 한계: [0143 원자적 복원과 누락 범위 보완](../docs/decisions/0143-atomic-restore-rehearsal.md).

### `npm run restore` — 되돌리기

**기본은 검사만 한다. 아무것도 쓰지 않는다.**
전체·집단 관련 복원은 검사 모드도 위의 DB 소유자 연결과 `psql`이 필요합니다.

```bash
npm run restore                        # 최신 날짜 백업의 파일·대상 검사
npm run restore -- 2026-08-22          # 그 날짜 백업으로
npm run restore -- --table units       # 한 표만
npm run restore -- --write --maintenance             # 이용 중단 확인 후 빠진 행만
npm run restore -- --write --maintenance --replace   # 있는 행도 덮어쓰기
```

검사 모드는 표마다 `백업 N행 / 지금 M행` 을 보여 준다.

```
✅ 같음      ↑ 백업이 더 많음(잃어버린 행이 있다)      ↓ 지금이 더 많음
```

**아무것도 지우지 않는다.** `--replace` 도 덮어쓰기지 삭제가 아니다.
기본값은 빠진 행만 넣습니다. 그래도 파생 설정·수정 번호 갱신은 생길 수 있으므로
무해한 명령은 아닙니다. 쓰기 전 격리 사본에서 연습하고 복원 시점의 백업을 보관합니다.

집단 복원 순서는 `service_groups` → `app_users` → `cards` → `card_group_assignments`입니다.
집단 구역이 설치된 대상에 필수 집단 백업 파일이 없으면 시작 전에 거절합니다.
집단 설정 두 항목은 직접 덮어쓰지 않고 집단 목록에서 다시 만듭니다.
구역 수정 번호는 되돌리지 않아 복원 뒤에도 오래된 화면의 저장을 막습니다.

**쓰기 전체가 한 소유자 트랜잭션입니다.** 표·키·필수 백업 누락, 잘못된 자료 등 오류가 있으면
그 실행에서 바꾼 데이터·트리거·다음 번호가 함께 되돌아갑니다. 고친 뒤 같은 명령으로 재시도합니다.
단, 연결이 끊겨 커밋 응답만 못 받았을 가능성은 별개입니다. 이때는 실제 대상 상태를 먼저 확인합니다.
생성 전용 ID는 명시적 복원 구문을 쓰고, 실제 FK로 부모 순서를 계산합니다.
복원 대상 표를 잠근 뒤 사용자 트리거만 잠시 중지해 알림·봉사 세션을 재생성하지 않습니다.
외래키·NOT NULL·CHECK·고유 제약은 끄지 않습니다. 트리거의 원래 O/D/A/R 상태도 복구합니다.
다음 번호는 기존 번호와 복원 자료보다 크게, `ALTER SEQUENCE RESTART`로 트랜잭션 안에서 맞춥니다.
별도로 SQL Editor에서 번호를 고치지 않습니다.

**`--maintenance`는 이용 중단을 자동 실행하지 않는 운영자 확인 옵션입니다.** 앱 접속·백그라운드
작업·cron을 중지하고 활성 쓰기가 없는지 먼저 확인해야 합니다. 전체 표 잠금으로 읽기도 대기합니다.
복원 후 다시 로그인하고 화면을 새로 열어야 합니다. 실제 사용 중인 DB에서 시험 삼아 실행하지 않습니다.

private 병합 감사 SQL은 별도 복구 단계이며 이 명령에 포함되지 않습니다. 신뢰한 원본만 새/빈 감사 표에
소유자 연결과 `psql --single-transaction -v ON_ERROR_STOP=1`로 적재하고 18행 등을 대조합니다.
이 SQL을 이미 적재한 표에 재실행하면 중복 키로 거절될 수 있으므로 별도로 상태를 확인합니다.
로그인 토큰·푸시 비밀키·설치 manifest/전환 상태는 복원하지 않으며 원래 설치 절차로 준비해야 합니다.
public 자료 복원 성공만으로 새 Supabase 프로젝트가 서비스 가능하다고 판단하지 않습니다.

#### 표를 새로 만들면 두 곳에 등록할 것

1. `scripts/backup.js` 의 `TABLES` — 없으면 백업이 안 된다
   (2026-08-22 에 42개 중 24개가 빠져 있는 걸 발견했다)
2. `scripts/restore.js` 의 `RESTORE_ORDER` — 허용 대상 표에 등록한다.
   실제 쓰기 순서는 DB 외래키를 따라 계산한다. 순환 참조는 자동으로 무시하지 않고 거절한다.

`id` 가 없는 표는 `restore.js` 의 `CONFLICT_KEYS` 에 무엇으로 같은 행인지 적는다.
검사 모드에서 쓰는 기준이다. 쓰기 모드는 DB의 실제 기본키와 입력 칼럼을 검사한다.
기본키가 없거나 백업에서 누락됐으면 중단한다.

#### 실제로 되돌아오는지 확인한 적 있나

있다 (2026-08-22). 카드가 0장인 시험용 지역을 만들어 백업 → 지움 → `--write` 로
되살아나는 것까지 확인했다. **파일이 쌓이는 것과 되돌아오는 것은 다른 문제다** —
표를 크게 바꾼 뒤에는 한 번씩 이렇게 확인하는 편이 좋다.

2026-11-20 집단 보완 검증은 격리 PostgreSQL의 집단 관련 복원 함수·SQL 경로에 한정합니다.
이전 로컬 PostgreSQL 시험은 `backup.js`/`restore.js` 본체 전체를 실행하지 않았습니다.
후속 `backupCommands.test.ts`는 본체를 실행하되 파일·DB·프로세스를 시험용으로 바꿔,
스냅샷 선택과 집단 설정 제외 연결을 확인합니다. 실제 운영 백업이나 전체 데이터 복구
리허설을 대신하지 않습니다. 자세한 범위는 [0141](../docs/decisions/0141-demo-shared-group-territories.md)을 봅니다.

## 백업 보관

- `backups/` 는 `.gitignore` 에 등록되어 git 에 커밋되지 않습니다 (민감 정보 포함)
- 권장: 매월 1회 외장 디스크 또는 iCloud 에 복사
- 비밀번호 해시값이 포함되어 있으므로 외부 노출 금지

## 백업 파일 구조

```
backups/2026-04-30/
├── _meta.json              # 백업 메타정보 (시각, 행 수 등)
├── app_users.json
├── login_logs.json
├── cards.json
├── service_groups.json
├── card_group_assignments.json  # 집단 구역 기능 설치 시
├── buildings.json
├── ...
└── private_duplicate_building_merge_audits.sql
```

각 JSON 은 `[{컬럼: 값, ...}, ...]` 형태의 배열.
