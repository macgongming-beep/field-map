// 글씨 크기(zoom)를 깨뜨리는 변경을 막는 감시 시험.
//
// 왜: `#root` 에 zoom 을 걸면 **화면높이 단위가 그만큼 커진다**
// (브라우저 실측: 100svh 가 812 → 1015). 그래서 vh/svh/dvh 를 전부
// `calc(… / var(--app-zoom, 1))` 로 나눠 두었다.
// 새 코드가 보정 없이 vh 를 쓰면 그 화면만 조용히 넘친다 — 증상이 늦게 나타난다.
import { describe, test, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/** 보정되지 않은 화면높이 단위 (앞에 calc(…/var 가 없는 것) */
const RAW_VH = /(?<![\w.#-])\d+(?:\.\d+)?(?:svh|dvh|vh)\b(?!\s*\/\s*var\(--app-zoom)/g

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (/\.(css|ts|tsx)$/.test(e.name) && !e.name.includes('.test.')) out.push(p)
  }
  return out
}

describe('글씨 크기(zoom) 보정', () => {
  test('보정 없이 vh/svh/dvh 를 쓰는 곳이 없다', () => {
    const offenders: string[] = []
    for (const file of walk('src')) {
      const text = readFileSync(file, 'utf8')
      for (const m of text.matchAll(RAW_VH)) {
        // 이 감시 시험 자신의 정규식은 뺀다
        if (file.endsWith('fontScaleGuard.test.ts')) continue
        offenders.push(`${file}: ${m[0]}`)
      }
    }
    expect(offenders).toEqual([])
  })

  test('⚠ 변수와 zoom 이 **같은 @supports 안**에 있다', () => {
    // zoom 이 무시되는 환경에서 변수만 적용되면 vh 보정이 나누기만 해서
    // **화면이 오히려 작아진다.** 둘을 같이 묶어야 "안 커지기만" 한다.
    const css = readFileSync('src/index.css', 'utf8')
    const block = css.match(/@supports \(zoom:[\s\S]*?\n\}/)
    expect(block, '@supports (zoom: …) 블록이 없다').toBeTruthy()
    const inside = block![0]
    expect(inside).toMatch(/--app-zoom:\s*1\.125/)
    expect(inside).toMatch(/--app-zoom:\s*1\.25/)
    expect(inside).toMatch(/zoom: var\(--app-zoom\)/)
    // 블록 **밖**에 --app-zoom 정의가 있으면 안 된다
    expect(css.replace(inside, '')).not.toMatch(/--app-zoom:\s*1\.[0-9]/)
  })

  test('zoom 규칙이 살아 있다 — 두 단계 모두', () => {
    const css = readFileSync('src/index.css', 'utf8')
    expect(css).toMatch(/html\[data-font-scale='large'\]\s*\{\s*--app-zoom:\s*1\.125/)
    expect(css).toMatch(/html\[data-font-scale='x-large'\]\s*\{\s*--app-zoom:\s*1\.25/)
    expect(css).toMatch(/#root\s*\{[\s\S]{0,40}zoom: var\(--app-zoom\)/)
  })

  test('⚠ 기본(normal)에는 zoom 을 걸지 않는다 — 안 켠 사람 화면이 바뀌면 안 된다', () => {
    const css = readFileSync('src/index.css', 'utf8')
    // ⚠ "규칙 안에 data-font-scale 이 있나" 로 보면 안 된다.
    //   `#root, html[data-font-scale='x-large'] #root` 처럼 **선택자 목록에 하나만**
    //   있어도 통과하는데, 그게 정확히 기본 사용자에게 zoom 이 걸리는 경우다.
    //   (변형 검사에서 실제로 이 구멍이 잡혔다)
    //   → 선택자를 쪼개서 **하나하나** 본다.
    // ⚠ 주석을 먼저 걷어낸다. 주석에 'zoom: 1' 이라고 적어 두었는데 그게 선택자로
    //   읽혀서 시험이 엉뚱하게 실패했다.
    const bare = css.replace(/\/\*[\s\S]*?\*\//g, '')
    const zoomRules = bare.match(/[^{}]*\{[^{}]*zoom:[^{}]*\}/g) ?? []
    expect(zoomRules.length).toBeGreaterThan(0)
    for (const rule of zoomRules) {
      const selectors = rule.slice(0, rule.indexOf('{')).split(',').map((x) => x.trim()).filter(Boolean)
      expect(selectors.length).toBeGreaterThan(0)
      for (const sel of selectors) {
        expect(sel, `이 선택자는 켜지 않은 사람에게도 zoom 을 건다: ${sel}`).toMatch(/\[data-font-scale/)
      }
    }
  })
})

describe('확대 범위 밖으로 새지 않는다', () => {
  test('⚠ 화면 포털은 zoom 범위 안에 둔다 — 인쇄 전용 출력만 예외', () => {
    // zoom 은 #root 에 걸린다. body 로 붙인 알림·채팅·확인창은 큰 글씨로
    // 설정한 분에게 **그것만 작게** 보인다. 리뷰에서 실제로 잡힌 구멍이다.
    const offenders: string[] = []
    for (const file of walk('src')) {
      if (!/\.tsx?$/.test(file)) continue
      const text = readFileSync(file, 'utf8')
      // ⚠ 주석은 빼고 본다. "document.body 가 아니라…" 라고 적어 둔 주석이
      //   걸려서 시험이 엉뚱하게 실패했다.
      const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
      if (!code.includes('createPortal')) continue
      // ⚠ `createPortal(..., document.body)` 순서만 보면 안 된다.
      //   `const target = document.body; createPortal(children, target)` 로 쓰면 빠져나간다
      //   (변형 검사에서 실제로 이 구멍이 잡혔다).
      //   → 포털을 쓰는 파일에서 `document.body` 를 아예 못 쓰게 한다.
      if (code.includes('document.body')) offenders.push(file)
    }
    // Paper dimensions must not inherit the reader's screen zoom. This exact
    // print-only root is invisible on screen; ordinary overlays remain forbidden.
    expect(offenders).toEqual(['src/components/AttendancePrint.tsx'])
    const printCss = readFileSync('src/components/ServiceAttendanceStats.css', 'utf8')
    expect(printCss).toMatch(/\.attendance-print-root\s*\{\s*display:none;\s*\}/)
    expect(printCss).toMatch(/@media print\s*\{[\s\S]*> \.attendance-print-root\s*\{\s*display:block !important/)
    const printComponent = readFileSync('src/components/AttendancePrint.tsx', 'utf8')
    expect(printComponent.match(/createPortal\(/g)).toHaveLength(1)
    expect(printComponent).toContain('createPortal(<div className="attendance-print-root" aria-hidden="true">')
  })

  test('포털이 붙을 자리는 #root 안에 만든다', () => {
    const src = readFileSync('src/lib/overlayRoot.ts', 'utf8')
    expect(src).toMatch(/getElementById\('root'\)/)
  })
})
