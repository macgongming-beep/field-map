// 중복 주소 건물 합치기 모달.
//
// ⚠ **구역선 카드 병합과 다른 기능이다.** 이름에 둘 다 'merge' 가 들어가지만
//   대상(건물 vs 카드)도, 되돌리기 정책(없음 vs 스냅샷)도, 트랜잭션도 다르다.
//   한 훅으로 합치려다 말았다 (리뷰 지적).
//
// 상태 넷(groups·nameChoices·selected·merging)이 여기서만 쓰인다.
import { useState } from 'react'
import type { MergeResult } from '../utils/duplicateBuildingMerge'
import { formatDisplayAddress } from '../utils/mapUtils'

export type MergeGroup = {
  primaryId: number
  address: string
  cardName: string
  buildingCount: number
  unitCount: number
  names: string[]
}

type Props = {
  groups: MergeGroup[]
  /** 합치기 계획. 호수가 겹쳐 제외된 곳을 보여주는 데 쓴다 */
  mergePlan: {
    conflicts: Array<{
      primary: { id: number; cardId: number; name: string; address: string; units: Array<{ number: string }> }
      absorbed: Array<{ id: number; name: string; units: Array<{ number: string }> }>
      conflictingNumbers: string[]
    }>
  }
  /** 카드 id → 이름 */
  cardName: (cardId: number) => string
  onClose: () => void
  onMerge: (
    plan: undefined,
    nameChoices: Record<number, string>,
    selectedPrimaryIds: number[],
  ) => Promise<MergeResult>
}

export function DuplicateBuildingMergeModal({
  groups: mergeModalGroups, mergePlan, cardName, onClose, onMerge: onMergeDuplicateBuildings,
}: Props) {
  const [mergeNameChoices, setMergeNameChoices] = useState<Record<number, string>>({})
  // 열릴 때 **전부 선택**해 둔다. 예전에는 여는 쪽이 이걸 해 줬는데,
  // 그러면 여는 곳이 늘 때마다 초기화를 잊을 수 있다.
  const [mergeSelectedPrimaryIds, setMergeSelectedPrimaryIds] = useState<Set<number>>(
    () => new Set(mergeModalGroups.map((g) => g.primaryId)),
  )
  const [merging, setMerging] = useState(false)

  return (
      <div className="cal-modal-backdrop" onClick={() => { if (!merging) onClose() }}>
        <div className="cal-modal merge-name-modal" onClick={(e) => e.stopPropagation()}>
          <div className="cal-modal-head">
            <div className="cal-modal-title">
              <h2>합칠 건물 이름 선택</h2>
              <p className="merge-name-modal-sub">합칠 주소 그룹을 선택하고, 각 주소별로 남길 건물 이름을 선택해주세요.</p>
            </div>
            <button className="cal-modal-close" disabled={merging} onClick={() => { if (!merging) onClose() }} type="button">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
          <div className="merge-name-toolbar">
            <label className="merge-name-select-all">
              <input
                checked={mergeModalGroups.length > 0 && mergeSelectedPrimaryIds.size === mergeModalGroups.length}
                onChange={(event) => {
                  setMergeSelectedPrimaryIds(event.target.checked
                    ? new Set(mergeModalGroups.map((group) => group.primaryId))
                    : new Set())
                }}
                type="checkbox"
              />
              전체 선택
            </label>
            <span>선택 {mergeSelectedPrimaryIds.size} / {mergeModalGroups.length}그룹</span>
          </div>
          <div className="merge-name-modal-body">
            {mergeModalGroups.map((group) => (
              <div className={`merge-name-group${mergeSelectedPrimaryIds.has(group.primaryId) ? '' : ' is-unselected'}`} key={group.primaryId}>
                <div className="merge-name-group-head">
                  <label className="merge-name-group-check">
                    <input
                      checked={mergeSelectedPrimaryIds.has(group.primaryId)}
                      onChange={(event) => {
                        setMergeSelectedPrimaryIds((prev) => {
                          const next = new Set(prev)
                          if (event.target.checked) next.add(group.primaryId)
                          else next.delete(group.primaryId)
                          return next
                        })
                      }}
                      type="checkbox"
                    />
                    <span className="merge-name-address">{group.address}</span>
                  </label>
                  <span className="merge-name-count">{group.cardName} · 건물 {group.buildingCount}개 · 세대 {group.unitCount}개</span>
                </div>
                <div className="merge-name-chips">
                  {group.names.map((name) => (
                    <button
                      key={name}
                      type="button"
                      disabled={!mergeSelectedPrimaryIds.has(group.primaryId)}
                      className={`merge-name-chip${mergeNameChoices[group.primaryId] === name ? ' active' : ''}`}
                      onClick={() => setMergeNameChoices((prev) => ({ ...prev, [group.primaryId]: name }))}
                    >
                      {name}
                    </button>
                  ))}
                </div>
                <input
                  className="merge-name-custom-input"
                  disabled={!mergeSelectedPrimaryIds.has(group.primaryId)}
                  placeholder="직접 입력 (또는 위에서 선택)"
                  value={mergeNameChoices[group.primaryId] ?? ''}
                  onChange={(e) => setMergeNameChoices((prev) => ({ ...prev, [group.primaryId]: e.target.value }))}
                />
              </div>
            ))}
            {mergePlan.conflicts.length > 0 && (
              <section className="merge-conflict-section" aria-label="병합 보류 주소">
                <div className="merge-conflict-section-head">
                  <strong>병합 보류 {mergePlan.conflicts.length}곳</strong>
                  <span>같은 주소 안에서 호수가 겹쳐 자동으로 합치지 않았습니다.</span>
                </div>
                {mergePlan.conflicts.map((conflict) => {
                  const buildings = [conflict.primary, ...conflict.absorbed]
                  return (
                    <details className="merge-conflict-group" key={conflict.primary.id}>
                      <summary>
                        <span>{formatDisplayAddress(conflict.primary.address)}</span>
                        <em>겹침 {conflict.conflictingNumbers.join(', ')}</em>
                      </summary>
                      <div className="merge-conflict-meta">{cardName(conflict.primary.cardId)} · 건물 {buildings.length}개</div>
                      <div className="merge-conflict-buildings">
                        {buildings.map((building) => (
                          <div className="merge-conflict-building" key={building.id}>
                            <strong>{building.name || '건물명 없음'}</strong>
                            <span>{building.units.map((unit) => unit.number).join(', ') || '등록된 호수 없음'}</span>
                          </div>
                        ))}
                      </div>
                    </details>
                  )
                })}
              </section>
            )}
          </div>
          <div className="merge-name-modal-footer">
            <button className="cal-cancel-btn" disabled={merging} onClick={() => { if (!merging) onClose() }} type="button">취소</button>
            <button
              className="dup-address-merge-btn"
              disabled={mergeSelectedPrimaryIds.size === 0 || merging}
              type="button"
              onClick={async () => {
                if (merging) return
                // 빈 입력은 첫 번째 이름으로 fallback
                const finalChoices: Record<number, string> = {}
                const selectedPrimaryIds = Array.from(mergeSelectedPrimaryIds)
                mergeModalGroups.filter((g) => mergeSelectedPrimaryIds.has(g.primaryId)).forEach((g) => {
                  finalChoices[g.primaryId] = mergeNameChoices[g.primaryId]?.trim() || g.names[0]
                })
                setMerging(true)
                try {
                  const result = await onMergeDuplicateBuildings(undefined, finalChoices, selectedPrimaryIds)
                  // 실패했으면 창을 열어 둔다 — 고른 것과 적은 이름을 지킨다.
                  // 예전에는 부르기 전에 닫아서, 실패해도 아무도 몰랐다.
                  if (!result.ok) return
                  onClose()
                  setMergeSelectedPrimaryIds(new Set())
                } finally {
                  setMerging(false)
                }
              }}
            >
              선택한 주소 합치기
            </button>
          </div>
        </div>
      </div>
  )
}
