import { confirmDialog } from './confirm'
import { willNotifyOnEventChange, isNotifiableDate, type NotifiableEventFields } from '../utils/eventNotify'
import { getLocalDateString } from '../utils/dateUtils'

/**
 * 일정을 고치기 직전에 "알림 보낼까요?" 를 묻는다.
 *
 * **실제로 알림이 나갈 때만** 묻는다:
 *   · 알림 대상 칸(날짜·시간·장소·지도링크·인도자·제목)이 바뀌었고
 *   · 지난 일정이 아니고
 *   · 받을 사람이 있을 때
 * 메모만 고치면 묻지 않고 조용히 저장한다 — 물어봐야 성가시기만 하다.
 *
 * 두 화면(PC·모바일)이 같은 걸 쓰게 하려고 여기 모았다.
 * 각자 만들면 한쪽만 고쳐지고 갈라진다 — 이 앱에서 여러 번 그랬다.
 */
export async function askNotifyOnEventEdit(opts: {
  before: NotifiableEventFields
  after: NotifiableEventFields
  /** 알림을 받을 사람 수 (일반·전시대 신청자 + 인도자, 편집자·게스트 제외). 0이면 묻지 않는다 */
  recipientCount: number
  /** 반복 일정이면 몇 개가 바뀌는지 */
  seriesCount?: number
  /** 반복이면 바뀌는 회차들의 날짜. 하나라도 오늘 이후면 알림이 나간다 */
  affectedDates?: string[]
}): Promise<boolean> {
  if (!willNotifyOnEventChange(opts.before, opts.after)) return false
  // 반복 수정이면 **바뀌는 회차 중 하나라도 오늘 이후**면 알림이 나간다.
  // 고른 회차 하나만 보면, 지난 회차에서 '이후 모두' 를 골랐을 때
  // 묻지도 않고 미래 회차가 조용히 바뀐다.
  const today = getLocalDateString()
  const dates = opts.affectedDates ?? (opts.after.date ? [opts.after.date] : [])
  if (dates.length > 0 && !dates.some((d) => isNotifiableDate(d, today))) return false
  if (opts.recipientCount <= 0) return false

  const who = `참여자 ${opts.recipientCount}명`
  const what = opts.seriesCount && opts.seriesCount > 1
    ? `반복 일정 ${opts.seriesCount}개의 시간·장소·인도자가 바뀝니다.`
    : '일정의 시간·장소·인도자가 바뀝니다.'
  return confirmDialog({
    message: `${what}\n${who}에게 알림을 보낼까요?\n\n('보내지 않기' 를 눌러도 수정은 저장됩니다.)`,
    confirmLabel: '알림 보내기',
    cancelLabel: '보내지 않기',
  })
}

/**
 * 공지를 올리기 직전에 "전원에게 알림 보낼까요?" 를 묻는다.
 *
 * 공지는 **승인된 활성 사용자 전원**에게 간다 (지금 60명). 되돌릴 수 없다.
 * 오타를 고쳐 다시 올리거나 시험 삼아 올려도 60명 폰이 울렸다.
 */
export function askNotifyOnNotice(): Promise<boolean> {
  return confirmDialog({
    message: '공지는 회중 전원에게 알림이 갑니다.\n알림을 보낼까요?\n\n(\'보내지 않기\' 를 눌러도 공지는 올라갑니다.)',
    confirmLabel: '알림 보내기',
    cancelLabel: '보내지 않기',
  })
}
