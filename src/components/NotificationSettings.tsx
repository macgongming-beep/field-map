// 알림 설정 (종류별 on/off + 방해금지 시간)
import { useCallback, useEffect, useState } from 'react'
import { useNotificationPrefs } from '../hooks/useNotificationPrefs'
import { DevicePushToggle, type DevicePushState } from './DevicePushToggle'
import { PwaInstallModal } from './PwaInstall'
import type { AppLanguage } from '../i18n'
import { getAuthToken } from '../lib/authToken'
import { supabase } from '../lib/supabase'
import type { Role } from '../types'

type PrefKey =
  | 'pushEventChange'
  | 'pushChat' | 'pushMention' | 'pushServiceStatus' | 'pushDailyService'

type SubItem = { key: PrefKey; labelKo: string; descKo: string; labelZh: string; descZh: string; labelEn: string; descEn: string }

type Group = {
  id: 'activity' | 'social'
  labelKo: string; labelZh: string; labelEn: string
  descKo: string; descZh: string; descEn: string
  items: SubItem[]
}

const GROUPS: Group[] = [
  {
    id: 'activity',
    labelKo: '봉사 활동', labelZh: '传道活动', labelEn: 'Service',
    descKo: '오늘의 마련 · 일정 변경 · 봉사 시작/종료', descZh: '今日安排 · 日程变更 · 传道开始/结束', descEn: "Today's plan · Event changes · Service start/end",
    items: [
      { key: 'pushEventChange', labelKo: '일정 변경', descKo: '봉사 시간/장소가 바뀔 때 (참여한 일정만)', labelZh: '日程变更', descZh: '传道时间/地点变更时（仅参与日程）', labelEn: 'Event update', descEn: 'When time/place changes (joined events only)' },
      { key: 'pushDailyService', labelKo: '오늘의 봉사 마련', descKo: '봉사가 있는 날 아침에 그날 마련 안내', labelZh: '今日传道安排', descZh: '有传道的日子早上发送当天安排', labelEn: "Today's arrangements", descEn: "Morning summary on days with service" },
      { key: 'pushServiceStatus', labelKo: '봉사 시작/종료', descKo: '참여 봉사가 시작되거나 종료될 때', labelZh: '传道开始/结束', descZh: '参与的传道开始或结束时', labelEn: 'Service start/end', descEn: 'When your joined service starts or ends' },
    ],
  },
  {
    id: 'social',
    labelKo: '소통', labelZh: '交流', labelEn: 'Social',
    descKo: '채팅 · 멘션', descZh: '聊天 · @提及', descEn: 'Chat · Mentions',
    items: [
      { key: 'pushChat', labelKo: '채팅 메시지', descKo: '봉사 채팅방에 새 메시지가 올 때', labelZh: '聊天消息', descZh: '传道聊天室有新消息时', labelEn: 'Chat message', descEn: 'New message in service chat' },
      { key: 'pushMention', labelKo: '@멘션', descKo: '누군가 회원님을 언급할 때', labelZh: '@提及', descZh: '有人提及您时', labelEn: '@Mention', descEn: 'When someone mentions you' },
    ],
  },
]

function gl(g: Group, lang: AppLanguage) {
  return lang === 'zh' ? g.labelZh : lang === 'en' ? g.labelEn : g.labelKo
}
function gd(g: Group, lang: AppLanguage) {
  return lang === 'zh' ? g.descZh : lang === 'en' ? g.descEn : g.descKo
}
function il(i: SubItem, lang: AppLanguage) {
  return lang === 'zh' ? i.labelZh : lang === 'en' ? i.labelEn : i.labelKo
}
function id_(i: SubItem, lang: AppLanguage) {
  return lang === 'zh' ? i.descZh : lang === 'en' ? i.descEn : i.descKo
}

type DailyServiceSettings = {
  enabled: boolean
  send_time: string
}

type GlobalQuietSettings = {
  enabled: boolean
  quiet_start: string
  quiet_end: string
}

export function NotificationSettings({
  userId,
  language = 'ko',
  role = 'user',
}: {
  userId: number
  language?: string
  role?: Role
}) {
  const lang = (language ?? 'ko') as AppLanguage
  const { prefs, saving, update } = useNotificationPrefs(userId)
  const dndEnabled = prefs.quietHoursStart !== null && prefs.quietHoursEnd !== null
  const [localStart, setLocalStart] = useState(prefs.quietHoursStart ?? '22:00')
  const [localEnd, setLocalEnd] = useState(prefs.quietHoursEnd ?? '07:00')
  // 이 기기 알림 상태 — 꺼져 있으면 아래 종류별 설정이 무시되므로 흐리게 표시
  const [devicePush, setDevicePush] = useState<DevicePushState>('off')
  const [showInstallGuide, setShowInstallGuide] = useState(false)
  const handleDeviceState = useCallback((next: DevicePushState) => setDevicePush(next), [])
  const deviceOff = devicePush !== 'on'

  const [expandedGroup, setExpandedGroup] = useState<Group['id'] | null>(null)
  const canManageGlobalQuiet = role === 'admin' || role === 'developer'
  const [globalQuiet, setGlobalQuiet] = useState<GlobalQuietSettings>({
    enabled: false,
    quiet_start: '22:00',
    quiet_end: '07:00',
  })
  const [daily, setDaily] = useState<DailyServiceSettings>({ enabled: true, send_time: '09:00' })
  const [dailyBusy, setDailyBusy] = useState(false)
  const [dailyMessage, setDailyMessage] = useState<string | null>(null)
  const [globalQuietLoading, setGlobalQuietLoading] = useState(false)
  const [globalQuietSaving, setGlobalQuietSaving] = useState(false)
  const [globalQuietMessage, setGlobalQuietMessage] = useState<string | null>(null)

  useEffect(() => {
    if (!canManageGlobalQuiet) return
    let alive = true

    async function loadGlobalQuiet() {
      const token = getAuthToken()
      if (!token) return
      setGlobalQuietLoading(true)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 생성된 supabase 타입에 없는 RPC
      const { data, error } = await supabase.rpc('get_global_push_quiet_settings' as any, { p_token: token })
      if (!alive) return
      setGlobalQuietLoading(false)
      if (error) {
        setGlobalQuietMessage(lang === 'zh' ? '无法读取全体设置' : lang === 'en' ? 'Could not load global settings' : '전체 설정을 불러오지 못했습니다')
        return
      }
      const row = Array.isArray(data) ? data[0] : data
      if (row) {
        setGlobalQuiet({
          enabled: !!row.enabled,
          quiet_start: String(row.quiet_start ?? '22:00').slice(0, 5),
          quiet_end: String(row.quiet_end ?? '07:00').slice(0, 5),
        })
      }
    }

    async function loadDaily() {
      const token = getAuthToken()
      if (!token) return
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 생성된 supabase 타입에 없는 RPC
      const { data, error } = await supabase.rpc('get_daily_service_settings' as any, { p_token: token })
      if (!alive || error) return
      const row = Array.isArray(data) ? data[0] : data
      if (row) {
        setDaily({ enabled: !!row.enabled, send_time: String(row.send_time ?? '09:00').slice(0, 5) })
      }
    }

    loadGlobalQuiet()
    loadDaily()
    return () => { alive = false }
  }, [canManageGlobalQuiet, lang])

  // 오늘의 봉사 마련 알림 (관리자) — 발송 시각/사용 여부
  async function saveDaily(next: DailyServiceSettings) {
    const token = getAuthToken()
    if (!token) return
    setDaily(next)
    setDailyBusy(true)
    setDailyMessage(null)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 생성된 supabase 타입에 없는 RPC
    const { data, error } = await supabase.rpc('update_daily_service_settings' as any, {
      p_token: token,
      p_enabled: next.enabled,
      p_send_time: next.send_time,
    })
    setDailyBusy(false)
    if (error) {
      setDailyMessage(lang === 'zh' ? '保存失败' : lang === 'en' ? 'Save failed' : '저장하지 못했습니다')
      return
    }
    const row = Array.isArray(data) ? data[0] : data
    if (row) {
      setDaily({ enabled: !!row.enabled, send_time: String(row.send_time ?? next.send_time).slice(0, 5) })
    }
    setDailyMessage(lang === 'zh' ? '已保存' : lang === 'en' ? 'Saved' : '저장되었습니다')
  }

  async function saveGlobalQuiet(next: GlobalQuietSettings) {
    const token = getAuthToken()
    if (!token) {
      setGlobalQuietMessage(lang === 'zh' ? '需要重新登录' : lang === 'en' ? 'Please log in again' : '다시 로그인해 주세요')
      return
    }
    setGlobalQuiet(next)
    setGlobalQuietSaving(true)
    setGlobalQuietMessage(null)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 생성된 supabase 타입에 없는 RPC
    const { data, error } = await supabase.rpc('update_global_push_quiet_settings' as any, {
      p_token: token,
      p_enabled: next.enabled,
      p_quiet_start: next.quiet_start,
      p_quiet_end: next.quiet_end,
    })
    setGlobalQuietSaving(false)
    if (error) {
      setGlobalQuietMessage(lang === 'zh' ? '保存失败' : lang === 'en' ? 'Save failed' : '저장하지 못했습니다')
      return
    }
    const row = Array.isArray(data) ? data[0] : data
    if (row) {
      setGlobalQuiet({
        enabled: !!row.enabled,
        quiet_start: String(row.quiet_start ?? next.quiet_start).slice(0, 5),
        quiet_end: String(row.quiet_end ?? next.quiet_end).slice(0, 5),
      })
    }
    setGlobalQuietMessage(lang === 'zh' ? '已保存' : lang === 'en' ? 'Saved' : '저장되었습니다')
  }

  return (
    // 바깥 카드 없이 평평하게 — 페이지(모바일) / desk-card(PC) 가 이미 감싸므로
    // 카드를 또 두면 좌우 여백이 3중으로 겹쳐 시간 입력칸이 눌린다
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
          <span style={{
            display: 'grid', width: 32, height: 32, placeItems: 'center',
            borderRadius: 9, background: 'var(--tint)', color: 'var(--text)',
            flexShrink: 0,
          }}>
            <svg viewBox="0 0 24 24" aria-hidden="true" style={{ width: 16, height: 16, fill: 'none', stroke: 'currentColor', strokeWidth: 1.75, strokeLinecap: 'round', strokeLinejoin: 'round' }}>
              <path d="M18 9a6 6 0 1 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
              <path d="M10 21a2 2 0 0 0 4 0" />
            </svg>
          </span>
          <div style={{ minWidth: 0 }}>
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: 'var(--ink)', lineHeight: 1.3, letterSpacing: '-0.01em' }}>
              {lang === 'zh' ? '通知设置' : lang === 'en' ? 'Notification Settings' : '알림 설정'}
            </h3>
            <p style={{ margin: '2px 0 0', fontSize: 12.5, fontWeight: 500, color: 'var(--muted)' }}>
              {lang === 'zh' ? '管理接收通知和免打扰时间' : lang === 'en' ? 'Manage alerts and quiet hours' : '받을 알림과 조용한 시간 관리'}
            </p>
          </div>
        </div>
        {saving && (
          <span style={{
            flexShrink: 0, padding: '3px 9px', borderRadius: 999,
            background: 'var(--tint)', color: 'var(--muted)', fontSize: 11.5, fontWeight: 500,
          }}>
            {lang === 'zh' ? '保存中' : lang === 'en' ? 'Saving...' : '저장 중'}
          </span>
        )}
      </div>

      {/* 이 기기 알림 (대문) — 설정 첫 화면에 흩어져 있던 것을 여기로 통합 */}
      <DevicePushToggle
        language={lang}
        onStateChange={handleDeviceState}
        onOpenInstallGuide={() => setShowInstallGuide(true)}
      />
      {showInstallGuide && (
        <PwaInstallModal language={lang} onClose={() => setShowInstallGuide(false)} />
      )}

      {canManageGlobalQuiet && (
        <div style={{
          marginBottom: 16,
          padding: '13px 12px',
          borderRadius: 12,
          border: '1px solid var(--line)',
          background: 'var(--paper)',
          minWidth: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <div style={{ minWidth: 0 }}>
              <p style={{ margin: 0, fontSize: 14, fontWeight: 650, color: 'var(--ink)', lineHeight: 1.35 }}>
                {lang === 'zh' ? '今日传道安排通知' : lang === 'en' ? "Today's arrangements alert" : '오늘의 봉사 마련 알림'}
              </p>
              <p style={{ margin: '3px 0 0', fontSize: 12.5, fontWeight: 500, color: 'var(--muted)', lineHeight: 1.45 }}>
                {lang === 'zh'
                  ? '有传道安排的日子，早上向全体发送当天安排。没有安排的日子不发送。'
                  : lang === 'en'
                    ? "On days with service, everyone gets a morning summary. Nothing is sent on empty days."
                    : '봉사 마련이 있는 날 아침에 전체에게 그날 마련을 보냅니다. 일정이 없는 날은 보내지 않습니다.'}
              </p>
            </div>
            <Toggle
              checked={daily.enabled}
              onChange={(enabled) => saveDaily({ ...daily, enabled })}
            />
          </div>

          <div style={{ marginTop: 12, maxWidth: 200 }}>
            <label style={{ display: 'block', fontSize: 11.5, fontWeight: 500, color: 'var(--muted)', marginBottom: 5 }}>
              {lang === 'zh' ? '发送时间' : lang === 'en' ? 'Send at' : '보내는 시각'}
            </label>
            <input
              type="time"
              value={daily.send_time}
              disabled={!daily.enabled || dailyBusy}
              onChange={(e) => saveDaily({ ...daily, send_time: e.target.value })}
              style={{
                // iOS Safari 는 time 입력의 기본 너비가 커서 box-sizing 없이는 칸이 겹침
                width: '100%', minWidth: 0, boxSizing: 'border-box',
                padding: '8px 6px', borderRadius: 8,
                border: '1px solid var(--line)', fontSize: 13, fontWeight: 600, color: 'var(--ink)',
                background: daily.enabled ? 'var(--surface)' : 'var(--tint)',
              }}
            />
          </div>
          {(dailyBusy || dailyMessage) && (
            <p style={{ margin: '9px 0 0', fontSize: 12, fontWeight: 500, color: 'var(--muted)' }}>
              {dailyBusy ? (lang === 'zh' ? '保存中...' : lang === 'en' ? 'Saving...' : '저장 중...') : dailyMessage}
            </p>
          )}
        </div>
      )}

      {canManageGlobalQuiet && (
        <div style={{
          marginBottom: 16,
          padding: '13px 12px',
          borderRadius: 12,
          border: '1px solid var(--line)',
          background: 'var(--paper)',
          minWidth: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <div style={{ minWidth: 0 }}>
              <p style={{ margin: 0, fontSize: 14, fontWeight: 650, color: 'var(--ink)', lineHeight: 1.35 }}>
                {lang === 'zh' ? '全体通知静音时间' : lang === 'en' ? 'Global quiet hours' : '전체 알림 금지 시간'}
              </p>
              <p style={{ margin: '3px 0 0', fontSize: 12.5, fontWeight: 500, color: 'var(--muted)', lineHeight: 1.45 }}>
                {lang === 'zh'
                  ? '在此时间内，所有人的推送通知都会暂停。应用内通知记录会保留。'
                  : lang === 'en'
                    ? 'Push notifications are paused for everyone. In-app notification history is still saved.'
                    : '이 시간에는 모든 사용자에게 푸시 알림을 보내지 않습니다. 앱 안 알림 기록은 남습니다.'}
              </p>
            </div>
            <Toggle
              checked={globalQuiet.enabled}
              onChange={(enabled) => saveGlobalQuiet({ ...globalQuiet, enabled })}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 10, marginTop: 12 }}>
            <div>
              <label style={{ display: 'block', fontSize: 11.5, fontWeight: 500, color: 'var(--muted)', marginBottom: 5 }}>
                {lang === 'zh' ? '开始' : lang === 'en' ? 'Start' : '시작'}
              </label>
              <input
                type="time"
                value={globalQuiet.quiet_start}
                disabled={!globalQuiet.enabled || globalQuietLoading || globalQuietSaving}
                onChange={(e) => saveGlobalQuiet({ ...globalQuiet, quiet_start: e.target.value })}
                style={{
                  // iOS Safari 는 time 입력의 기본 너비가 커서 box-sizing 없이는 칸이 겹침
                  width: '100%', minWidth: 0, boxSizing: 'border-box',
                  padding: '8px 6px', borderRadius: 8,
                  border: '1px solid var(--line)', fontSize: 13, fontWeight: 600, color: 'var(--ink)',
                  background: globalQuiet.enabled ? 'var(--surface)' : 'var(--tint)',
                }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 11.5, fontWeight: 500, color: 'var(--muted)', marginBottom: 5 }}>
                {lang === 'zh' ? '结束' : lang === 'en' ? 'End' : '종료'}
              </label>
              <input
                type="time"
                value={globalQuiet.quiet_end}
                disabled={!globalQuiet.enabled || globalQuietLoading || globalQuietSaving}
                onChange={(e) => saveGlobalQuiet({ ...globalQuiet, quiet_end: e.target.value })}
                style={{
                  // iOS Safari 는 time 입력의 기본 너비가 커서 box-sizing 없이는 칸이 겹침
                  width: '100%', minWidth: 0, boxSizing: 'border-box',
                  padding: '8px 6px', borderRadius: 8,
                  border: '1px solid var(--line)', fontSize: 13, fontWeight: 600, color: 'var(--ink)',
                  background: globalQuiet.enabled ? 'var(--surface)' : 'var(--tint)',
                }}
              />
            </div>
          </div>
          {(globalQuietSaving || globalQuietMessage) && (
            <p style={{ margin: '9px 0 0', fontSize: 12, fontWeight: 500, color: globalQuietMessage?.includes('못') || globalQuietMessage?.includes('fail') || globalQuietMessage?.includes('失败') ? '#dc2626' : 'var(--muted)' }}>
              {globalQuietSaving ? (lang === 'zh' ? '保存中...' : lang === 'en' ? 'Saving...' : '저장 중...') : globalQuietMessage}
            </p>
          )}
        </div>
      )}

      {/* 그룹 토글 + 세부 펼침 — 기기 알림이 꺼져 있으면 무시되므로 흐리게 */}
      <div style={{ marginBottom: 16, opacity: deviceOff ? 0.45 : 1 }}>
        <p style={{
          margin: '0 0 8px', fontSize: 12.5, fontWeight: 500, color: 'var(--muted)',
        }}>{lang === 'zh' ? '接收通知类型' : lang === 'en' ? 'Notification types' : '받을 알림 종류'}</p>
        {GROUPS.map((group) => {
          const groupOn = group.items.every((item) => prefs[item.key])
          const someOn = !groupOn && group.items.some((item) => prefs[item.key])
          const isOpen = expandedGroup === group.id
          return (
            <div key={group.id} style={{ borderBottom: '1px solid var(--line)' }}>
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                gap: 12, padding: '12px 0',
              }}>
                <button
                  type="button"
                  onClick={() => setExpandedGroup(isOpen ? null : group.id)}
                  style={{
                    flex: 1, minWidth: 0, minHeight: 0, display: 'flex', alignItems: 'center', gap: 10,
                    background: 'none', border: 'none', padding: 0, textAlign: 'left',
                    cursor: 'pointer',
                  }}
                >
                  <span
                    aria-hidden
                    style={{
                      width: 6, height: 6, borderRadius: 99,
                      background: groupOn ? 'var(--ink)' : 'var(--muted-2)', flexShrink: 0,
                    }}
                  />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 14, fontWeight: 600, color: 'var(--ink)', lineHeight: 1.3 }}>
                      {gl(group, lang)}
                      {someOn && <em style={{ fontStyle: 'normal', marginLeft: 6, fontSize: 11.5, color: 'var(--muted)' }}>{lang === 'zh' ? '(部分)' : lang === 'en' ? '(partial)' : '(일부)'}</em>}
                    </span>
                    <span style={{ display: 'block', marginTop: 2, fontSize: 12.5, fontWeight: 500, color: 'var(--muted)', lineHeight: 1.4 }}>
                      {gd(group, lang)}
                    </span>
                  </span>
                  <span aria-hidden style={{ color: 'var(--muted-2)', fontSize: 14, transform: isOpen ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 0.15s' }}>
                    ⌄
                  </span>
                </button>
                <Toggle
                  checked={groupOn}
                  onChange={(v) => {
                    const patch: Partial<typeof prefs> = {}
                    group.items.forEach((item) => { (patch as Record<string, boolean>)[item.key] = v })
                    update(patch)
                  }}
                />
              </div>
              {isOpen && (
                <div style={{ paddingBottom: 10 }}>
                  {group.items.map((item) => (
                    <label
                      key={item.key}
                      style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        gap: 12, padding: '8px 12px 8px 28px',
                        cursor: 'pointer',
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--text)', lineHeight: 1.3 }}>{il(item, lang)}</p>
                        <p style={{ margin: '2px 0 0', fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.4 }}>{id_(item, lang)}</p>
                      </div>
                      <Toggle
                        checked={prefs[item.key]}
                        onChange={(v) => update({ [item.key]: v } as Partial<typeof prefs>)}
                      />
                    </label>
                  ))}
                </div>
              )}
            </div>
          )
        })}
        <p style={{ margin: '12px 0 0', padding: '10px 12px', borderRadius: 10, background: 'var(--paper)', fontSize: 12, fontWeight: 500, color: 'var(--muted)', lineHeight: 1.5 }}>
          {lang === 'zh' ? '不发送新日程添加通知。展开分组可单独开关详细通知。' : lang === 'en' ? 'New event creation alerts are not sent. Expand a group to toggle individual alerts.' : '새 일정 등록 알림은 보내지 않습니다. 그룹을 펼치면 세부 알림을 따로 켜고 끌 수 있어요.'}
        </p>
      </div>

      {/* 방해금지 시간 */}
      <div>
        <p style={{
          margin: '0 0 8px', fontSize: 12.5, fontWeight: 500, color: 'var(--muted)',
        }}>{lang === 'zh' ? '免打扰时间' : lang === 'en' ? 'Quiet hours' : '방해금지 시간'}</p>

        <label style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 12, padding: '11px 0', cursor: 'pointer',
        }}>
          <div style={{ flex: 1 }}>
            <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--ink)', lineHeight: 1.3 }}>{lang === 'zh' ? '启用免打扰时间' : lang === 'en' ? 'Enable quiet hours' : '방해금지 시간 사용'}</p>
            <p style={{ margin: '2px 0 0', fontSize: 12.5, fontWeight: 500, color: 'var(--muted)', lineHeight: 1.4 }}>
              {lang === 'zh' ? '设定时间内收到通知仅显示角标，不响铃' : lang === 'en' ? 'Notifications silenced during this time (badge only)' : '설정한 시간에는 알림이 와도 무음 (배지로만 표시)'}
            </p>
          </div>
          <Toggle
            checked={dndEnabled}
            onChange={(v) => {
              if (v) {
                update({ quietHoursStart: localStart, quietHoursEnd: localEnd })
              } else {
                update({ quietHoursStart: null, quietHoursEnd: null })
              }
            }}
          />
        </label>

        {dndEnabled && (
          <div style={{
            display: 'flex', gap: 12, marginTop: 8, padding: '12px 14px',
            background: 'var(--paper)', border: '1px solid var(--line)', borderRadius: 10,
          }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <label style={{ display: 'block', fontSize: 11.5, fontWeight: 500, color: 'var(--muted)', marginBottom: 5 }}>{lang === 'zh' ? '开始' : lang === 'en' ? 'Start' : '시작'}</label>
              <input
                type="time"
                value={localStart}
                onChange={(e) => {
                  setLocalStart(e.target.value)
                  update({ quietHoursStart: e.target.value })
                }}
                style={{
                  width: '100%', minWidth: 0, boxSizing: 'border-box',
                  padding: '8px 10px', borderRadius: 8,
                  border: '1px solid var(--line)', fontSize: 13, fontWeight: 600, color: 'var(--ink)',
                  background: 'var(--surface)',
                }}
              />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <label style={{ display: 'block', fontSize: 11.5, fontWeight: 500, color: 'var(--muted)', marginBottom: 5 }}>{lang === 'zh' ? '结束' : lang === 'en' ? 'End' : '종료'}</label>
              <input
                type="time"
                value={localEnd}
                onChange={(e) => {
                  setLocalEnd(e.target.value)
                  update({ quietHoursEnd: e.target.value })
                }}
                style={{
                  width: '100%', minWidth: 0, boxSizing: 'border-box',
                  padding: '8px 10px', borderRadius: 8,
                  border: '1px solid var(--line)', fontSize: 13, fontWeight: 600, color: 'var(--ink)',
                  background: 'var(--surface)',
                }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// 디자인 09 의 .toggle 매칭 (40×24 트랙, 18 노브, ink on)
function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={(e) => {
        e.preventDefault()
        onChange(!checked)
      }}
      style={{
        position: 'relative',
        width: 40,
        height: 24,
        minHeight: 24,
        flexShrink: 0,
        borderRadius: 99,
        border: 'none',
        background: checked ? 'var(--ink)' : 'var(--line)',
        cursor: 'pointer',
        transition: 'background 0.18s',
        padding: 0,
        marginLeft: 12,
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: 3,
          left: checked ? 19 : 3,
          width: 18,
          height: 18,
          borderRadius: '50%',
          background: '#fff',
          transition: 'left 0.18s',
          boxShadow: '0 1px 3px rgba(0,0,0,0.18)',
        }}
      />
    </button>
  )
}
