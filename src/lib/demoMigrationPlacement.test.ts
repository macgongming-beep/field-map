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
})
