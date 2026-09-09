import { useMemo, useState } from 'react'
import { getRegionNames } from '../lib/regions'
import { getAreaOptions, findSimilarArea, normalizeAreaName } from '../utils/areaOptions'
import { findSimilarName } from '../utils/nameSimilarity'
import type { TerritoryCard, TerritoryRegion } from '../types'

/** 목록에 없는 동을 직접 적을 때 고르는 값 */
const NEW_AREA = '__new__'
/** 목록에 없는 지역을 직접 적을 때 고르는 값 (관리자·개발자만 보인다) */
const NEW_REGION = '__new_region__'

/** 카드 목록에서 특정 지역/동의 다음 카드 번호를 반환 */
function getNextCardIndex(cards: TerritoryCard[], region: string, area: string): number {
  const indexes = cards
    .filter((card) => card.region === region && card.area === area)
    .map((card) => {
      const match = card.name.match(/(\d+)$/)
      return match ? Number(match[1]) : 0
    })
    .filter((index) => Number.isFinite(index))
  return Math.max(0, ...indexes) + 1
}

/**
 * 새 구역 카드 추가 모달
 * 자체 상태를 관리하고, 생성 완료 시 onCreated 를 통해 새 카드 정보를 부모에 전달합니다.
 */
export function CardCreateModal({
  cards,
  onClose,
  onCreateCard,
  onCreated,
  canAddRegion = false,
  onCreateRegion,
}: {
  cards: TerritoryCard[]
  onClose: () => void
  onCreateCard: (input: {
    area: string
    region: string
    index: number
    pinCount: number
  }) => Promise<number | null> | number | null
  /** 카드 생성 성공 시 호출 — 부모에서 선택 카드 변경·구역선 안내 등에 활용 */
  onCreated: (newCardId: number, newCardName: string) => void
  /** 지역 추가는 관리자·개발자만. 지역 이름은 카드 이름의 맨 앞이라 여파가 크다 */
  canAddRegion?: boolean
  onCreateRegion?: (input: { name: string; city?: string }) => Promise<boolean>
}) {
  const regionNames = getRegionNames()
  const defaultRegion = regionNames[0] as TerritoryRegion
  const defaultArea = getAreaOptions(cards, defaultRegion)[0] ?? ''

  const [region, setRegion] = useState<string>(defaultRegion)
  const [area, setArea] = useState<string>(defaultArea)
  /** 직접 입력 중이면 그 글자, 아니면 null */
  const [newArea, setNewArea] = useState<string | null>(null)
  const [index, setIndex] = useState<number>(() => getNextCardIndex(cards, defaultRegion, defaultArea))
  const [pinCount, setPinCount] = useState(5)
  const [creating, setCreating] = useState(false)
  /** 새 지역을 적는 중이면 그 값, 아니면 null */
  const [newRegion, setNewRegion] = useState<{ name: string; city: string } | null>(null)
  const [savingRegion, setSavingRegion] = useState(false)

  const similarRegion = newRegion ? findSimilarName(newRegion.name, regionNames) : null

  const areaOptions = useMemo(() => getAreaOptions(cards, region), [cards, region])
  const finalArea = newArea === null ? area : normalizeAreaName(newArea)
  // 하드코딩 목록이 맞춤법 검사기 노릇을 하던 걸 대신한다.
  // 오타 하나로 '백암면' 이 둘로 갈라지면 통계·배정이 조용히 어긋난다.
  const similarArea = newArea === null ? null : findSimilarArea(newArea, areaOptions)

  const cardName = `${region} ${finalArea} ${index}`
  const isDuplicate = cards.some((card) => card.name === cardName)

  const handleRegionChange = (nextRegion: string) => {
    if (nextRegion === NEW_REGION) { setNewRegion({ name: '', city: '' }); return }
    setNewRegion(null)
    const nextArea = getAreaOptions(cards, nextRegion)[0] ?? ''
    setRegion(nextRegion)
    setArea(nextArea)
    setNewArea(null)
    setIndex(getNextCardIndex(cards, nextRegion, nextArea))
  }

  // 지역은 카드를 만들기 전에 먼저 저장한다. 카드의 region 은 이 이름을 가리키므로
  // 목록에 없는 지역으로 카드를 만들면 그 카드가 필터에서 통째로 사라진다.
  const handleSaveRegion = async () => {
    if (!newRegion || !onCreateRegion || savingRegion) return
    const name = normalizeAreaName(newRegion.name)
    if (!name) return
    setSavingRegion(true)
    const ok = await onCreateRegion({ name, city: normalizeAreaName(newRegion.city) })
    setSavingRegion(false)
    if (!ok) return
    setNewRegion(null)
    setRegion(name)
    setArea('')
    setNewArea('')          // 새 지역엔 동이 하나도 없다 — 바로 적게 연다
    setIndex(1)
  }

  const handleAreaChange = (nextArea: string) => {
    if (nextArea === NEW_AREA) { setNewArea(''); return }
    setNewArea(null)
    setArea(nextArea)
    setIndex(getNextCardIndex(cards, region, nextArea))
  }

  const handleNewAreaChange = (value: string) => {
    setNewArea(value)
    setIndex(getNextCardIndex(cards, region, normalizeAreaName(value)))
  }

  const handleCreate = async () => {
    if (isDuplicate || creating || !finalArea || newRegion) return
    setCreating(true)
    const newCardId = await onCreateCard({ area: finalArea, region, index, pinCount })
    setCreating(false)
    if (!newCardId) return
    onClose()
    onCreated(newCardId, cardName)
  }

  return (
    <div className="cal-modal-backdrop" onClick={onClose}>
      <div className="cal-modal" style={{ maxWidth: '440px' }} onClick={(e) => e.stopPropagation()}>
        <div className="cal-modal-head">
          <div className="cal-modal-title">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="12" y1="18" x2="12" y2="12" /><line x1="9" y1="15" x2="15" y2="15" />
            </svg>
            <h2>새 구역 카드 추가</h2>
          </div>
          <button className="cal-modal-close" onClick={onClose} type="button">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="cal-modal-body">
          <div className="cal-field-row">
            <div className="cal-field">
              <label>지역</label>
              <select
                className="cal-input"
                value={newRegion ? NEW_REGION : region}
                onChange={(e) => handleRegionChange(e.target.value)}
              >
                {regionNames.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
                {canAddRegion && <option value={NEW_REGION}>+ 새 지역 추가</option>}
              </select>
            </div>
            <div className="cal-field">
              <label>동</label>
              <select
                className="cal-input"
                value={newArea === null ? area : NEW_AREA}
                onChange={(e) => handleAreaChange(e.target.value)}
              >
                {areaOptions.map((a) => (
                  <option key={a} value={a}>{a}</option>
                ))}
                <option value={NEW_AREA}>+ 새 동 직접 입력</option>
              </select>
            </div>
          </div>

          {newRegion && (
            <div style={{ padding: 12, borderRadius: 'var(--r-md)', border: '1px solid var(--line)', display: 'grid', gap: 10 }}>
              <div className="cal-field">
                <label>새 지역 이름</label>
                <input
                  autoFocus
                  className="cal-input"
                  placeholder="예: 안성시"
                  value={newRegion.name}
                  onChange={(e) => setNewRegion({ ...newRegion, name: e.target.value })}
                />
                {similarRegion && (
                  <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--warn-600, #b45309)', fontWeight: 700 }}>
                    혹시 <b>{similarRegion}</b> 인가요? 지역 이름은 카드 이름의 맨 앞이라,
                    갈라지면 그 구역이 통째로 따로 놀게 됩니다.
                  </p>
                )}
              </div>
              <div className="cal-field">
                <label>상위 시 <span style={{ fontWeight: 400, color: 'var(--muted)' }}>— &lsquo;구&rsquo;일 때만</span></label>
                <input
                  className="cal-input"
                  placeholder="예: 구 단위 지역이면 상위 시 입력 / 시 자체라면 비워 두세요"
                  value={newRegion.city}
                  onChange={(e) => setNewRegion({ ...newRegion, city: e.target.value })}
                />
                <p style={{ margin: '6px 0 0', fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.6 }}>
                  주소로 지도를 찍을 때 씁니다. 구 이름만으로는 같은 이름의 길이
                  다른 시에도 있어 엉뚱한 곳에 찍힙니다.
                </p>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="cal-cancel-btn" onClick={() => setNewRegion(null)} type="button">취소</button>
                <button
                  className="cal-save-btn"
                  disabled={savingRegion || !normalizeAreaName(newRegion.name)}
                  onClick={() => void handleSaveRegion()}
                  type="button"
                >
                  {savingRegion ? '추가 중…' : '지역 추가'}
                </button>
              </div>
              <p style={{ margin: 0, fontSize: 12.5, color: 'var(--muted)' }}>
                순서와 중국어·영어 이름은 <b>설정 → 지역 관리</b>에서 바꿉니다.
                번역을 비워 두면 한국어로 보입니다.
              </p>
            </div>
          )}

          {newArea !== null && (
            <div className="cal-field">
              <label>새 동 이름</label>
              <input
                autoFocus
                className="cal-input"
                placeholder="예: 백암면"
                value={newArea}
                onChange={(e) => handleNewAreaChange(e.target.value)}
              />
              {similarArea && (
                <p style={{ margin: '6px 0 0', fontSize: '13px', color: 'var(--warn-600, #b45309)', fontWeight: 700 }}>
                  혹시 <b>{similarArea}</b> 인가요? 이름이 조금 다르면 같은 동이 둘로 갈라집니다.{' '}
                  <button
                    className="cal-cancel-btn"
                    onClick={() => handleAreaChange(similarArea)}
                    style={{ padding: '2px 8px', fontSize: 12 }}
                    type="button"
                  >
                    {similarArea} 선택
                  </button>
                </p>
              )}
            </div>
          )}

          <div className="cal-field-row">
            <div className="cal-field">
              <label>번호</label>
              <input
                className="cal-input"
                min="1"
                type="number"
                value={index}
                onChange={(e) => setIndex(Number(e.target.value))}
              />
            </div>
            <div className="cal-field">
              <label>핀 수</label>
              <input
                className="cal-input"
                max="6"
                min="4"
                type="number"
                value={pinCount}
                onChange={(e) => setPinCount(Number(e.target.value))}
              />
            </div>
          </div>

          <div style={{ padding: '12px 14px', borderRadius: 'var(--r-md)', background: '#f3f4f6' }}>
            <span style={{ fontSize: '12px', color: 'var(--ink-500)', fontWeight: 700 }}>생성될 카드 이름</span>
            <p style={{ margin: '4px 0 0', fontSize: '16px', fontWeight: 700, color: 'var(--ink-900)' }}>{cardName}</p>
          </div>

          {isDuplicate && (
            <p style={{ margin: 0, fontSize: '13px', color: 'var(--danger-600)', fontWeight: 700 }}>
              이미 같은 이름의 카드가 있습니다. 번호를 바꿔주세요.
            </p>
          )}
        </div>

        <div className="cal-modal-foot">
          <button className="cal-cancel-btn" onClick={onClose} type="button">취소</button>
          <button
            className="cal-save-btn"
            disabled={creating || isDuplicate || !finalArea || Boolean(newRegion)}
            onClick={handleCreate}
            type="button"
          >
            {creating ? '생성 중...' : '카드 생성'}
          </button>
        </div>
      </div>
    </div>
  )
}
