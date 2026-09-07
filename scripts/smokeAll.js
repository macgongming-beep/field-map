#!/usr/bin/env node
// 역할·알림 정책을 실제 HTTP 경로로 차례대로 검증한다.
// CI가 아니라 테스트 DB에 마이그레이션을 적용한 뒤 사람이 실행하는 관문이다.
import { spawnSync } from 'node:child_process'

const scripts = [
  'smokeHeaders.js',
  'smokeLockdown.js',
  'smokeNotifyRpc.js',
  'smokeSpecialPeriods.js',
  'smokeLoginLogs.js',
  'smokeChatRoomMutes.js',
  'smokeComments.js',
  'smokeTerritoryRegions.js',
  'smokeServiceSuggestions.js',
  'smokeInformalGroups.js',
  'smokeInformalAssets.js',
  'smokeEventAssignments.js',
  'smokeReviewTasks.js',
  'smokeRestaurantRequests.js',
  'smokeAddUnits.js',
  'smokeReturnVisitCreate.js',
  'smokeReturnVisitEnd.js',
  'smokePlaceDeletion.js',
  'smokePhoneSurveys.js',
  'smokeAdminPolicyPilot.js',
  'smokeCalendarAssignmentPolicies.js',
  'smokePersonalServicePolicies.js',
  'smokeTerritoryStructurePolicies.js',
  'smokeVisitHistoryPolicies.js',
  'smokeAppUserPolicies.js',
]

for (const script of scripts) {
  console.log(`\n── ${script} ──\n`)
  const result = spawnSync(process.execPath, [`scripts/${script}`], {
    stdio: 'inherit',
    env: process.env,
  })
  if (result.status !== 0) {
    console.error(`\n❌ ${script} 실패 — 나머지 smoke를 중단합니다.`)
    process.exit(result.status ?? 1)
  }
}

console.log(`\n✅ 권한 smoke ${scripts.length}종 전체 통과\n`)
