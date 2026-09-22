import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('new congregation handoff branding', () => {
  it('keeps user-visible runtime files free of the source congregation name', () => {
    const files = [
      'vite.config.ts',
      'src/components/DesktopApp.tsx',
      'src/components/Login.tsx',
      'src/components/TerritoryReportView.tsx',
      'src/locales/ko.ts',
      'src/locales/zh.ts',
      'src/locales/en.ts',
    ]
    const source = files.map((file) => readFileSync(file, 'utf8')).join('\n')
    expect(source).not.toMatch(/YONGIN|Yongin|용인 회중|경기용인중국어/)
  })
})
