// OS·스와이프 뒤로가기용 "닫기 핸들러 스택".
//
// 왜 필요한가: 오버레이가 겹칠 때(예: 배정 에디터 위의 구역 배분) 각자
// window 에 popstate 리스너를 달면 한 번의 제스처에 모든 층이 반응해
// 여러 단계가 한꺼번에 닫힌다(등록 순서상 바깥 층이 먼저 실행됨).
// → 여기서 스택을 관리해 "가장 위에 있는 한 층"만 닫는다.
//
// 사용법:
//   useEffect(() => (open ? pushBackHandler(() => close()) : undefined), [open])

const HISTORY_KEY = '__fieldMapBackStackId'

type Entry = { id: number; handler: () => void; poppedByHistory: boolean }

const stack: Entry[] = []
let listening = false
let nextEntryId = 1
// 코드로 정리한 더미 기록에서 발생하는 popstate만 정확히 한 번 무시한다.
// 시간 창으로 무시하면 그 사이 사용자가 한 진짜 스와이프까지 먹어 버린다.
let ignoredProgrammaticPops = 0

function onPop() {
  if (ignoredProgrammaticPops > 0) {
    ignoredProgrammaticPops -= 1
    return
  }
  const top = stack[stack.length - 1]
  if (!top) return
  // 현재도 최상단 더미 기록이면 실제로 뒤로 이동한 것이 아니다.
  if (window.history.state?.[HISTORY_KEY] === top.id) return
  top.poppedByHistory = true
  stack.pop()
  top.handler()
}

/**
 * 더미 히스토리를 하나 쌓고 뒤로가기 핸들러를 스택 최상단에 등록한다.
 * 반환된 함수를 호출하면(보통 effect cleanup) 등록이 해제되고,
 * 제스처가 아닌 코드로 닫힌 경우엔 쌓아둔 더미 히스토리도 정리한다.
 */
export function pushBackHandler(handler: () => void): () => void {
  const entry: Entry = { id: nextEntryId++, handler, poppedByHistory: false }
  stack.push(entry)
  window.history.pushState({ ...window.history.state, [HISTORY_KEY]: entry.id }, '')

  if (!listening) {
    window.addEventListener('popstate', onPop)
    listening = true
  }

  return () => {
    const index = stack.indexOf(entry)
    if (index >= 0) stack.splice(index, 1)
    // 다른 라우트 이동이 먼저 기록을 치운 경우에는 추가로 뒤로 가지 않는다.
    if (!entry.poppedByHistory && window.history.state?.[HISTORY_KEY] === entry.id) {
      ignoredProgrammaticPops += 1
      window.history.back()
    }
  }
}

/** 현재 최상단 오버레이가 만든 히스토리 한 칸을 뒤로 보낸다. */
export function requestBackHandler(): boolean {
  const top = stack[stack.length - 1]
  if (!top || window.history.state?.[HISTORY_KEY] !== top.id) return false
  window.history.back()
  return true
}
