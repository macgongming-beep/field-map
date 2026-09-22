import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('demo database scripts', () => {
  it('keeps destructive demo reset code out of the install migration set', () => {
    const migrationFiles = readdirSync('supabase/migrations').filter((name) => name.endsWith('.sql'))
    const migrationSql = migrationFiles
      .map((name) => readFileSync(`supabase/migrations/${name}`, 'utf8'))
      .join('\n')

    expect(migrationSql).not.toContain('reset_demo_environment_tx')
    expect(existsSync('supabase/demo/20260913_1100_demo_environment_reset.sql')).toBe(true)
    expect(readFileSync('docs/새-회중-설치.md', 'utf8')).toContain('`supabase/demo/` 는 외부 시연 DB 전용')
  })

  it('keeps rollback scripts out of the forward install migration set', () => {
    const migrations = readdirSync('supabase/migrations').filter((name) => name.endsWith('.sql'))
    const strayRollbacks = readdirSync('supabase/tools').filter((name) => name.startsWith('_ROLLBACK_'))
    expect(migrations.length).toBeGreaterThan(0)
    expect(migrations.every((name) => /^20\d{6}_\d{4}_.+\.sql$/.test(name))).toBe(true)
    expect(migrations.some((name) => name.includes('ROLLBACK'))).toBe(false)
    expect(strayRollbacks).toEqual([])
    expect(existsSync('supabase/tools/rollbacks/_ROLLBACK_20260920_건물등록RPC.sql')).toBe(true)
  })
})
