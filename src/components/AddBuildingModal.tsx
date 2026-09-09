// 건물 하나를 손으로 추가하는 모달. DesktopTerritory 에서 떼어냈다.
//
// 여기가 아는 것: 입력값과 좌표 찾기 상태.
// 여기가 모르는 것: 어느 카드에 넣을지, 어떻게 저장할지. 그건 부모가 한다.
//   자동 배정은 구역선·카드 목록을 봐야 해서 화면이 들고 있을 일이 아니다.
import { useRef, useState } from 'react'
import type { Building } from '../types'
import { getAddressExample } from '../lib/congregationProfile'

export type AddBuildingForm = {
  name: string
  address: string
  type: Building['type']
  /** 'auto' 면 부모가 주소·좌표로 카드를 고른다 */
  cardId: number | 'auto'
}

type LatLng = { lat: number; lng: number }

type Props = {
  /** 카드 고르기 목록. 화면은 이름만 있으면 된다 — 카드 전체를 알 필요가 없다 */
  cards: { id: number; name: string }[]
  onClose: () => void
  /** 주소 → 좌표. 못 찾으면 null */
  onGeocode: (address: string) => Promise<LatLng | null>
  /**
   * 저장. **성공하면 true, 실패하면 false.**
   *
   * 실패 신호를 반환값 하나로 못박는다. void 를 성공으로 치거나 예외를 실패
   * 신호로 섞으면, 화면마다 해석이 갈리고 조용히 닫히는 창이 생긴다.
   * 예상 못 한 예외는 여기서 잡아 입력을 지킨다.
   */
  onSubmit: (form: AddBuildingForm, latLng: LatLng | null) => Promise<boolean>
}

const EMPTY: AddBuildingForm = { name: '', address: '', type: '주택', cardId: 'auto' }

export function AddBuildingModal({ cards, onClose, onGeocode, onSubmit }: Props) {
  const [form, setForm] = useState<AddBuildingForm>(EMPTY)
  const [geoState, setGeoState] = useState<'idle' | 'loading' | 'ok' | 'fail'>('idle')
  const [latLng, setLatLng] = useState<LatLng | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // 주소 검색은 여러 번 겹칠 수 있다. 늦게 온 옛 결과가 새 주소를 덮으면
  // **다른 동네 좌표로 건물이 등록된다.** 지도에서만 티가 나고 대장에는 안 보인다.
  // 그래서 요청마다 번호를 붙이고 마지막 것만 받는다.
  const geoSeq = useRef(0)

  /** 주소 하나를 찾는다. 그 사이 주소가 또 바뀌었으면 결과를 버린다. */
  const runGeocode = async (address: string): Promise<LatLng | null> => {
    const seq = ++geoSeq.current
    setGeoState('loading')
    let point: LatLng | null = null
    try {
      point = await onGeocode(address)
    } catch {
      point = null
    }
    if (seq !== geoSeq.current) return null   // 뒤늦게 온 옛 결과 — 버린다
    setLatLng(point)
    setGeoState(point ? 'ok' : 'fail')
    return point
  }

  /** 주소가 바뀌면 찾아 둔 좌표도, 진행 중인 검색도 무효로 만든다 */
  const changeAddress = (address: string) => {
    geoSeq.current++
    setForm((f) => ({ ...f, address }))
    setLatLng(null)
    setGeoState('idle')
  }

  const submit = async () => {
    if (!form.address.trim() || submitting) return
    setSubmitting(true)
    try {
      // 좌표를 아직 안 찾았으면 여기서 한 번 찾는다 (사용자가 버튼을 안 눌렀을 때)
      const point = latLng ?? await runGeocode(form.address)
      const ok = await onSubmit(form, point)
      if (!ok) return              // 저장 실패 — 모달을 열어 둔다
      onClose()
    } catch {
      // 예상 못 한 장애. 입력을 지키고 창을 열어 둔다 — 다시 누르면 된다.
      // (사용자에게 보이는 알림은 저장하는 쪽이 이미 띄운다)
    } finally {
      setSubmitting(false)
    }
  }

  /** 저장 중에는 닫지 않는다. 닫아도 저장은 계속돼서, 결과를 아무도 못 본다. */
  const requestClose = () => { if (!submitting) onClose() }

  return (
      <div className="cal-modal-backdrop" onClick={requestClose}>
        <div className="cal-modal add-building-modal" onClick={(e) => e.stopPropagation()}>
          <div className="cal-modal-head">
            <div className="cal-modal-title">
              <h2>건물 추가</h2>
              <p className="merge-name-modal-sub">주소 입력 후 자동으로 좌표를 찾고 카드에 배정됩니다.</p>
            </div>
            <button className="cal-modal-close" disabled={submitting} onClick={requestClose} type="button">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
          <div className="add-building-modal-body">
            <label className="add-building-field">
              <span>주소 <em className="add-building-required">*</em></span>
              <div className="add-building-address-row">
                <input
                  aria-label="주소"
                  className="add-building-input"
                  placeholder={getAddressExample()}
                  value={form.address}
                  onChange={(e) => {
                    changeAddress(e.target.value)
                  }}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void runGeocode(form.address) }}}
                />
                <button
                  className="add-building-geocode-btn"
                  type="button"
                  disabled={!form.address.trim() || geoState === 'loading' || submitting}
                  onClick={() => void runGeocode(form.address)}
                >
                  {geoState === 'loading' ? '검색 중...' : '좌표 찾기'}
                </button>
              </div>
              {geoState === 'ok' && latLng && (
                <span className="add-building-geo-ok">📍 좌표 확인 ({latLng.lat.toFixed(5)}, {latLng.lng.toFixed(5)})</span>
              )}
              {geoState === 'fail' && (
                <span className="add-building-geo-fail">주소를 찾지 못했습니다. 핀 없이 건물이 생성됩니다.</span>
              )}
            </label>
            <label className="add-building-field">
              <span>건물명 <em className="add-building-hint">(비워두면 주소에서 자동 설정)</em></span>
              <input
                className="add-building-input"
                placeholder="예) 언동로빌라, 고진로상가 등"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </label>
            <div className="add-building-row2">
              <label className="add-building-field">
                <span>유형</span>
                <select className="add-building-select" value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as Building['type'] }))}>
                  <option value="주택">주택</option>
                  <option value="상가">상가</option>
                </select>
              </label>
              <label className="add-building-field">
                <span>카드 배정</span>
                <select className="add-building-select" value={form.cardId === 'auto' ? 'auto' : String(form.cardId)} onChange={(e) => setForm((f) => ({ ...f, cardId: e.target.value === 'auto' ? 'auto' : Number(e.target.value) }))}>
                  <option value="auto">자동 (주소 기준)</option>
                  {cards.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </label>
            </div>
          </div>
          <div className="merge-name-modal-footer">
            <button className="cal-cancel-btn" disabled={submitting} onClick={requestClose} type="button">취소</button>
            <button
              className="dup-address-merge-btn"
              type="button"
              disabled={!form.address.trim() || submitting}
              onClick={submit}
              style={{ background: '#2563eb' }}
            >
              {submitting ? '추가 중...' : '건물 추가'}
            </button>
          </div>
        </div>
      </div>
  )
}
