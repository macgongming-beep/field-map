// 설정 → 지역 관리 (관리자·개발자)
//
// 지역 목록은 예전에 코드에 박혀 있었다. 구역이 재편돼도 개발자가 고쳐 배포해야 해서
// 방치됐고, 실제와 어긋난 채 오래 있었다 (동 목록은 15개에서 멈춘 사이 실제는 41개가 됐다).
//
// 여기서 바꾸는 것: 순서 · 상위 시 · 중국어/영어 이름.
// 이름 자체는 바꾸지 않는다 — 구역 카드 608장의 region 과 카드 이름까지 함께
// 고쳐야 해서, 화면에서 가볍게 할 일이 아니다.
import { useState } from 'react'
import { getRegions } from '../lib/regions'
import { confirmDialog } from '../lib/confirm'
import { msg } from '../lib/msg'
import { getCongregationProfile } from '../lib/congregationProfile'

type RegionRow = {
  name: string
  city: string
  nameZh: string
  nameEn: string
}

export function DesktopTerritoryRegions({
  cardCounts,
  onUpdateRegion,
  onMoveRegion,
  onDeleteRegion,
}: {
  /** 지역 이름 → 구역 카드 수. 삭제해도 되는지 보여 준다 */
  cardCounts: Record<string, number>
  onUpdateRegion: (id: number, input: { city?: string; nameZh?: string; nameEn?: string }) => Promise<boolean>
  onMoveRegion: (id: number, direction: 'up' | 'down') => Promise<boolean>
  onDeleteRegion: (id: number, name: string) => Promise<boolean>
}) {
  // ⚠ getRegions() 는 모듈 상태라 그 자체로는 다시 그리기를 부르지 않는다.
  //   순서를 바꾸면 fetchAll → cards 가 새로 들어오고 → cardCounts 가 바뀌어
  //   이 컴포넌트가 다시 그려진다. cardCounts 를 안 쓰게 되면 화면이 안 바뀐다.
  const regions = getRegions()
  const [editing, setEditing] = useState<{ index: number; row: RegionRow } | null>(null)
  const [busy, setBusy] = useState(false)

  const startEdit = (index: number) => {
    const r = regions[index]
    setEditing({ index, row: { name: r.name, city: r.city, nameZh: r.nameZh, nameEn: r.nameEn } })
  }

  const save = async () => {
    if (!editing || busy) return
    setBusy(true)
    const saved = await onUpdateRegion(regions[editing.index].id, {
      city: editing.row.city,
      nameZh: editing.row.nameZh,
      nameEn: editing.row.nameEn,
    })
    setBusy(false)
    if (saved) setEditing(null)
  }

  const remove = async (index: number) => {
    const r = regions[index]
    const count = cardCounts[r.name] ?? 0
    if (count > 0) return
    const ok = await confirmDialog({
      message: `'${r.name}' 을 목록에서 지웁니다. 구역 카드가 없어 지워도 됩니다.`,
      danger: true,
      confirmLabel: '삭제',
    })
    if (!ok) return
    await onDeleteRegion(r.id, r.name)
  }

  return (
    <section className="la-page" style={{ alignItems: 'center' }}>
      <div style={{ maxWidth: 720, width: '100%', padding: '24px 0' }}>
        {/* 설정 하위 화면들과 같은 제목 (내 정보·데이터 관리·특별 봉사 시즌) */}
        <h2 style={{ fontSize: 22, fontWeight: 800, color: 'var(--gray-900)', marginBottom: 8 }}>지역 관리</h2>
        <p style={{ margin: '0 0 24px', fontSize: 13.5, color: 'var(--muted)', lineHeight: 1.7 }}>
          구역 카드 이름의 맨 앞에 붙는 지역입니다. 순서를 바꾸면 지도·구역 화면의
          지역 차례가 함께 바뀝니다. 새 지역은 <b>구역 → 새 구역 카드 추가</b>에서 만듭니다.
        </p>

        <div style={{ display: 'grid', gap: 8 }}>
          {regions.map((r, i) => {
            const count = cardCounts[r.name] ?? 0
            const isEditing = editing?.index === i
            return (
              <div
                key={r.name}
                style={{
                  padding: 14, borderRadius: 10, border: '1px solid var(--line)',
                  background: 'var(--paper)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ display: 'grid', gap: 2 }}>
                    <button
                      className="region-order-btn"
                      disabled={i === 0 || busy}
                      onClick={() => void onMoveRegion(r.id, 'up')}
                      title={msg('위로')}
                      type="button"
                    >▲</button>
                    <button
                      className="region-order-btn"
                      disabled={i === regions.length - 1 || busy}
                      onClick={() => void onMoveRegion(r.id, 'down')}
                      title={msg('아래로')}
                      type="button"
                    >▼</button>
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <strong style={{ fontSize: 15 }}>{r.name}</strong>
                    <p style={{ margin: '3px 0 0', fontSize: 12.5, color: 'var(--muted)' }}>
                      {r.city ? `${r.city} 소속` : '시 자체'}
                      {' · '}구역 카드 {count}장
                      {(r.nameZh || r.nameEn) && ` · ${[r.nameZh, r.nameEn].filter(Boolean).join(' / ')}`}
                    </p>
                  </div>

                  <button className="ds-btn" onClick={() => (isEditing ? setEditing(null) : startEdit(i))} type="button">
                    {isEditing ? '닫기' : '수정'}
                  </button>
                  <button
                    className="ds-btn"
                    disabled={count > 0 || busy}
                    onClick={() => void remove(i)}
                    title={count > 0 ? `구역 카드 ${count}장이 있어 지울 수 없습니다` : '삭제'}
                    type="button"
                  >
                    삭제
                  </button>
                </div>

                {isEditing && editing && (
                  <div style={{ marginTop: 12, display: 'grid', gap: 10 }}>
                    <div className="cal-field">
                      <label>상위 시 <span style={{ fontWeight: 400, color: 'var(--muted)' }}>— &lsquo;구&rsquo;일 때만</span></label>
                      <input
                        className="cal-input"
                        placeholder={`예: ${getCongregationProfile().defaultCity || '상위 시'} (시 자체라면 비워 두세요)`}
                        value={editing.row.city}
                        onChange={(e) => setEditing({ ...editing, row: { ...editing.row, city: e.target.value } })}
                      />
                    </div>
                    <div className="cal-field-row">
                      <div className="cal-field">
                        <label>중국어 이름</label>
                        <input
                          className="cal-input"
                          placeholder="비우면 한국어로 보입니다"
                          value={editing.row.nameZh}
                          onChange={(e) => setEditing({ ...editing, row: { ...editing.row, nameZh: e.target.value } })}
                        />
                      </div>
                      <div className="cal-field">
                        <label>영어 이름</label>
                        <input
                          className="cal-input"
                          placeholder="비우면 한국어로 보입니다"
                          value={editing.row.nameEn}
                          onChange={(e) => setEditing({ ...editing, row: { ...editing.row, nameEn: e.target.value } })}
                        />
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button className="ds-btn" onClick={() => setEditing(null)} type="button">취소</button>
                      <button className="ds-btn ds-btn--primary" disabled={busy} onClick={() => void save()} type="button">
                        {busy ? '저장 중…' : '저장'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
