#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const migrationsDir = join(root, 'supabase', 'migrations')
const toolsDir = join(root, 'supabase', 'tools')
const rollbackDir = join(root, 'supabase', 'tools', 'rollbacks')
const requiredFiles = [
  'supabase/baseline.sql',
  'supabase/baseline-extras.sql',
  'supabase/tools/_SET_새회중_기본설정.sql',
  'supabase/tools/_VERIFY_new_project.sql',
  'docs/새-회중-설치.md',
]
const requiredForwardMigrations = [
  '20260828_1000_session_helper_and_signup.sql',
  '20260828_1200_anon_write_lockdown.sql',
  '20260901_0910_guard_login_logs.sql',
  '20260907_1000_finalize_admin_settings_notices.sql',
  '20260907_1100_finalize_calendar_assignment_policies.sql',
  '20260907_1200_finalize_personal_service_policies.sql',
  '20260907_1300_finalize_territory_structure_policies.sql',
  '20260907_1400_finalize_visit_history_policies.sql',
  '20260907_1510_finalize_app_user_policies.sql',
  '20260918_1000_chinese_territory_reports.sql',
  '20260920_1200_create_building_tx.sql',
  '20260922_1000_revoke_login_logs_select.sql',
  '20260922_1100_territory_report_regular_visit_visibility.sql',
]
const neutralRuntimeFiles = [
  'vite.config.ts',
  'src/components/DesktopApp.tsx',
  'src/components/Login.tsx',
  'src/components/TerritoryReportView.tsx',
  'src/locales/ko.ts',
  'src/locales/zh.ts',
  'src/locales/en.ts',
]

const errors = []
const forwardMigrations = readdirSync(migrationsDir).filter((name) => name.endsWith('.sql')).sort()
const rollbackFiles = existsSync(rollbackDir)
  ? readdirSync(rollbackDir).filter((name) => name.endsWith('.sql')).sort()
  : []
const strayRollbackFiles = readdirSync(toolsDir)
  .filter((name) => /^_ROLLBACK_.+\.sql$/.test(name))
  .sort()

for (const file of requiredFiles) {
  if (!existsSync(join(root, file))) errors.push(`필수 파일 없음: ${file}`)
}

for (const file of forwardMigrations) {
  if (!/^20\d{6}_\d{4}_.+\.sql$/.test(file)) {
    errors.push(`설치 경로에 순방향 마이그레이션이 아닌 파일이 있음: supabase/migrations/${file}`)
  }
  const sql = readFileSync(join(migrationsDir, file), 'utf8')
  if (/롤백 전용|_ROLLBACK_/i.test(sql.slice(0, 500))) {
    errors.push(`롤백 SQL이 설치 경로에 섞임: supabase/migrations/${file}`)
  }
}

for (const file of requiredForwardMigrations) {
  if (!forwardMigrations.includes(file)) errors.push(`핵심 마이그레이션 없음: ${file}`)
}

if (rollbackFiles.length === 0) errors.push('supabase/tools/rollbacks 에 복구 SQL이 없습니다')
if (strayRollbackFiles.length > 0) {
  errors.push(`롤백 SQL이 rollbacks/ 밖에 있음: ${strayRollbackFiles.join(', ')}`)
}

for (const file of neutralRuntimeFiles) {
  const source = readFileSync(join(root, file), 'utf8')
  if (/YONGIN|Yongin|용인 회중|경기용인중국어/.test(source)) {
    errors.push(`외부 인계 화면에 특정 회중 표기가 남음: ${file}`)
  }
}

const installDoc = readFileSync(join(root, 'docs', '새-회중-설치.md'), 'utf8')
if (!installDoc.includes('supabase/migrations/20*.sql')) {
  errors.push('설치 문서가 순방향 마이그레이션 패턴(20*.sql)을 명시하지 않습니다')
}
if (!installDoc.includes('npm run check:install-package')) {
  errors.push('설치 문서에 패키지 사전검사 명령이 없습니다')
}

if (errors.length > 0) {
  console.error('\n새 회중 설치 패키지 검사 실패')
  errors.forEach((error) => console.error(`  - ${error}`))
  process.exit(1)
}

console.log(`새 회중 설치 패키지 정상: 순방향 ${forwardMigrations.length}개 · 롤백 ${rollbackFiles.length}개 분리`)
