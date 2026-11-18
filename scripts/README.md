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

`backups/YYYY-MM-DD/` 폴더에 모든 테이블이 JSON 으로 저장됩니다.

`.env.local` 에 다음 두 변수가 필요:
```
VITE_SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
```

## 자동 백업 (macOS launchd, 매일 새벽 3시)

⚠️ **아래 명령을 그대로 붙여넣으면 등록된다.** 지금은 등록돼 있지 않아
손으로 `npm run backup` 할 때만 백업된다 — 기억하는 날에만 돌아간다는 뜻이다.

```bash
cat > ~/Library/LaunchAgents/com.fieldmap.backup.plist <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.fieldmap.backup</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>-lc</string>
    <string>cd "/Users/gm/Documents/New project/chinese-territory-app" && /opt/homebrew/bin/npm run backup</string>
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

`npm` 경로에 주의할 것. 이 맥은 `/opt/homebrew/bin/npm` 이다
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

`🎉 백업 완료` 가 나와야 진짜 된 것이다. 새벽 3시에 안 되는 걸 몇 달 뒤에
아는 것보다 낫다.

### 잘 돌고 있는지 보기

```bash
ls -1 backups/ | tail -5          # 날짜 폴더가 매일 늘어나는지
cat /tmp/fieldmap-backup.log      # 마지막 실행 결과
npm run restore                   # 최신 백업이 되돌릴 수 있는 상태인지
```

맥이 꺼져 있으면 그 시각은 건너뛴다. 다음에 켜져 있을 때 돈다.

### 그만두려면

```bash
launchctl unload ~/Library/LaunchAgents/com.fieldmap.backup.plist
rm ~/Library/LaunchAgents/com.fieldmap.backup.plist
```

## 복원 (수동)

전체 복원은 위험하므로 신중히 진행. 일반적으로 특정 테이블 일부만 복원합니다.

### `npm run restore` — 되돌리기

**기본은 검사만 한다. 아무것도 쓰지 않는다.**

```bash
npm run restore                        # 오늘 백업이 되돌릴 수 있는 상태인지 검사
npm run restore -- 2026-08-22          # 그 날짜 백업으로
npm run restore -- --table units       # 한 표만
npm run restore -- --write             # 실제로 넣기 (빠진 행만)
npm run restore -- --write --replace   # 있는 행도 덮어쓰기
```

검사 모드는 표마다 `백업 N행 / 지금 M행` 을 보여 준다.

```
✅ 같음      ↑ 백업이 더 많음(잃어버린 행이 있다)      ↓ 지금이 더 많음
```

**아무것도 지우지 않는다.** `--replace` 도 덮어쓰기지 삭제가 아니다.
기본값은 빠진 행만 넣으므로, 잘못 돌려도 멀쩡한 데이터가 상하지 않는다.

넣기가 끝나면 **시퀀스를 맞추는 SQL** 을 찍어 준다. 그걸 Supabase SQL Editor 에서
실행해야 한다. 안 하면 새 글을 쓸 때 이미 쓰인 id 를 다시 내주어 충돌한다.

#### 표를 새로 만들면 두 곳에 등록할 것

1. `scripts/backup.js` 의 `TABLES` — 없으면 백업이 안 된다
   (2026-08-22 에 42개 중 24개가 빠져 있는 걸 발견했다)
2. `scripts/restore.js` 의 `RESTORE_ORDER` — 부모 표보다 뒤에 둔다.
   순서가 틀리면 외래키에 막혀 중간에 멈춘다

`id` 가 없는 표는 `restore.js` 의 `CONFLICT_KEYS` 에 무엇으로 같은 행인지 적는다.
안 적으면 **넣지 않고 건너뛴다** — 기준 없이 넣으면 있는 행이 통째로 복제되기 때문이다.

#### 실제로 되돌아오는지 확인한 적 있나

있다 (2026-08-22). 카드가 0장인 시험용 지역을 만들어 백업 → 지움 → `--write` 로
되살아나는 것까지 확인했다. **파일이 쌓이는 것과 되돌아오는 것은 다른 문제다** —
표를 크게 바꾼 뒤에는 한 번씩 이렇게 확인하는 편이 좋다.

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
├── buildings.json
├── ...
└── (총 18개 테이블)
```

각 JSON 은 `[{컬럼: 값, ...}, ...]` 형태의 배열.
